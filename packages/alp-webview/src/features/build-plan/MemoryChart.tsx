// SPDX-License-Identifier: Apache-2.0
//
// The memory map itself: one SVG, drawn from a d3 scale (#484).
//
// WHY SVG AND NOT CSS BOXES. The first cut built this out of absolutely
// positioned divs inside a flex column, and the rail carried `flex: 1` — whose
// `flex-basis: 0%` applies to HEIGHT in a column and silently beat the inline
// height the component set. The rail collapsed to 0px, `overflow: hidden` did
// the rest, and the panel rendered two axis labels beside an empty column. A
// chart whose geometry depends on the CSS box model can fail that way; one
// drawn into a fixed `viewBox` cannot. Every coordinate below is a number in
// that box, so the layout engine has no say in it.
//
// WHY d3-scale. `scaleLinear` is the address -> pixel mapping, `scaleBand` is
// the equalized mode, and `scale.invert()` is what turns a mouse Y into the
// address under the cursor. React owns the DOM throughout — d3 is used for the
// arithmetic only, never for selections, because two things mutating one tree
// is the classic way to make a chart that fights its own framework.
//
// WHAT IS NOT TAKEN FROM d3: the ticks. `scale.ticks()` produces
// decimal-friendly values (1, 2, 5 x 10^n), which in an address space means
// labels like 0x8004E200 that correspond to nothing. Memory is laid out in
// powers of two, so the ticks are too.

import { useState } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import type { MemoryAperture, MemorySpan, SliceSize } from "../../types";
import { formatAddress, formatBytes } from "./format";
import styles from "./MemoryChart.module.css";

/**
 * The drawing, in viewBox units. Fixed: the box is the contract.
 *
 * RAIL_X IS A GUTTER, NOT A MARGIN. The left axis labels are anchored `end` at
 * `RAIL_X - 8`, and an address is at least 10 mono glyphs at ~0.6em each, so
 * the gutter has to be at least 6x the tick label's font size. At the panel's
 * reading size (`--font-size-base`, 13px at the workbench default) that is 78
 * units, which the original 70-unit gutter could not hold — which is the whole
 * reason those labels used to be 10px.
 *
 * AT LEAST 10, because the pad in `formatAddress` is a FLOOR: it pads to eight
 * hex digits and does not truncate to them, so an address past 2^32 prints 11
 * glyphs (~86 units — still inside the gutter) and one past 2^36 prints 12
 * (~94 — not, overrunning the box's left edge by ~6). THE TWELFTH IS CLIPPED,
 * and silently. `.svg` sets `overflow: visible`, but that only stops the SVG
 * VIEWPORT from clipping: `.mapSide` (MemoryRegions.module.css) is now
 * `overflow-x: auto`, which makes it a scroll container, and a scroll
 * container clips its descendants' ink at its own padding box whatever the svg
 * says. Worse, ink past the INLINE-START edge is not in the scrollable
 * overflow region either, so no scrollbar reaches it: such a label would lose
 * most of the leading `0` of its `0x`, on the one screen whose digits are read
 * one at a time. (Ink past the opposite edge IS scrollable, which is why a
 * long band label below is only overprinted.) It cannot arise on what this
 * panel resolves today — MRAM and OCRAM bases come back as 0x0…/0x8…, all ten
 * glyphs — and a 64-bit A-core map is where it would; widening the gutter is
 * that change's job, not this one's.
 *
 * So RAIL_X moved 78 -> 96, making the gutter 88 units (good to ~14.6px), and
 * APERTURE_X, DETAIL_X and W moved by the same 18 units so that every gap to
 * the right of the rail is the one it already was: 6 units from the rail's
 * right edge to the first aperture bar, a 68-unit strip that still holds three
 * bars at `APERTURE_W + 14` pitch, and 104 units for the right-hand labels to
 * run into.
 *
 * RAIL_W AND DETAIL_W DID NOT MOVE, and the names that run inside them are why
 * that is a decision and not an oversight. A band label starts at `x + 5` and
 * runs inward over the remaining 143 units, which at base holds ~18 glyphs
 * where 10px held ~23 — a real loss of capacity, spent on nothing so far: the
 * longest name in the SDK's own emitted goldens is the default carve-out
 * `alp_default_rpmsg`, 17 glyphs and ~133 units, which stops ~10 units short
 * of the rail's edge; the core ids and partition names beside it are shorter
 * still. Past the rail's edge there is white space before anything (6 units to
 * the aperture strip, 8 to the right-hand addresses), and all of it is still
 * INSIDE the viewBox — the clipping above happens at the BOX's edge, not the
 * rail's — so an 18-glyph name has margin, a 19-glyph one spills into that
 * white, and a 20-glyph one overprints the aperture bar rather than being cut.
 * Widening the rails to buy glyphs nobody has spent is not free either: the
 * drawing now renders at its intrinsic size and its column scrolls, so every
 * unit added to W is a unit of horizontal scrolling for everyone.
 */
const W = 578;
const H = 300;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 258;
const RAIL_X = 96;
const RAIL_W = 148;
const APERTURE_X = 250;
const APERTURE_W = 9;
const DETAIL_X = 318;
const DETAIL_W = 148;
const CAPTION_Y = 282;

/**
 * The vertical room one tick label claims around its own middle baseline: a
 * generated mark closer than this to a window END is dropped rather than drawn.
 *
 * PINNED BY HAND, and it cannot be otherwise. The size it guards is
 * `.tickLabel`'s `var(--font-size-base)` — a custom property the webview's
 * stylesheet resolves against VS Code's own `--vscode-font-size`, which no
 * constant in this module can see. Reading it here would mean
 * `getComputedStyle` on a mounted <text> node: a layout read on every render,
 * answering nothing on the first paint, to serve a filter that runs before
 * there is a node to measure. So it is fitted instead — base is 13px at the
 * workbench default, an address label's ink is ~0.7em ≈ 9 units of that (hex
 * digits carry no descender), and 14 leaves ~5 units of white between two
 * marks. It was 11 while these labels were 10px.
 *
 * REVISIT IT WHENEVER `.tickLabel`'s TOKEN MOVES: nothing here follows the
 * token and no gate reddens when it changes. Erring high is safe — it only
 * drops generated marks that would have crowded a window end, and the two ends
 * themselves are never dropped. Erring low is not: two addresses print through
 * each other, on the one screen whose numbers are read digit by digit. On the
 * line-box model (~1.1x the font size) 14 stops covering a label once base
 * resolves past ~12.7px, so it is already fitted to the ink rather than to the
 * box.
 */
const TICK_LABEL_H = 14;

/**
 * Where a label's baseline sits relative to the edge it names.
 *
 * Both are fractions of TICK_LABEL_H, and deliberately so — not because it is
 * a line box, which it is not: it is the ink-fitted collision floor above,
 * ~9 units of ink plus ~5 of white. It is simply the one vertical measure this
 * module has that is pinned to the type, so deriving from it is what makes a
 * type change carry these two with it instead of leaving them behind. They
 * were bare `+12` and `-4`, fitted by eye to 10px text. Neither BROKE at base
 * (13px): a capital needs ~0.73em of ascent, ~9.5 units, and +12 still cleared
 * the band's top edge by ~2.5. What it lost was the optical gap — the label sat
 * visibly tighter under the edge than it had at 10px, where 12 cleared ~7.3 by
 * ~4.7. These constants buy that gap back and tie it to the type.
 *
 *  - BAND_LABEL_DY (1.1 floors -> 15) drops the baseline INSIDE the band: it
 *    clears the ~9.5-unit ascent by ~5.5, a little more than the ~4.7 the old
 *    +12 gave 10px text rather than the same.
 *  - LINE_LABEL_DY (0.35 of a floor -> -5) lifts it ABOVE a rule — the
 *    marker's line, and the hover readout's, which is the same case — by a
 *    descender (~0.18em, ~2.3 units) plus a gap, so a `p` in a name never
 *    touches the line it belongs to.
 *
 * A band shorter than its own label still overflows it, and the overflow is
 * not cut: an SVG shape clips nothing drawn after it, and the spill stays well
 * inside the viewBox, where nothing is lost — the scroll container described
 * above takes only what falls off the BOX's inline-start edge. That is the
 * same trade the rails make horizontally — a name printed over its neighbour
 * is ugly, a name cut short is a different name.
 */
const BAND_LABEL_DY = Math.round(TICK_LABEL_H * 1.1);
const LINE_LABEL_DY = -Math.round(TICK_LABEL_H * 0.35);

/**
 * Magnification of the detail rail, and so the fraction of the window it covers.
 *
 * Fixed, not fitted to the content. On the SoM this was designed against, the
 * band worth seeing — `reserved` + `storage` + the ATOC — is the top 256 KiB of
 * a 5632 KiB window, which is 1/22 of it. A magnification that chased the
 * content would move under the reader between two builds, and a ruler whose
 * scale moves cannot be compared with yesterday's.
 */
export const DETAIL_FACTOR = 22;

export interface Window {
  lo: number;
  hi: number;
}

/** Where a span's end lies, or null when the manifest pinned no size. */
export function endOf(span: MemorySpan): number | null {
  if (span.base === null || span.sizeBytes === null) return null;
  return span.base + span.sizeBytes;
}

/**
 * How far a slot image reaches, per `tan size`.
 *
 * The manifest pins where an image LOADS and says nothing about how much room
 * it has; `tan size` resolves that budget from SoM metadata and reports it as
 * `flash.total`. Measured on E1M-AEN801: 2.63 MiB for both M55 slices, which is
 * 2688 KiB — byte-for-byte the `he_slot0` / `hp_slot0` region size. So the
 * budget IS the slot. It is drawn dashed and labelled, never as a solid
 * manifest-pinned band: the base comes from the manifest and the extent from a
 * second tool, and a reader has to be able to tell which number came from where.
 */
export function budgetEnd(
  span: MemorySpan,
  budget: SliceSize | undefined,
): number | null {
  if (span.kind !== "slot_image" || span.base === null) return null;
  const total = budget?.flash.total;
  return typeof total === "number" && total > 0 ? span.base + total : null;
}

/**
 * The window the map covers: the lowest pinned base to the highest reach.
 * Null when fewer than two distinct addresses are known — one point is not a
 * range, and a ruler drawn across nothing invites the reader to measure
 * distances that were never measured.
 */
export function windowOf(
  spans: MemorySpan[],
  budgets: Map<string, SliceSize>,
): Window | null {
  const bases = spans.map((s) => s.base).filter((b): b is number => b !== null);
  if (bases.length === 0) return null;
  const ends = spans
    .flatMap((s) => [endOf(s) ?? s.base, budgetEnd(s, budgets.get(s.label))])
    .filter((e): e is number => e !== null);
  const lo = Math.min(...bases);
  const hi = Math.max(...ends);
  return hi > lo ? { lo, hi } : null;
}

/**
 * Tick addresses for a window: aligned to a power of two, never to a power of
 * ten.
 *
 * `scaleLinear.ticks()` would answer 0x8004E200 and friends — arithmetically
 * even, and meaningless as addresses. Memory is aligned in powers of two, so a
 * tick is a multiple of the largest 2^k that still yields at least `target`
 * marks. The window's own ends are always included: they are the two addresses
 * the drawing is actually bounded by.
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

interface RailProps {
  win: Window;
  spans: MemorySpan[];
  budgets: Map<string, SliceSize>;
  x: number;
  width: number;
  equalized: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  /** Which side of the rail the axis labels sit on. */
  axis: "left" | "right";
  caption: string;
  series: Map<string, number>;
}

/** One rail: frame, budgets, bands, markers, axis. */
function Rail({
  win,
  spans,
  budgets,
  x,
  width,
  equalized,
  selected,
  onSelect,
  axis,
  caption,
  series,
}: RailProps) {
  const [hover, setHover] = useState<number | null>(null);
  // High addresses at the top: the range is inverted, which is the whole
  // reason a scale object is worth having rather than a subtraction inline.
  const y = scaleLinear()
    .domain([win.lo, win.hi])
    .range([PLOT_BOTTOM, PLOT_TOP])
    .clamp(true);
  const band = scaleBand<string>()
    .domain([...spans].reverse().map((s) => s.id))
    .range([PLOT_TOP, PLOT_BOTTOM])
    .paddingInner(0.12);

  const topOf = (s: MemorySpan): number =>
    equalized ? (band(s.id) ?? PLOT_TOP) : y(endOf(s) ?? (s.base as number));
  const heightOf = (s: MemorySpan): number => {
    if (equalized) return band.bandwidth();
    const end = endOf(s);
    return end === null ? 0 : y(s.base as number) - y(end);
  };

  const labelX = axis === "left" ? x - 8 : x + width + 8;
  const tickX1 = axis === "left" ? x - 5 : x + width;
  const tickX2 = axis === "left" ? x : x + width + 5;

  return (
    <g>
      {/* The axis: the two window ends plus power-of-two marks between.
       *  A generated mark that lands within a label's height of an END is
       *  dropped rather than drawn — the ends are the addresses the drawing is
       *  bounded by, and two labels on top of each other name neither. */}
      {!equalized &&
        binaryTicks(win)
          .filter(
            (addr) =>
              addr === win.lo ||
              addr === win.hi ||
              (Math.abs(y(addr) - y(win.hi)) >= TICK_LABEL_H &&
                Math.abs(y(addr) - y(win.lo)) >= TICK_LABEL_H),
          )
          .map((addr) => (
            <g key={`tick-${addr}`}>
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
                textAnchor={axis === "left" ? "end" : "start"}
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

      {/* `tan size` budgets, behind everything the manifest pinned. */}
      {!equalized &&
        spans.map((s) => {
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
                data-series={series.get(seriesKey(s)) ?? 1}
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
        const h = heightOf(s);
        const top = topOf(s);
        const isMarker = h < 1;
        return (
          <g
            key={s.id}
            className={styles.hit}
            onClick={() => onSelect(s.id)}
            role="button"
            tabIndex={0}
            aria-label={`${s.label} at ${formatAddress(s.base)}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect(s.id);
            }}
          >
            {isMarker ? (
              // A pinned base with no size is a LINE. Giving it an invented
              // height would put a wall where the manifest gave a point.
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
                data-series={series.get(seriesKey(s)) ?? 1}
                x={x + 5}
                y={isMarker ? top + LINE_LABEL_DY : top + BAND_LABEL_DY}
              >
                {s.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Live address readout. This is what `scale.invert()` is for. */}
      {!equalized && (
        <rect
          className={styles.hover}
          x={x}
          y={PLOT_TOP}
          width={width}
          height={PLOT_BOTTOM - PLOT_TOP}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientY - box.top) / box.height;
            setHover(y.invert(PLOT_TOP + ratio * (PLOT_BOTTOM - PLOT_TOP)));
          }}
          onMouseLeave={() => setHover(null)}
        />
      )}
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
 * An aperture's own base and size are not in this contract; what is known is
 * which extents the resolver put inside it. So the bar spans the hull of its
 * members: "at least this much of it is in use", which is true, where a bar
 * drawn to a guessed extent would say how much is left, which nothing knows.
 */
function ApertureBar({
  aperture,
  win,
  x,
}: {
  aperture: MemoryAperture;
  win: Window;
  x: number;
}) {
  if (aperture.hullBase === null || aperture.hullEnd === null) return null;
  const y = scaleLinear()
    .domain([win.lo, win.hi])
    .range([PLOT_BOTTOM, PLOT_TOP])
    .clamp(true);
  const top = y(aperture.hullEnd);
  const height = Math.max(y(aperture.hullBase) - top, 2);
  return (
    <g>
      <rect
        className={styles.apertureBar}
        x={x}
        y={top}
        width={APERTURE_W}
        height={height}
      >
        <title>{`${aperture.name} — hull of ${aperture.members.join(", ")}`}</title>
      </rect>
      <text
        className={styles.apertureLabel}
        transform={`translate(${x + APERTURE_W - 1},${top + height / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        {aperture.name}
      </text>
    </g>
  );
}

export function MemoryChart({
  spans,
  apertures,
  budgets,
  equalized,
  selected,
  onSelect,
}: {
  spans: MemorySpan[];
  apertures: MemoryAperture[];
  budgets: Map<string, SliceSize>;
  equalized: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const placed = spans.filter((s) => s.base !== null);
  const win = windowOf(placed, budgets);
  if (!win) return null;

  // The top 1/DETAIL_FACTOR of the window, magnified by exactly that factor
  // because it is drawn at the same height.
  //
  // FLOORED, because this bound is printed as an address. `(hi - lo) / 22` is
  // almost never whole and `toString(16)` renders the remainder as hex digits
  // after a dot — `0x80291745.d` reached a real screen, which is the
  // wrong-address failure this view exists to prevent.
  const detailSpan = Math.max(1, Math.floor((win.hi - win.lo) / DETAIL_FACTOR));
  const detail: Window = { lo: win.hi - detailSpan, hi: win.hi };
  const inDetail = placed.filter((s) => {
    const reach =
      budgetEnd(s, budgets.get(s.label)) ?? endOf(s) ?? (s.base as number);
    return reach > detail.lo;
  });
  const regionApertures = apertures.filter(
    (a) => a.kind === "region" && a.hullBase !== null,
  );
  const series = seriesIndex(placed);
  const y = scaleLinear()
    .domain([win.lo, win.hi])
    .range([PLOT_BOTTOM, PLOT_TOP])
    .clamp(true);

  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={`Memory map from ${formatAddress(win.lo)} to ${formatAddress(win.hi)}`}
    >
      <Rail
        win={win}
        spans={placed}
        budgets={budgets}
        x={RAIL_X}
        width={RAIL_W}
        equalized={equalized}
        selected={selected}
        onSelect={onSelect}
        axis="left"
        caption={equalized ? "not to scale" : "true scale"}
        series={series}
      />

      {!equalized &&
        regionApertures.map((a, i) => (
          <ApertureBar
            key={a.id}
            aperture={a}
            win={win}
            x={APERTURE_X + i * (APERTURE_W + 14)}
          />
        ))}

      {!equalized && (
        <>
          {/* The magnified band, marked on the EDGE of the rail it came from
           *  and bracketed across to the rail that magnifies it — otherwise
           *  the second rail is a second picture with no stated relationship
           *  to the first. A box drawn around the band instead printed its
           *  outline through that band's own label. */}
          <line
            className={styles.detailMark}
            x1={RAIL_X + RAIL_W}
            x2={RAIL_X + RAIL_W}
            y1={y(detail.hi)}
            y2={y(detail.lo)}
          />
          <line
            className={styles.bracket}
            x1={RAIL_X + RAIL_W}
            y1={y(detail.hi)}
            x2={DETAIL_X}
            y2={PLOT_TOP}
          />
          <line
            className={styles.bracket}
            x1={RAIL_X + RAIL_W}
            y1={y(detail.lo)}
            x2={DETAIL_X}
            y2={PLOT_BOTTOM}
          />
          <Rail
            win={detail}
            spans={inDetail}
            budgets={budgets}
            x={DETAIL_X}
            width={DETAIL_W}
            equalized={false}
            selected={selected}
            onSelect={onSelect}
            axis="right"
            caption={`${DETAIL_FACTOR}× top ${formatBytes(detailSpan)}`}
            series={series}
          />
        </>
      )}
    </svg>
  );
}
