// SPDX-License-Identifier: Apache-2.0
//
// The memory strip's layout model (#484): one horizontal run of address
// space, cut at every declared address, each cut sized on `railScale.ts`'s
// log-of-size scale, with the SoM's regions drawn as bands along one lane and
// the manifest's placed spans along another. Pure arithmetic — no React, no
// DOM — so the geometry a reader clicks on can be asserted on its own.
//
// LOW ADDRESSES SIT AT THE LEFT. `layoutRail` puts the window's low end at
// `plotBottom`, so every position it answers is mirrored once here
// (`width - y`) and never touched again: one flip, in one place, and the
// strip reads the way a linker map does.
//
// READ-ONLY, same as the rest of the feature:
// `test/memoryRegions.readOnly.test.js` covers this file too.

import type {
  MemoryRegion,
  MemorySpan,
  MemoryView,
  SliceSize,
} from "../../types";
import { tierOf, type AuthorityTier } from "./authorityTier";
import { formatAddress, formatBytes, formatRange } from "./format";
import { authorityDeclared } from "./memoryRows";
import { railBoundaries, stackEdgeLabels, type LabelBox } from "./railGeometry";
import { layoutRail } from "./railScale";
import {
  budgetEnd,
  chartWindowOf,
  duplicatedNames,
  endOf,
  regionsLargestFirst,
  resolvedRegions,
  splitContainers,
  type Window,
} from "./regionWindow";
import { locksOf } from "./targetLock";
import { cardHeightPx, layoutRegionCards, type RegionCard } from "./stripCards";
import {
  layoutCellLabels,
  metricsOf,
  overflowMarker,
  type CellLabel,
  type OverflowMarker,
  type StripMetrics,
} from "./stripLabels";
import {
  type CellFill,
  cellFill,
  overflowsSlot,
  slotUsageOf,
  usedFillLength,
} from "./slotUsage";

/** The cell field's inset from the slot box's edges, in CSS pixels — the
 *  `--space-4` the field is positioned with in MemoryStrip.module.css. */
export const CELL_INSET_PX = 8;

/** What the strip draws at before its column has been measured, and what
 *  it keeps drawing at when the measurement answers 0 (no `ResizeObserver`,
 *  or one that has not fired yet) — never a strip 0 pixels wide. */
export const FALLBACK_STRIP_WIDTH = 640;

/** The series palette wraps after this many placed spans
 *  (`--chart-1` … `--chart-6` in tokens.css). */
export const SERIES_COUNT = 6;

/** Clearance two neighbouring axis labels keep. A tick label is at least ten
 *  glyphs (`0x80010000`), measured from the font size (stripLabels.ts). */
const TICK_GAP_PX = 8;

export interface StripSegment {
  lo: number;
  hi: number;
  kind: "extent" | "gap";
  left: number;
  width: number;
  /** A gap's own sentence (`2.63 MiB (0x2a0000) empty, not to scale`),
   *  carried as its title and accessible name; null for an extent. */
  gapLabel: string | null;
}

export interface StripRegion {
  id: string;
  name: string;
  left: number;
  width: number;
  /** Null when the SoM declares no write authority at all — the band is
   *  then drawn untinted rather than in the fail-closed tier. */
  tier: AuthorityTier | null;
  /** A duplicated region name is never selectable (see `Row.inert`). */
  selectable: boolean;
  title: string;
  /** How the cell names itself: in the cell, ellipsized, or as a callout
   *  under it (see stripLabels.ts). Never blank. */
  label: CellLabel;
  /** Both target-lock verdicts say locked: the cell is not an edit target
   *  (NOT the write-authority tier — that is `tier`). */
  locked: boolean;
}

/** A region that contains other regions: a thin bar above the cells, across
 *  its whole extent, instead of a cell its children would paint over. */
export interface StripParent {
  id: string;
  name: string;
  left: number;
  width: number;
  tier: AuthorityTier | null;
  selectable: boolean;
  title: string;
  /** `mram_main · 5.50 MiB · composite`. */
  label: string;
  /** Bar row, 0 = top: a bar sits below the bars that contain it, and bars
   *  that overlap never share a row (see `splitContainers`). */
  row: number;
  /** Both target-lock verdicts say locked (see `StripRegion.locked`). */
  locked: boolean;
}

export interface StripSpan {
  id: string;
  name: string;
  left: number;
  width: number;
  /** 1-based index into the chart palette; the same number the core's
   *  flash/RAM meters are tinted with, so the two surfaces agree. */
  series: number;
  /** Length of the used fill along the span, in CSS pixels; null when
   *  `tan size` measured nothing or the span is not a slot image. */
  usedPx: number | null;
  /** The slot as a field of cells (see `cellFill`); null when nothing was
   *  measured or the slot is too narrow for one column, in which case the
   *  strip falls back to the `usedPx` sliver. */
  cells: CellFill | null;
  /** True when the measured image is larger than the slot it is placed
   *  in — the box then says so in the error colour, since a full field of
   *  cells alone reads as merely "full". */
  over: boolean;
  /** True for a base with no extent: drawn as a hairline, not a box. */
  marker: boolean;
  title: string;
}

export interface StripTick {
  address: number;
  /** The label's centre, clamped so the first and last labels stay inside
   *  the strip. The tick LINE sits at `lineX`. */
  x: number;
  lineX: number;
  label: string;
  /** Printed unless the label collided on every axis row; every edge keeps
   *  its line. */
  labelled: boolean;
  /** Axis row of the label (0 nearest the lines); null when not labelled. */
  row: number | null;
  /** The label's horizontal extent, in strip pixels. */
  x0: number;
  x1: number;
  /** The window's last edge: its label is the INCLUSIVE last byte, where
   *  every other label is the first byte of the segment starting there. */
  isEnd: boolean;
}

export interface StripModel {
  width: number;
  window: Window;
  segments: StripSegment[];
  regions: StripRegion[];
  parents: StripParent[];
  /** Waffle cards for the regions no slot image already cards. */
  cards: RegionCard[];
  /** Height of every card in the placed lane, slot cards included. */
  cardHeight: number;
  /** The "+N more" marker for cells past the callout cap, or null. */
  overflow: OverflowMarker | null;
  /** The font-dependent lengths this strip was laid out with. */
  metrics: StripMetrics;
  spans: StripSpan[];
  ticks: StripTick[];
  /** Whether any band carries a tier at all. */
  tiered: boolean;
}

/** `--chart-N` for the N-th placed span, in address order, wrapping. The
 *  map is keyed by the span's LABEL (a slot image's label is its core id),
 *  which is what the core rows look their meter colour up by. */
export function seriesByLabel(spans: MemorySpan[]): Map<string, number> {
  const placed = spans
    .filter((s) => s.base !== null)
    .sort((a, b) => (a.base as number) - (b.base as number));
  return new Map(placed.map((s, i) => [s.label, (i % SERIES_COUNT) + 1]));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * The strip laid out at `width` CSS pixels, or null when the manifest pins
 * fewer than two distinct addresses — one point is not a range, and the
 * caller says so in words instead.
 */
export function buildStrip(
  memory: MemoryView,
  budgets: Map<string, SliceSize>,
  width: number,
  fontPx?: number,
): StripModel | null {
  const metrics = metricsOf(fontPx);
  const regions: MemoryRegion[] = memory.regions ?? [];
  const win = chartWindowOf(memory.spans, budgets, regions);
  if (win === null) return null;
  const resolved = resolvedRegions(regions);
  const { boundaries, occupied } = railBoundaries(
    memory.spans,
    budgets,
    resolved,
  );
  const layout = layoutRail(win, boundaries, 0, width, occupied);
  // The one mirror: `layoutRail` puts the window's low end at `plotBottom`
  // (= `width`), so a low address answers a large y, and the strip wants it
  // at the left.
  const xOf = (address: number): number => width - layout.yOf(address);

  const segments: StripSegment[] = layout.segments.map((s) => ({
    lo: s.lo,
    hi: s.hi,
    kind: s.kind,
    left: width - (s.top + s.height),
    width: s.height,
    gapLabel:
      s.kind === "gap"
        ? `${formatRange(s.lo, s.hi)} · ${formatBytes(s.hi - s.lo)} empty, not to scale`
        : null,
  }));

  const dupes = duplicatedNames(regions);
  const tiered = authorityDeclared(regions);
  const tierFor = (r: MemoryRegion): AuthorityTier | null =>
    tiered ? tierOf(r.authorityClass) : null;
  const { containers, cells } = splitContainers(resolved);
  const parents: StripParent[] = [...containers]
    .sort((a, b) => a.row - b.row || a.lo - b.lo)
    .map((r) => {
      const locks = locksOf(r.region);
      const left = xOf(r.lo);
      const size = formatBytes(r.hi - r.lo);
      return {
        id: r.region.id,
        name: r.region.name,
        left,
        width: xOf(r.hi) - left,
        tier: tierFor(r.region),
        selectable: !dupes.has(r.region.name),
        title: `${r.region.name} · ${formatRange(r.lo, r.hi)} · ${size}`,
        label: `${r.region.name} · ${size}${tiered ? ` · ${r.region.authorityClass}` : ""}`,
        row: r.row,
        locked: locks.ipc.locked && locks.storage.locked,
      };
    });
  // Largest first, so a region nested in another is drawn after it.
  const drafts = regionsLargestFirst(cells).map((r) => {
    const left = xOf(r.lo);
    const width = xOf(r.hi) - left;
    const locks = locksOf(r.region);
    const locked = locks.ipc.locked && locks.storage.locked;
    return {
      region: r.region,
      lo: r.lo,
      hi: r.hi,
      id: r.region.id,
      name: r.region.name,
      left,
      width,
      tier: tierFor(r.region),
      selectable: !dupes.has(r.region.name),
      title: `${r.region.name} · ${formatRange(r.lo, r.hi)} · ${formatBytes(r.hi - r.lo)}`,
      locked,
    };
  });
  const placedLabels = layoutCellLabels(drafts, width, metrics.glyph);
  const stripRegions: StripRegion[] = drafts.map(
    ({ region: _region, lo: _lo, hi: _hi, ...d }, i) => ({
      ...d,
      label: placedLabels[i],
    }),
  );

  const series = seriesByLabel(memory.spans);
  const stripSpans: StripSpan[] = [];
  for (const span of memory.spans) {
    if (span.base === null) continue;
    const reach = endOf(span) ?? budgetEnd(span, budgets.get(span.label));
    const left = xOf(span.base);
    const spanWidth = reach !== null ? xOf(reach) - left : 0;
    const usage = slotUsageOf(span, budgets.get(span.label));
    const usedPx =
      usage !== null && usage.used !== null && usage.total !== null
        ? usedFillLength(usage.used, usage.total, spanWidth)
        : null;
    const cells =
      usage !== null
        ? cellFill(usage.used, usage.total, spanWidth - 2 * CELL_INSET_PX)
        : null;
    stripSpans.push({
      id: span.id,
      name: span.label,
      left,
      width: spanWidth,
      series: series.get(span.label) ?? 1,
      usedPx,
      cells,
      over: usage !== null && overflowsSlot(usage),
      marker: reach === null,
      title:
        reach !== null
          ? `${span.label} · ${formatRange(span.base, reach)} · ${formatBytes(reach - span.base)}`
          : `${span.label} · ${formatAddress(span.base)} · size not pinned`,
    });
  }

  // Every placed slot image and IPC carve-out: a region one of them touches
  // is carded by it (a marker when its extent is not yet known).
  const imageSpans: Array<[number, number]> = memory.spans.flatMap((sp) => {
    if (
      (sp.kind !== "slot_image" && sp.kind !== "carve_out") ||
      sp.base === null
    ) {
      return [];
    }
    const end =
      endOf(sp) ??
      (sp.kind === "slot_image" ? budgetEnd(sp, budgets.get(sp.label)) : null);
    return [[sp.base, end ?? sp.base + 1] as [number, number]];
  });
  const cards = layoutRegionCards(
    drafts,
    stripSpans
      .filter((sp) => sp.width > 0 || sp.marker)
      .map((sp) => [sp.left, sp.left + Math.max(sp.width, 2)]),
    imageSpans,
    width,
    metrics.glyph,
  );

  const ticks = buildTicks(segments, win, width, xOf, metrics.glyph);
  return {
    width,
    window: win,
    segments,
    regions: stripRegions,
    parents,
    cards,
    cardHeight: cardHeightPx(metrics.fontPx),
    overflow: overflowMarker(stripRegions),
    metrics,
    spans: stripSpans,
    ticks,
    tiered,
  };
}

/**
 * One tick per segment edge. The window's exclusive end is labelled with
 * its INCLUSIVE last byte, the same spelling `formatRange` prints, so the
 * strip's right edge and the detail line's range agree digit for digit;
 * every interior edge is the base of the segment that starts there.
 */
function buildTicks(
  segments: StripSegment[],
  win: Window,
  width: number,
  xOf: (address: number) => number,
  glyph: number,
): StripTick[] {
  const edges = [...new Set(segments.flatMap((s) => [s.lo, s.hi]))].sort(
    (a, b) => a - b,
  );
  const labelOf = (a: number): string =>
    formatAddress(a === win.hi ? win.hi - 1 : a);
  const first = edges[0];
  const last = edges[edges.length - 1];
  // Best placement first: the window's first label starts at its tick and its
  // last ends at it (so neither is dragged off its line by clamping); an
  // interior label is centred, then starts at its tick, then ends at it.
  const candidatesOf = (a: number): LabelBox[] => {
    const w = labelOf(a).length * glyph;
    const x = xOf(a);
    const inside = (x0: number): LabelBox => {
      const c = clamp(x0, 0, Math.max(width - w, 0));
      return { x0: c, x1: c + w };
    };
    const centred = inside(x - w / 2);
    const starts = inside(x);
    const ends = inside(x - w);
    if (a === first) return [starts, centred];
    if (a === last) return [ends, centred];
    return [centred, starts, ends];
  };
  const placed = stackEdgeLabels(edges, candidatesOf, TICK_GAP_PX);
  return edges.map((address) => {
    const at = placed.get(address);
    const fallback = candidatesOf(address)[0];
    const box = at?.box ?? fallback;
    return {
      address,
      x: (box.x0 + box.x1) / 2,
      lineX: xOf(address),
      label: labelOf(address),
      labelled: at !== undefined,
      row: at?.row ?? null,
      x0: box.x0,
      x1: box.x1,
      isEnd: address === win.hi,
    };
  });
}
