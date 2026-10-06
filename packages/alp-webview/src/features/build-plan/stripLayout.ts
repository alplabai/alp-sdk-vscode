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
import { railBoundaries, thinEdgeLabels } from "./railGeometry";
import { layoutRail } from "./railScale";
import {
  budgetEnd,
  chartWindowOf,
  duplicatedNames,
  endOf,
  regionsLargestFirst,
  resolvedRegions,
  type Window,
} from "./regionWindow";
import { slotUsageOf, usedFillLength } from "./slotUsage";

/** What the strip draws at before its column has been measured, and what
 *  it keeps drawing at when the measurement answers 0 (no `ResizeObserver`,
 *  or one that has not fired yet) — never a strip 0 pixels wide. */
export const FALLBACK_STRIP_WIDTH = 640;

/** The series palette wraps after this many placed spans
 *  (`--chart-1` … `--chart-6` in tokens.css). */
export const SERIES_COUNT = 6;

/** Glyph width of the strip's monospace tick labels at the panel's reading
 *  size, plus the clearance two neighbouring labels keep. A tick label is
 *  at least ten glyphs (`0x80010000`); the longest one the strip prints
 *  decides the spacing, so no two labels ever overprint. */
const TICK_GLYPH_PX = 7.8;
const TICK_GAP_PX = 10;

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
  /** Printed only for the edges `thinEdgeLabels` kept; every edge keeps its
   *  line. */
  labelled: boolean;
}

export interface StripModel {
  width: number;
  window: Window;
  segments: StripSegment[];
  regions: StripRegion[];
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
): StripModel | null {
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
  // Largest first, so a region nested in another (V2N's `m33_tcm` inside
  // `ddr_main`) is drawn after its container and wins the click.
  const stripRegions: StripRegion[] = regionsLargestFirst(resolved).map((r) => {
    const left = xOf(r.lo);
    return {
      id: r.region.id,
      name: r.region.name,
      left,
      width: xOf(r.hi) - left,
      tier: tiered ? tierOf(r.region.authorityClass) : null,
      selectable: !dupes.has(r.region.name),
      title: `${r.region.name} · ${formatRange(r.lo, r.hi)} · ${formatBytes(r.hi - r.lo)}`,
    };
  });

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
    stripSpans.push({
      id: span.id,
      name: span.label,
      left,
      width: spanWidth,
      series: series.get(span.label) ?? 1,
      usedPx,
      marker: reach === null,
      title:
        reach !== null
          ? `${span.label} · ${formatRange(span.base, reach)} · ${formatBytes(reach - span.base)}`
          : `${span.label} · ${formatAddress(span.base)} · size not pinned`,
    });
  }

  const ticks = buildTicks(segments, win, width, xOf);
  return {
    width,
    window: win,
    segments,
    regions: stripRegions,
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
): StripTick[] {
  const edges = [...new Set(segments.flatMap((s) => [s.lo, s.hi]))].sort(
    (a, b) => a - b,
  );
  const labelOf = (a: number): string =>
    formatAddress(a === win.hi ? win.hi - 1 : a);
  const longest = Math.max(...edges.map((a) => labelOf(a).length));
  const labelWidth = longest * TICK_GLYPH_PX;
  const centreOf = (a: number): number =>
    clamp(xOf(a), labelWidth / 2, width - labelWidth / 2);
  const labelled = thinEdgeLabels(edges, centreOf, labelWidth + TICK_GAP_PX);
  return edges.map((address) => ({
    address,
    x: centreOf(address),
    lineX: xOf(address),
    label: labelOf(address),
    labelled: labelled.has(address),
  }));
}
