// SPDX-License-Identifier: Apache-2.0
//
// The rail's piecewise address-to-pixel layout.
//
// A linear rail cannot show a 32 KiB region and a 4 GiB one at once, which
// is the problem the old fixed 22x second rail was invented for and did not
// solve — it drew an empty box on one SoM and a copy of the main rail on
// another. Here the rail stays one picture and the SCALE breaks instead:
// runs of address space nothing occupies compress to a fixed height and are
// marked, so the compression is announced rather than silent.
//
// The honest cost, stated here and repeated in the legend: this rail is no
// longer a proportional ruler. Its ORDER and its BOUNDARIES are exact; its
// heights are not. Exact sizes live in the table, digit by digit.

import type { Window } from "./regionWindow";

/** An empty run compresses to this many CSS pixels. */
export const GAP_PX = 12;

/** Every extent-bearing segment gets at least this many CSS pixels before
 *  the remaining height is shared out in proportion to bytes. */
export const MIN_EXTENT_PX = 8;

export interface Segment {
  lo: number;
  hi: number;
  kind: "extent" | "gap";
  /** Pixel top, in the same origin as `plotTop`. */
  top: number;
  height: number;
}

export interface RailLayout {
  segments: Segment[];
  /** Pixel y of an address. High addresses sit at the top. */
  yOf(address: number): number;
  /** The address at a pixel y — the piecewise inverse, for the readout. */
  addressAt(y: number): number;
}

/**
 * `boundaries` are the declared addresses this rail must land on exactly:
 * every extent's base and end, every budget end, and the window's own two
 * ends. They are sorted and de-duplicated here.
 *
 * `occupied` are the intervals something actually occupies. A segment no
 * interval covers is a `gap`. Passing none means "treat everything as
 * occupied", which is what a rail with a single extent wants.
 *
 * **Invariant:** Every `occupied` interval endpoint must appear in `boundaries`,
 * so a segment is either wholly within an `occupied` interval or wholly without.
 * When this invariant is violated, the overlap test below will mislabel a gap
 * as an extent (wasting visible space) rather than an extent as a gap (hiding
 * data silently). We choose the failure direction that makes the mistake obvious.
 */
export function layoutRail(
  win: Window,
  boundaries: number[],
  plotTop: number,
  plotBottom: number,
  occupied: Array<{ lo: number; hi: number }> = [],
): RailLayout {
  const marks = [...new Set([win.lo, win.hi, ...boundaries])]
    .filter((a) => a >= win.lo && a <= win.hi)
    .sort((a, b) => a - b);

  const raw: Array<{ lo: number; hi: number; kind: "extent" | "gap" }> = [];
  for (let i = 0; i + 1 < marks.length; i++) {
    const lo = marks[i];
    const hi = marks[i + 1];
    if (hi <= lo) continue;
    const isOccupied =
      occupied.length === 0
        ? true
        : occupied.some((o) => o.lo < hi && o.hi > lo);
    raw.push({ lo, hi, kind: isOccupied ? "extent" : "gap" });
  }
  if (raw.length === 0) raw.push({ lo: win.lo, hi: win.hi, kind: "extent" });

  const plotHeight = plotBottom - plotTop;
  const gapCount = raw.filter((s) => s.kind === "gap").length;
  const extents = raw.filter((s) => s.kind === "extent");
  const fixed = gapCount * GAP_PX + extents.length * MIN_EXTENT_PX;

  // When the fixed minimums exceed the plot height, squeeze proportionally to fit.
  const squeeze = fixed > plotHeight ? plotHeight / fixed : 1;
  const shareable = Math.max(plotHeight - fixed * squeeze, 0);
  const byteTotal = extents.reduce((n, s) => n + (s.hi - s.lo), 0) || 1;

  // Laid out from the BOTTOM up: the lowest address sits lowest.
  const segments: Segment[] = [];
  let cursor = plotBottom;
  for (const s of raw) {
    const height =
      s.kind === "gap"
        ? GAP_PX * squeeze
        : MIN_EXTENT_PX * squeeze + (shareable * (s.hi - s.lo)) / byteTotal;
    cursor -= height;
    segments.push({ ...s, top: cursor, height });
  }

  const find = (address: number): Segment =>
    segments.find((s) => address >= s.lo && address <= s.hi)!;

  return {
    segments,
    yOf(address: number): number {
      const clamped = Math.min(Math.max(address, win.lo), win.hi);
      const seg = find(clamped);
      const span = seg.hi - seg.lo || 1;
      return seg.top + seg.height * (1 - (clamped - seg.lo) / span);
    },
    addressAt(y: number): number {
      const clamped = Math.min(Math.max(y, plotTop), plotBottom);
      const seg =
        segments.find((s) => clamped >= s.top && clamped <= s.top + s.height) ??
        segments[segments.length - 1];
      const ratio = 1 - (clamped - seg.top) / (seg.height || 1);
      return Math.round(seg.lo + (seg.hi - seg.lo) * ratio);
    },
  };
}
