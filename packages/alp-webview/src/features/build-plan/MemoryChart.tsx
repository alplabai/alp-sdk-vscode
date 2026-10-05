// SPDX-License-Identifier: Apache-2.0
//
// The memory map itself: one SVG, one rail, drawn on a PIECEWISE scale (#484
// phase 4).
//
// UNTIL THIS TASK THE MAP WAS TWO RAILS: a true-scale one and a second, fixed
// at a 22x magnification of whatever sat in the window's top 1/22. That
// second rail solved nothing it was invented for — it drew an empty box on
// E1M-AEN801 (nothing worth magnifying fell in that slice), a near-exact copy
// of the main rail on rpmsg-v2n (the whole window already fit inside 22x),
// and held no customer-writable span at all on rpmsg-aen. It also floored a
// fraction into an address bound — `0x80291746` was really `0x80291745.82`,
// rounded silently away — on the one screen whose digits are read one at a
// time.
//
// `layoutRail` (railScale.ts) replaces both rails with ONE, its segment
// heights growing with log2 of each segment's SIZE: every declared
// address (a span's base and end, a budget's end, a resolved region's own
// extent) lands exactly where it says, and every run neither a span nor a
// region occupies compresses to a fixed height and is MARKED as compressed —
// never silently drawn to scale, and never silently dropped. The trade this
// makes and why it is the honest one is stated once, in railScale.ts's own
// header; this file only draws the result.
//
// WHY SVG AND NOT CSS BOXES. The first cut built this out of absolutely
// positioned divs inside a flex column, and the rail carried `flex: 1` —
// whose `flex-basis: 0%` applies to HEIGHT in a column and silently beat the
// inline height the component set. The rail collapsed to 0px, `overflow:
// hidden` did the rest, and the panel rendered two axis labels beside an
// empty column. A chart whose geometry depends on the CSS box model can fail
// that way; one drawn into a fixed `viewBox` cannot. Every coordinate below
// is a number in that box, so the layout engine has no say in it.
//
// TICKS ONLY AT SEGMENT EDGES. Under log-of-size heights (railScale.ts) a
// computed power-of-two mark between two declared boundaries would sit at a
// height that means nothing a reader can measure, so there are none: every
// tick is a declared edge, and an edge label closer than TICK_LABEL_H to one
// already drawn is omitted (its tick line stays) rather than overprinted.

import { useState } from "react";
import type {
  MemoryAperture,
  MemoryRegion,
  MemorySpan,
  SliceSize,
} from "../../types";
import { tierOf } from "./authorityTier";
import { formatAddress, formatBytes, formatRange } from "./format";
import styles from "./MemoryChart.module.css";
import {
  gapText,
  namesAt,
  railBoundaries,
  thinEdgeLabels,
  zigzagPath,
} from "./railGeometry";
import { layoutRail, railHeightNeeded, type RailLayout } from "./railScale";
import { RegionBands } from "./RegionBands";
import {
  budgetEnd,
  chartWindowOf,
  duplicatedNames,
  endOf,
  resolvedRegions,
  type ResolvedRegion,
  regionsLargestFirst,
} from "./regionWindow";

/**
 * The drawing, in viewBox units. Fixed: the box is the contract.
 *
 * RAIL_X IS A GUTTER, NOT A MARGIN. The left axis labels are anchored `end` at
 * `RAIL_X - 8`, and an address is at least 10 mono glyphs at ~0.6em each, so
 * the gutter has to be at least 6x the tick label's font size. At the panel's
 * reading size (`--font-size-base`, 13px — a constant VS Code injects into
 * every webview, tied to no setting) that floor is 78 units.
 *
 * AT LEAST 10, because the pad in `formatAddress` is a FLOOR. One view pads
 * an address past 2^32 keeps its natural width: V2N's `ddr_main` edge
 * 0x148000000 is 11 glyphs, ~86 units — still inside the gutter. A 12-glyph label (past 2^36) would overrun the box's left
 * edge unclipped (`.svg` sets `overflow: visible`); widening the gutter is
 * a 64-bit A-core map's job, not this one's.
 *
 * THE AUTHORITY GUTTER — a 6-unit tier swatch per resolved region, at
 * `RAIL_X - 10` — overlaps the last unit or two of the longest tick labels
 * rather than widening the margin again; it is drawn after the ticks so it
 * never hides a digit outright.
 *
 * RAIL_X is 96, an 88-unit gutter (good to ~14.6px) that clears the 78-unit
 * floor above with margin. APERTURE_X is a literal, not an expression of
 * RAIL_X — move RAIL_X and it must move with it by hand — and together they
 * set the gaps to the right of the rail: 6 units from the rail's right edge
 * to the first aperture bar, a strip that holds three bars at
 * `APERTURE_W + 14` pitch, and whatever is left of the box's own width for
 * the right-hand margin.
 *
 * THE BOX'S OWN WIDTH IS MEASURED, NOT A LITERAL (Task 8). `MemoryRegions
 * .tsx` watches its own chart column with a `ResizeObserver` and hands the
 * live number down as this component's `width` prop; RAIL_X and RAIL_W stay
 * the SAME literals they already had, so every glyph-budget claim below
 * still holds at whatever width a caller reports — Task 8 changes the
 * MARGIN this box carries beyond the rail, never the rail itself.
 * `FALLBACK_WIDTH` (578, this file's pre-Task-8 constant) is what a first,
 * pre-measurement paint draws, and what a caller that measures 0 — no
 * `ResizeObserver` available, or one that has not fired yet — keeps drawing
 * at, rather than ever rendering a rail 0 units wide.
 *
 * RAIL_W IS 148: a band label starting at `x + 5` holds ~18 glyphs at base,
 * one more than the longest name in the SDK's own goldens
 * (`alp_default_rpmsg`, 17). A longer name spills into the white space past
 * the rail rather than being cut. Widening it is a hand-edit; the measured
 * width only grows or shrinks the margin past the rail.
 */
const FALLBACK_WIDTH = 578;
const PLOT_TOP = 18;
/** The rail's plot height when its segments' floors fit inside it. A
 *  manifest declaring more segments than fit grows the drawing instead
 *  (`railHeightNeeded`, railScale.ts), so no floor is ever squeezed. */
const MIN_PLOT_H = 240;
/** Room the log-proportional share keeps beyond the floors when the
 *  drawing has to grow. */
const PLOT_SLACK = 48;
/** Caption baseline below the plot, and the box's margin below that. */
const CAPTION_DY = 24;
const BOTTOM_MARGIN = 18;
const RAIL_X = 96;
const RAIL_W = 148;
const APERTURE_X = 250;
const APERTURE_W = 9;

/**
 * The vertical room one tick label claims around its own middle baseline: an
 * edge label closer than this to one already drawn is omitted (its tick line
 * stays), and a region label is held to the same room (RegionBands.tsx).
 *
 * PINNED BY HAND, and it cannot be otherwise. The size it guards is
 * `.tickLabel`'s `var(--font-size-base)` — a custom property the webview's
 * stylesheet resolves against VS Code's own `--vscode-font-size`, which no
 * constant in this module can see. Reading it here would mean
 * `getComputedStyle` on a mounted <text> node: a layout read on every render,
 * answering nothing on the first paint, to serve a filter that runs before
 * there is a node to measure. So it is fitted instead — base is 13px, a
 * constant VS Code ties to no setting (not `editor.fontSize`, which feeds
 * `--vscode-editor-font-size` instead) — an address label's ink is ~0.7em ≈ 9
 * units of that (hex digits carry no descender), and 14 leaves ~5 units of
 * white between two marks.
 *
 * REVISIT IT WHENEVER `.tickLabel`'s TOKEN MOVES: nothing here follows the
 * token and no gate reddens when it changes. Erring high is safe — it only
 * omits a label (the tick line, the band's title and the table still
 * carry the address). Erring low is not: two
 * addresses print through each other, on the one screen whose numbers are
 * read digit by digit. BAND_LABEL_DY and LINE_LABEL_DY below are pinned
 * separately, at the same base size, and do not move when this constant is
 * revised — revise all three together by hand.
 */
const TICK_LABEL_H = 14;

/**
 * Where a label's baseline sits relative to the edge it names.
 *
 * PINNED, not computed, fitted by hand to 13px text. No formula ties either
 * one to TICK_LABEL_H or to anything else in this module — revise all three
 * (this pair plus TICK_LABEL_H above) together by hand, and only together.
 *
 *  - BAND_LABEL_DY (15) drops the baseline INSIDE the band: it clears a
 *    capital's ~9.5-unit ascent by ~5.5.
 *  - LINE_LABEL_DY (-5) lifts it ABOVE a rule — the marker's line, and the
 *    hover readout's, which is the same case — by a descender (~0.18em, ~2.3
 *    units) plus a gap, so a `p` in a name never touches the line it belongs
 *    to.
 *
 * A band shorter than its own label still overflows it, and the overflow is
 * not cut: an SVG shape clips nothing drawn after it, and the spill stays
 * well inside the viewBox, where nothing is lost — see the width docblock
 * above for the one edge (the box's own inline-start) where that stops
 * being true.
 */
const BAND_LABEL_DY = 15;
const LINE_LABEL_DY = -5;
/** The hover readout's second line (the names under the pointer), below the
 *  rule: a capital's ascent plus a gap. */
const HOVER_NAME_DY = 14;

/**
 * The `<pattern>` id the "unproven" authority tier's hatch fill references
 * (MemoryChart.module.css's `.gutter[data-tier="unproven"]`). A literal, not
 * a generated id: this component mounts once per panel, so a fixed id costs
 * nothing today, and CSS Modules localize class names, never a `url(#...)`
 * reference — the two spellings have to match BY HAND, in this file and in
 * the stylesheet, because nothing ties them together automatically.
 */
const HATCH_PATTERN_ID = "memory-authority-hatch";

/**
 * What an extent BELONGS to, and therefore what colour it takes.
 *
 * A carve-out's home is the region the resolver allocated it from, a
 * partition's is its flash device, a slot image's is its own core. Two extents
 * in one region read as one colour, which is the thing worth seeing at a
 * glance: not "this is a carve-out" (the row list says so) but "these three
 * live in the same place".
 */
export function seriesKey(span: MemorySpan): string {
  if (span.kind === "carve_out") return span.region ?? span.label;
  if (span.kind === "partition") return span.device ?? span.label;
  return span.label;
}

/** Stable colour index per home, in address order, cycling through the palette. */
export function seriesIndex(spans: MemorySpan[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const span of spans) {
    const key = seriesKey(span);
    if (!out.has(key)) out.set(key, (out.size % 6) + 1);
  }
  return out;
}

interface RailProps {
  layout: RailLayout;
  spans: MemorySpan[];
  budgets: Map<string, SliceSize>;
  x: number;
  width: number;
  plotBottom: number;
  selected: string | null;
  onSelect: (id: string) => void;
  caption: string;
  series: Map<string, number>;
  regions: ResolvedRegion[];
  duplicated: ReadonlySet<string>;
  /** Null when nothing is selected, OR when the selected region's name is
   *  shared by two or more rows — a duplicated name is refused here, not
   *  just in the table, so a click on either duplicate row never
   *  highlights both this band and the aperture bar of the same name. */
  selectedRegionName: string | null;
}

/** The one rail: axis, gaps, the authority gutter, region bands, budgets,
 *  span bands, the live readout. `layout` is computed once in `MemoryChart`
 *  and shared with `ApertureBar` — two independently-rounded scales would
 *  let an aperture bar drift out of alignment with the band it hulls. */
function Rail({
  layout,
  spans,
  budgets,
  regions,
  duplicated,
  selectedRegionName,
  x,
  width,
  plotBottom,
  selected,
  onSelect,
  caption,
  series,
}: RailProps) {
  const [hover, setHover] = useState<number | null>(null);
  const y = layout.yOf;

  const labelX = x - 8;
  const tickX1 = x - 5;
  const tickX2 = x;

  // The DECLARED boundaries themselves — every segment edge `layoutRail`
  // actually drew. A tick can only ever land where a real span, budget or
  // region begins or ends.
  const boundaryAddrs = [
    ...new Set(layout.segments.flatMap((s) => [s.lo, s.hi])),
  ].sort((a, b) => a - b);
  const labelled = thinEdgeLabels(boundaryAddrs, y, TICK_LABEL_H);

  // Every span label's baseline, so a region label never lands on one.
  const spanLabelBaselines: number[] = [];
  for (const s of spans) {
    if (s.base === null) continue;
    const end = endOf(s);
    const bEnd = budgetEnd(s, budgets.get(s.label));
    if (bEnd !== null) spanLabelBaselines.push(y(bEnd) + BAND_LABEL_DY);
    if (end !== null && y(s.base) - y(end) >= 1) {
      spanLabelBaselines.push(y(end) + BAND_LABEL_DY);
    } else if (bEnd === null) {
      spanLabelBaselines.push(y(s.base) + LINE_LABEL_DY);
    }
  }

  // A gap's label sits just above its break mark; a region label must not
  // land on it either.
  for (const seg of layout.segments) {
    if (seg.kind === "gap") {
      spanLabelBaselines.push(seg.top + seg.height / 2 + LINE_LABEL_DY);
    }
  }

  const hoverNames =
    hover === null ? [] : namesAt(hover, spans, budgets, regions);
  const hoverExact = hover !== null && layout.isExactAt(y(hover));

  // THE READOUT'S POINTER TRACKING, on this component's root rather than on
  // the catcher rect below it. `.svg` (MemoryChart.module.css) overrides
  // neither width nor height, so the svg renders at exactly its own
  // `viewBox` size and a client offset inside it IS a viewBox coordinate.
  // jsdom computes no layout, so its zero-height box is a no-op here rather
  // than a wrong answer.
  return (
    <g
      onMouseMove={(e) => {
        const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
        if (!box || box.height === 0) return;
        const vx = e.clientX - box.left;
        const vy = e.clientY - box.top;
        if (vx < x || vx > x + width || vy < PLOT_TOP || vy > plotBottom) {
          setHover(null);
          return;
        }
        setHover(layout.addressAt(vy));
      }}
      onMouseLeave={() => setHover(null)}
    >
      {boundaryAddrs.map((addr) => (
        <g
          key={`tick-${addr}`}
          data-tick="boundary"
          data-address={formatAddress(addr)}
        >
          <line
            className={styles.tick}
            x1={tickX1}
            x2={tickX2}
            y1={y(addr)}
            y2={y(addr)}
          />
          {labelled.has(addr) && (
            <text
              className={styles.tickLabel}
              x={labelX}
              y={y(addr)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatAddress(addr)}
            </text>
          )}
        </g>
      ))}

      <rect
        className={styles.railFrame}
        x={x}
        y={PLOT_TOP}
        width={width}
        height={plotBottom - PLOT_TOP}
      />

      {/* A run neither a span nor a region occupies, compressed to a fixed
       *  height rather than drawn to scale — announced, not hidden: a
       *  zigzag rule plus exactly how much address space it stands for. */}
      {layout.segments
        .filter((seg) => seg.kind === "gap")
        .map((seg) => {
          const mid = seg.top + seg.height / 2;
          const label = `${formatBytes(seg.hi - seg.lo)} empty, compressed`;
          return (
            <g key={`gap-${seg.lo}`} data-segment="gap" aria-label={label}>
              <title>{label}</title>
              <path
                className={styles.gapZigzag}
                d={zigzagPath(x, mid, width)}
              />
              <text
                className={styles.gapLabel}
                x={x + width / 2}
                y={mid + LINE_LABEL_DY}
                textAnchor="middle"
              >
                {gapText(seg.hi - seg.lo)}
              </text>
            </g>
          );
        })}

      {/* The authority gutter: the same three-tier key as `AuthoritySwatch`,
       *  at full strength, immediately left of the rail — the high-contrast
       *  scan key the tinted bands inside the rail are too faint to be. */}
      {regions.map(({ region, lo, hi }, index) => {
        const top = y(hi);
        return (
          <rect
            key={`gutter-${index}-${region.id}-${lo}`}
            className={styles.gutter}
            data-tier={tierOf(region.authorityClass)}
            data-selected={selectedRegionName === region.name || undefined}
            x={x - 10}
            width={6}
            y={top}
            height={Math.max(y(lo) - top, 1)}
          />
        );
      })}

      {/* The pointer catcher for the live address readout, BELOW every
       *  clickable layer: SVG hit-tests the topmost painted element, so a
       *  band above it wins the click wherever one is, and this catches the
       *  pointer everywhere else. It carries no handlers of its own — the
       *  readout is driven from this component's root `<g>`. */}
      <rect
        className={styles.hover}
        x={x}
        y={PLOT_TOP}
        width={width}
        height={plotBottom - PLOT_TOP}
      />

      <RegionBands
        regions={regions}
        yOf={y}
        x={x}
        width={width}
        selectedRegionName={selectedRegionName}
        duplicated={duplicated}
        spanLabelBaselines={spanLabelBaselines}
        onSelect={onSelect}
      />

      {/* `tan size` budgets: the base is the manifest's own, the extent is
       *  a second tool's measurement. Clickable like the span itself. */}
      {spans.map((s) => {
        const end = budgetEnd(s, budgets.get(s.label));
        if (end === null || s.base === null) return null;
        const top = y(end);
        return (
          <g
            key={`budget-${s.id}`}
            className={styles.hit}
            onClick={() => onSelect(s.id)}
          >
            <title>{`${s.label} · ${formatRange(s.base, end)} · ${formatBytes(end - s.base)} · tan size`}</title>
            <rect
              className={styles.budget}
              data-series={series.get(seriesKey(s)) ?? 1}
              data-selected={selected === s.id || undefined}
              x={x + 3}
              y={top + 2}
              width={width - 6}
              height={Math.max(y(s.base) - top - 4, 1)}
            />
            <text
              className={styles.bandLabel}
              x={x + 5}
              y={top + BAND_LABEL_DY}
            >
              {s.label}
            </text>
          </g>
        );
      })}

      {spans.map((s) => {
        if (s.base === null) return null;
        const end = endOf(s);
        const top = y(end ?? s.base);
        // A pinned base with no size is a LINE. Giving it an invented
        // height would put a wall where the manifest gave a point.
        const h = end === null ? 0 : y(s.base) - y(end);
        const isMarker = h < 1;
        const isSelected = selected === s.id || undefined;
        return (
          // No `role`/`tabIndex`: selection is driven from the table, one
          // interaction away. `onClick` stays for mouse convenience only.
          <g
            key={s.id}
            className={styles.hit}
            data-span={s.label}
            onClick={() => onSelect(s.id)}
          >
            <title>
              {end !== null
                ? `${s.label} · ${formatRange(s.base, end)} · ${formatBytes(end - s.base)}`
                : `${s.label} · ${formatAddress(s.base)}`}
            </title>
            {isMarker ? (
              <line
                className={styles.marker}
                data-series={series.get(seriesKey(s)) ?? 1}
                data-selected={isSelected}
                x1={x}
                x2={x + width}
                y1={top}
                y2={top}
              />
            ) : (
              <rect
                className={styles.band}
                data-series={series.get(seriesKey(s)) ?? 1}
                data-selected={isSelected}
                x={x + 3}
                y={top + 2}
                width={width - 6}
                height={Math.max(h - 4, 1)}
              />
            )}
            {/* A budget band already carries this label; a marker sitting on
             *  its base would print it twice. */}
            {(isMarker
              ? budgetEnd(s, budgets.get(s.label)) === null
              : true) && (
              <text
                className={isMarker ? styles.markerLabel : styles.bandLabel}
                x={x + 5}
                y={isMarker ? top + LINE_LABEL_DY : top + BAND_LABEL_DY}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      })}

      {hover !== null && (
        <g pointerEvents="none" data-readout="">
          <line
            className={styles.hoverLine}
            x1={x}
            x2={x + width}
            y1={y(hover)}
            y2={y(hover)}
          />
          {/* "≈" whenever one pixel here stands for more than one address:
           *  the readout is then interpolated, not a declared figure. */}
          <text
            className={styles.hoverLabel}
            x={x + width - 5}
            y={y(hover) + LINE_LABEL_DY}
            textAnchor="end"
          >
            {`${hoverExact ? "" : "≈"}${formatAddress(Math.floor(hover))}`}
          </text>
          {hoverNames.length > 0 && (
            <text
              className={styles.hoverLabel}
              x={x + width - 5}
              y={y(hover) + HOVER_NAME_DY}
              textAnchor="end"
            >
              {hoverNames.join(" · ")}
            </text>
          )}
        </g>
      )}

      <text
        className={styles.caption}
        x={x + width / 2}
        y={plotBottom + CAPTION_DY}
        textAnchor="middle"
      >
        {caption}
      </text>
    </g>
  );
}

/**
 * One aperture as a bar beside the map — never as a band inside it.
 *
 * An aperture's own base and size are never READ here, even though the
 * contract can now carry them for a same-named row (the SoM region table):
 * what this bar draws from is only which extents the resolver put inside it.
 * So the bar still spans the hull of its members — "at least this much of it
 * is in use", which is true, where a bar drawn to a guessed extent would say
 * how much is left, which this function does not know and does not try to.
 *
 * `yOf` is `Rail`'s OWN piecewise mapping, passed down rather than rebuilt:
 * an aperture's hull and the band it hulls have to land on the same pixels,
 * and two independently-computed scales are how they would drift apart the
 * first time either one's boundary set changed without the other's.
 *
 * NO ROTATED LABEL. The bar used to carry its own name, drawn `rotate(-90)`
 * down its own APERTURE_W = 9-unit width — unreadable at that width, and on
 * rpmsg-v2n a THIRD simultaneous depiction of `ocram_low` (the region gutter
 * and the table both already name it). `aria-label` keeps the name reachable
 * without drawing it a third time; threading it into the table row itself is
 * left as a follow-up, not done here.
 */
function ApertureBar({
  aperture,
  yOf,
  x,
  selected,
}: {
  aperture: MemoryAperture;
  yOf: (address: number) => number;
  x: number;
  selected: boolean;
}) {
  if (aperture.hullBase === null || aperture.hullEnd === null) return null;
  const top = yOf(aperture.hullEnd);
  const height = Math.max(yOf(aperture.hullBase) - top, 2);
  const label = `${aperture.name} — hull of ${aperture.members.join(", ")}`;
  return (
    <rect
      className={styles.apertureBar}
      data-selected={selected || undefined}
      x={x}
      y={top}
      width={APERTURE_W}
      height={height}
      aria-label={label}
    >
      <title>{label}</title>
    </rect>
  );
}

export function MemoryChart({
  spans,
  apertures,
  budgets,
  regions = [],
  width,
  selected,
  onSelect,
}: {
  spans: MemorySpan[];
  apertures: MemoryAperture[];
  budgets: Map<string, SliceSize>;
  // OPTIONAL, defaulting to `[]`: a caller that never resolves a region
  // table passes nothing and gets a chart of its spans alone.
  regions?: MemoryRegion[];
  /** The caller's OWN measured chart-column width (`MemoryRegions.tsx`'s
   *  `ResizeObserver`). This component never measures itself — see the
   *  width docblock above for why a caller that cannot measure, or has not
   *  yet, still gets a real drawing rather than one 0 units wide. */
  width: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const chartWidth = width > 0 ? width : FALLBACK_WIDTH;
  const placed = spans.filter((s) => s.base !== null);
  const resolved = resolvedRegions(regions);
  // The union of every placed span, budget and resolved region — the same
  // call `MemoryRegions.tsx` makes, so the two never disagree about it.
  // Regions can CREATE the window: a chart renders with one resolved region
  // and no placed span at all.
  const win = chartWindowOf(spans, budgets, regions);
  if (!win) return null;

  const regionApertures = apertures.filter(
    (a) => a.kind === "region" && a.hullBase !== null,
  );
  const series = seriesIndex(placed);

  // ONE layout, shared by the rail and every aperture bar beside it.
  // Segment boundaries are the union of every edge, so a containing region
  // (V2N's `ddr_main` around `m33_tcm`) spans its sub-segments.
  const { boundaries, occupied } = railBoundaries(placed, budgets, resolved);
  const plotH = Math.max(
    MIN_PLOT_H,
    railHeightNeeded(win, boundaries, occupied, PLOT_SLACK),
  );
  const plotBottom = PLOT_TOP + plotH;
  const height = plotBottom + CAPTION_DY + BOTTOM_MARGIN;
  const layout = layoutRail(win, boundaries, PLOT_TOP, plotBottom, occupied);

  // A selected REGION (id `memory:<name>`) highlights its band and the
  // aperture of the same name — a name match, refused (null) when that
  // name is shared by two or more rows in the FULL region list, the same
  // set `duplicatedNames` refuses in the table.
  const rawSelectedRegionName =
    selected !== null && selected.startsWith("memory:")
      ? selected.slice("memory:".length)
      : null;
  const duplicated = duplicatedNames(regions);
  const selectedRegionName =
    rawSelectedRegionName !== null && duplicated.has(rawSelectedRegionName)
      ? null
      : rawSelectedRegionName;

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${chartWidth} ${height}`}
      width={chartWidth}
      height={height}
      role="img"
      aria-label={`Memory map from ${formatAddress(win.lo)} to ${formatAddress(win.hi - 1)}`}
    >
      <defs>
        {/* The "unproven" tier's hatch: SVG `fill` takes a paint reference,
         *  never a CSS `repeating-linear-gradient()`. Referenced by
         *  `.gutter[data-tier="unproven"]` and `.regionBand[data-tier=
         *  "unproven"]`'s `fill: url(#...)`. */}
        <pattern
          id={HATCH_PATTERN_ID}
          patternUnits="userSpaceOnUse"
          width={4}
          height={4}
          patternTransform="rotate(-45)"
        >
          <rect className={styles.hatchStroke} width={2} height={4} />
        </pattern>
      </defs>

      <Rail
        layout={layout}
        spans={placed}
        budgets={budgets}
        regions={regionsLargestFirst(resolved)}
        duplicated={duplicated}
        selectedRegionName={selectedRegionName}
        x={RAIL_X}
        width={RAIL_W}
        plotBottom={plotBottom}
        selected={selected}
        onSelect={onSelect}
        caption="log₂(size) scale"
        series={series}
      />

      {regionApertures.map((a, i) => (
        <ApertureBar
          key={a.id}
          aperture={a}
          yOf={layout.yOf}
          selected={selectedRegionName === a.name}
          x={APERTURE_X + i * (APERTURE_W + 14)}
        />
      ))}
    </svg>
  );
}
