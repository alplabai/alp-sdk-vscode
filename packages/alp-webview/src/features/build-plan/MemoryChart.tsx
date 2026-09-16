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
// `layoutRail` (railScale.ts) replaces both rails with ONE: every declared
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
// WHAT IS NOT TAKEN FROM d3-scale (not used here any more): `scale.ticks()`
// would answer 0x8004E200 and friends — arithmetically even, and meaningless
// as addresses. `binaryTicks`, below, keeps the power-of-two rule for the
// computed, secondary marks between declared boundaries.

import { useState } from "react";
import type {
  MemoryAperture,
  MemoryRegion,
  MemorySpan,
  SliceSize,
} from "../../types";
import { tierOf } from "./authorityTier";
import { formatAddress, formatBytes } from "./format";
import styles from "./MemoryChart.module.css";
import { layoutRail, type RailLayout } from "./railScale";
import {
  budgetEnd,
  chartWindowOf,
  duplicatedNames,
  endOf,
  regionsInWindow,
  resolvedRegions,
  type ResolvedRegion,
  type Window,
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
 * AT LEAST 10, because the pad in `formatAddress` is a FLOOR: it pads to eight
 * hex digits and does not truncate to them, so an address past 2^32 prints 11
 * glyphs (~86 units — still inside the gutter) and one past 2^36 prints 12
 * (~94 — not, overrunning the box's left edge by ~6). `.svg` sets
 * `overflow: visible`, so that twelfth glyph is not clipped — it is painted
 * past the SVG's own left edge and, since Task 8 removed the one ancestor
 * that used to clip it there (`.chartScroll`'s `overflow-x: auto`,
 * MemoryRegions.module.css — this box now sits directly in `.mapSide`,
 * which sets no `overflow` of its own), it keeps going: such a label would
 * bleed past the whole panel's own left edge rather than losing its leading
 * `0x` to a scrollbar that never reaches it, on the one screen whose digits
 * are read one at a time. It cannot arise on what this panel resolves
 * today — MRAM and OCRAM bases come back as 0x0…/0x8…, all ten glyphs — and
 * a 64-bit A-core map is where it would; widening the gutter is that
 * change's job, not this one's.
 *
 * THE AUTHORITY GUTTER — a 6-unit tier swatch per resolved region, at
 * `RAIL_X - 10` — sits inside this same margin, between the tick labels and
 * the rail's own left edge. It overlaps the last one or two units of the
 * longest tick labels (those ending closest to `RAIL_X - 8`) rather than
 * widening the margin again: the swatch is a sparse, subtle tint or hatch,
 * present only where a region actually resolves, and drawn after the ticks
 * so it never hides a digit outright. Moving it clear of every label would
 * cost the same horizontal budget RAIL_X already spends carefully — see
 * MemoryChart.module.css's `.gutter` comment for the geometry.
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
 * RAIL_W IS 148, and the names that run inside it are why that width is a
 * decision and not an oversight. A band label starts at `x + 5` and runs
 * inward over the remaining 143 units, which at base holds ~18 glyphs, one
 * more than the longest name in the SDK's own emitted goldens: the default
 * carve-out `alp_default_rpmsg`, 17 glyphs and ~133 units, which stops ~10
 * units short of the rail's edge; the core ids and partition names beside it
 * are shorter still. Past the rail's edge there is white space before
 * anything (6 units to the aperture strip, 8 to the right-hand addresses),
 * and all of it is still INSIDE the viewBox — the clipping above happens at
 * the BOX's edge, not the rail's — so an 18-glyph name has margin, a
 * 19-glyph one spills into that white, and a 20-glyph one overprints the
 * aperture bar rather than being cut. Widening RAIL_W to buy glyphs nobody
 * has spent is not free either, and Task 8 leaves that decision alone: it is
 * still a hand-edit, not something a wider measured box does on its own —
 * the measured width only grows or shrinks the margin past the rail.
 */
const FALLBACK_WIDTH = 578;
const H = 300;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 258;
const RAIL_X = 96;
const RAIL_W = 148;
const APERTURE_X = 250;
const APERTURE_W = 9;
const CAPTION_Y = 282;

/**
 * The vertical room one tick label claims around its own middle baseline: a
 * generated mark closer than this to a DECLARED boundary is dropped rather
 * than drawn.
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
 * drops computed marks that would have crowded a declared boundary, and a
 * declared boundary itself is never dropped. Erring low is not: two
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
 * Tick addresses for a window: aligned to a power of two, never to a power of
 * ten.
 *
 * `scaleLinear.ticks()` would answer 0x8004E200 and friends — arithmetically
 * even, and meaningless as addresses. Memory is aligned in powers of two, so a
 * tick is a multiple of the largest 2^k that still yields at least `target`
 * marks. The window's own ends are always included: they are the two
 * addresses the drawing is actually bounded by — and are also always among
 * the DECLARED boundaries `Rail` draws separately (below), so a caller never
 * sees them twice.
 */
export function binaryTicks(win: Window, target = 4): number[] {
  const span = win.hi - win.lo;
  if (span <= 0) return [win.lo];
  let step = 2 ** Math.floor(Math.log2(span / Math.max(target, 1)));
  if (step < 1) step = 1;
  const out: number[] = [];
  const first = Math.ceil(win.lo / step) * step;
  for (let a = first; a <= win.hi && out.length < 64; a += step) out.push(a);
  if (out[0] !== win.lo) out.unshift(win.lo);
  if (out[out.length - 1] !== win.hi) out.push(win.hi);
  return out;
}

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

/**
 * Every declared address a rail's piecewise scale must land on exactly, and
 * the intervals something actually occupies — the two arguments
 * `layoutRail` (railScale.ts) turns into a piecewise `y(address)`.
 *
 * A DECLARED address is a span's base, a span's own end, a slot image's
 * `tan size` budget end, or a resolved region's own lo/hi — never a
 * `binaryTicks`-computed value, which is arithmetic convenience, not a fact
 * about anything real. `occupied` is built from the SAME sources as
 * `boundaries`, by construction: every occupied interval's own lo/hi is
 * pushed into `boundaries` in the same pass, which is what keeps
 * `layoutRail`'s own invariant (every occupied endpoint appears in
 * boundaries) true without a second, easy-to-drift bookkeeping pass.
 *
 * A span with a base but no size (a marker) contributes its base to
 * `boundaries` but no interval to `occupied` — a point has no width to
 * compress or to keep from compressing, and its surrounding run is decided
 * by whatever else covers that space.
 */
function railBoundaries(
  spans: MemorySpan[],
  budgets: Map<string, SliceSize>,
  regions: ResolvedRegion[],
): { boundaries: number[]; occupied: Array<{ lo: number; hi: number }> } {
  const boundaries: number[] = [];
  const occupied: Array<{ lo: number; hi: number }> = [];
  for (const s of spans) {
    if (s.base === null) continue;
    boundaries.push(s.base);
    const end = endOf(s);
    if (end !== null) {
      boundaries.push(end);
      occupied.push({ lo: s.base, hi: end });
    }
    const bEnd = budgetEnd(s, budgets.get(s.label));
    if (bEnd !== null) {
      boundaries.push(bEnd);
      occupied.push({ lo: s.base, hi: bEnd });
    }
  }
  for (const r of regions) {
    boundaries.push(r.lo, r.hi);
    occupied.push({ lo: r.lo, hi: r.hi });
  }
  return { boundaries, occupied };
}

/**
 * A "torn edge" across the rail's width, marking a run of address space the
 * piecewise scale compressed rather than drew to scale. Ten teeth regardless
 * of `width`, so the mark reads the same at every rail width this panel
 * draws — a jagged rule is a convention read by its SHAPE, not by counting
 * its teeth.
 */
function zigzagPath(x: number, yMid: number, width: number): string {
  const teeth = 10;
  const amplitude = 3;
  const step = width / teeth;
  const points: string[] = [];
  for (let i = 0; i <= teeth; i++) {
    const px = x + i * step;
    const py = yMid + (i % 2 === 0 ? -amplitude : amplitude);
    points.push(`${i === 0 ? "M" : "L"}${px},${py}`);
  }
  return points.join(" ");
}

interface RailProps {
  win: Window;
  layout: RailLayout;
  spans: MemorySpan[];
  budgets: Map<string, SliceSize>;
  x: number;
  width: number;
  selected: string | null;
  onSelect: (id: string) => void;
  caption: string;
  series: Map<string, number>;
  regions: ResolvedRegion[];
  /** Null when nothing is selected, OR when the selected region's name is
   *  shared by two or more rows — a duplicated name is refused here, not
   *  just in the table, so a click on either duplicate row never
   *  highlights both this gutter and the aperture bar of the same name.
   *  Distinct from `selected` (the raw id), which spans still match
   *  directly — only a region gutter/aperture match is name-based and so
   *  is the one that needs this refusal. */
  selectedRegionName: string | null;
}

/** The one rail: axis, gaps, the authority gutter, budgets, bands, the live
 *  readout. `layout` is computed once in `MemoryChart` and shared with
 *  `ApertureBar` — two independently-rounded scales would let an aperture
 *  bar drift out of alignment with the band it hulls. */
function Rail({
  win,
  layout,
  spans,
  budgets,
  regions,
  selectedRegionName,
  x,
  width,
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
  // actually drew. A tick here can only ever land where a real span, budget
  // or region begins or ends.
  const boundaryAddrs = [
    ...new Set(layout.segments.flatMap((s) => [s.lo, s.hi])),
  ].sort((a, b) => a - b);
  const boundaryYs = boundaryAddrs.map((a) => y(a));

  // Computed, power-of-two marks for orientation only, dropped wherever they
  // would land within a label's height of a DECLARED boundary — rendered one
  // register down, in secondary ink, so a computed mark can never be
  // mistaken for one.
  const interiorTicks = binaryTicks(win).filter((addr) => {
    const pos = y(addr);
    return boundaryYs.every((by) => Math.abs(pos - by) >= TICK_LABEL_H);
  });

  return (
    <g>
      {boundaryAddrs.map((addr) => (
        <g key={`tick-${addr}`} data-tick="boundary">
          <line
            className={styles.tick}
            x1={tickX1}
            x2={tickX2}
            y1={y(addr)}
            y2={y(addr)}
          />
          <text
            className={styles.tickLabel}
            x={labelX}
            y={y(addr)}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {formatAddress(addr)}
          </text>
        </g>
      ))}

      {interiorTicks.map((addr) => (
        <g key={`tick-minor-${addr}`} data-tick="interior">
          <line
            className={styles.tickMinor}
            x1={tickX1}
            x2={tickX2}
            y1={y(addr)}
            y2={y(addr)}
          />
          <text
            className={styles.tickLabelMinor}
            x={labelX}
            y={y(addr)}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {formatAddress(addr)}
          </text>
        </g>
      ))}

      <rect
        className={styles.railFrame}
        x={x}
        y={PLOT_TOP}
        width={width}
        height={PLOT_BOTTOM - PLOT_TOP}
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
                {label}
              </text>
            </g>
          );
        })}

      {/* The SoM's own region table (#484 phase 2), as a thin authority-tier
       *  gutter immediately left of the rail — never a frame drawn behind
       *  the bands. Decorative, like `AuthoritySwatch`: the region's exact
       *  name and authority class are read from the table, one interaction
       *  away; this strip carries only the three-tier vocabulary (solid /
       *  half-tone / hatch) so tiers can be scanned at a glance. */}
      {regions.map(({ region, lo, hi }) => {
        const top = y(hi);
        const height = Math.max(y(lo) - top, 1);
        return (
          <rect
            key={`gutter-${region.id}`}
            className={styles.gutter}
            data-tier={tierOf(region.authorityClass)}
            data-selected={selectedRegionName === region.name || undefined}
            x={x - 10}
            width={6}
            y={top}
            height={height}
          />
        );
      })}

      {/* `tan size` budgets, dashed: the base is the manifest's own, the
       *  extent is a second tool's measurement. */}
      {spans.map((s) => {
        const end = budgetEnd(s, budgets.get(s.label));
        if (end === null || s.base === null) return null;
        const top = y(end);
        return (
          <g key={`budget-${s.id}`}>
            <rect
              className={styles.budget}
              data-series={series.get(seriesKey(s)) ?? 1}
              data-selected={selected === s.id || undefined}
              x={x + 1}
              y={top}
              width={width - 2}
              height={Math.max(y(s.base) - top, 1)}
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
        return (
          // No `role`/`tabIndex`: selection is driven from the table, one
          // interaction away. `onClick` stays for mouse convenience only —
          // a mouse-only affordance makes no keyboard claim.
          <g key={s.id} className={styles.hit} onClick={() => onSelect(s.id)}>
            {isMarker ? (
              <line
                className={styles.marker}
                data-series={series.get(seriesKey(s)) ?? 1}
                x1={x}
                x2={x + width}
                y1={top}
                y2={top}
              />
            ) : (
              <rect
                className={styles.band}
                data-series={series.get(seriesKey(s)) ?? 1}
                data-selected={selected === s.id || undefined}
                x={x + 1}
                y={top}
                width={width - 2}
                height={Math.max(h, 1)}
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

      {/* Live address readout. */}
      <rect
        className={styles.hover}
        x={x}
        y={PLOT_TOP}
        width={width}
        height={PLOT_BOTTOM - PLOT_TOP}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientY - box.top) / box.height;
          setHover(
            layout.addressAt(PLOT_TOP + ratio * (PLOT_BOTTOM - PLOT_TOP)),
          );
        }}
        onMouseLeave={() => setHover(null)}
      />
      {hover !== null && (
        <g pointerEvents="none">
          <line
            className={styles.hoverLine}
            x1={x}
            x2={x + width}
            y1={y(hover)}
            y2={y(hover)}
          />
          <text
            className={styles.hoverLabel}
            x={x + width - 5}
            y={y(hover) + LINE_LABEL_DY}
            textAnchor="end"
          >
            {formatAddress(Math.floor(hover))}
          </text>
        </g>
      )}

      <text
        className={styles.caption}
        x={x + width / 2}
        y={CAPTION_Y}
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
 * left as a follow-up (see the task report), not done here.
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
  // table — no producer new enough, or a SoM the resolver has nothing to
  // say about — passes nothing and gets exactly the pre-region chart, with
  // no window growth and no gutter drawn.
  regions?: MemoryRegion[];
  /** The caller's OWN measured chart-column width (`MemoryRegions.tsx`'s
   *  `ResizeObserver`), in the same units the caller's CSS box resolves to.
   *  This component never measures itself — see the width docblock above
   *  for why a caller that cannot measure, or has not yet, still gets a
   *  real drawing rather than one 0 units wide. */
  width: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  // Never the caller's raw number verbatim: a momentary 0 — unmeasured, or a
  // test harness with no real layout at all — would draw a rail 0 units
  // wide, a silent failure rather than the honest pre-Task-8 default.
  const chartWidth = width > 0 ? width : FALLBACK_WIDTH;
  const placed = spans.filter((s) => s.base !== null);
  const resolved = resolvedRegions(regions);
  // Grown to a fixpoint over every resolved region that intersects or
  // touches the spans' own window — computed once in `chartWindowOf`, the
  // same call `MemoryRegions.tsx` makes for the table's "outside this
  // map's window" note, so the two can never disagree about where the
  // window ends.
  const win = chartWindowOf(spans, budgets, regions);
  if (!win) return null;

  const regionsInMain = regionsInWindow(win, resolved);
  const regionApertures = apertures.filter(
    (a) => a.kind === "region" && a.hullBase !== null,
  );
  const series = seriesIndex(placed);

  // ONE piecewise layout, shared by the rail and every aperture bar beside
  // it — see `Rail`'s own doc comment for why building this twice would be
  // a drift risk, not just duplicated work.
  const { boundaries, occupied } = railBoundaries(
    placed,
    budgets,
    regionsInMain,
  );
  const layout = layoutRail(win, boundaries, PLOT_TOP, PLOT_BOTTOM, occupied);

  // A selected REGION (id `memory:<name>`) also highlights the aperture of
  // the same name — a different id namespace (`region:<name>`), so this is
  // a name match, not an id match. Refused (set to null) when that name is
  // shared by two or more rows in the FULL region list (not just the
  // resolved ones in `win`) — the same join `duplicatedNames` refuses in
  // the table, computed the same way here so the gutter, this aperture
  // highlight and the table row all refuse the identical set of names.
  const rawSelectedRegionName =
    selected !== null && selected.startsWith("memory:")
      ? selected.slice("memory:".length)
      : null;
  const duplicatedRegionNames = duplicatedNames(regions);
  const selectedRegionName =
    rawSelectedRegionName !== null &&
    duplicatedRegionNames.has(rawSelectedRegionName)
      ? null
      : rawSelectedRegionName;

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${chartWidth} ${H}`}
      width={chartWidth}
      height={H}
      role="img"
      aria-label={`Memory map from ${formatAddress(win.lo)} to ${formatAddress(win.hi)}`}
    >
      <defs>
        {/* The "unproven" tier's hatch: a solid/half-tone/hatch vocabulary
         *  shared with `AuthoritySwatch`, drawn here as a `<pattern>` because
         *  SVG `fill` takes a paint reference, never a CSS
         *  `repeating-linear-gradient()`. Defined once and referenced by
         *  `styles.gutter[data-tier="unproven"]`'s `fill: url(#...)`. */}
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
        win={win}
        layout={layout}
        spans={placed}
        budgets={budgets}
        regions={regionsInMain}
        selectedRegionName={selectedRegionName}
        x={RAIL_X}
        width={RAIL_W}
        selected={selected}
        onSelect={onSelect}
        caption="piecewise scale"
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
