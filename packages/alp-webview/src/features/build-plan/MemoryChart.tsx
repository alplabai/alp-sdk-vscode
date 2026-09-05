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

/** The drawing, in viewBox units. Fixed: the box is the contract. */
const W = 560;
const H = 300;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 258;
const RAIL_X = 78;
const RAIL_W = 148;
const APERTURE_X = 232;
const APERTURE_W = 9;
const DETAIL_X = 300;
const DETAIL_W = 148;
const CAPTION_Y = 282;

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
              (Math.abs(y(addr) - y(win.hi)) >= 11 &&
                Math.abs(y(addr) - y(win.lo)) >= 11),
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
                y={top + 12}
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
                y={isMarker ? top - 4 : top + 12}
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
            y={y(hover) - 4}
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
