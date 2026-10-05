// SPDX-License-Identifier: Apache-2.0
//
// The rail's piecewise, LOG-OF-SIZE address-to-pixel layout.
//
// A linear rail cannot show a 32 KiB region and a 4 GiB one at once: on
// rpmsg-v2n `ddr_main` (4 GiB) would take the whole rail and `m33_tcm`
// (128 KiB) would be a hairline. So the rail is cut at every declared
// address into segments, kept in ADDRESS ORDER bottom to top, and each
// segment's HEIGHT grows with log2 of its SIZE:
//
//     height = a + b·log2(size_bytes)
//
// with `a` fixed so the smallest declared segment gets exactly
// MIN_EXTENT_PX (tall enough to hold a label) and `b` chosen so the
// segments fill the rail. Runs of address space nothing occupies compress
// to GAP_PX — always shorter than any declared segment — and are marked.
//
// NOT log(address). log2(0x80010000) - log2(0x80000000) is ~0.00004: a
// 64 KiB region at 2 GiB would vanish. Taking the log of each segment's
// own SIZE keeps every segment visible whatever address it sits at.
//
// Within a segment the mapping stays LINEAR, so `yOf` is monotonic across
// the whole rail and exact inside each segment — the hover readout and
// every tick land where their address says, segment by segment.
//
// The honest cost, stated here and repeated in the caption: this rail is no
// longer a proportional ruler. Its ORDER and its BOUNDARIES are exact; its
// heights are not. Exact sizes live in the table, digit by digit.

import type { Window } from "./regionWindow";

/** An empty run compresses to this many CSS pixels — kept below
 *  MIN_EXTENT_PX so a gap always reads shorter than anything declared. */
export const GAP_PX = 10;

/** The smallest declared segment gets this many CSS pixels: enough to hold
 *  one label at the panel's reading size (a 13px glyph's ~9.5-unit ascent
 *  plus clearance), so a 32 KiB `atoc` stays readable beside a 4 GiB DDR. */
export const MIN_EXTENT_PX = 18;

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
  /** True when one pixel at `y` stands for at most one address, so
   *  `addressAt(y)` is exact rather than interpolated. */
  isExactAt(y: number): boolean;
}

type RawSegment = { lo: number; hi: number; kind: "extent" | "gap" };

/** The window cut at every declared boundary, each piece classified as an
 *  extent (something occupies it) or a gap. */
function rawSegments(
  win: Window,
  boundaries: number[],
  occupied: Array<{ lo: number; hi: number }>,
): RawSegment[] {
  const marks = [...new Set([win.lo, win.hi, ...boundaries])]
    .filter((a) => a >= win.lo && a <= win.hi)
    .sort((a, b) => a - b);

  const raw: RawSegment[] = [];
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
  return raw;
}

/**
 * The plot height (CSS pixels) this rail needs so that no segment is
 * squeezed below its floor — every extent at MIN_EXTENT_PX and every gap at
 * GAP_PX, plus `slack` for the log-proportional share. A caller that grows
 * its drawing to at least this keeps the floors intact however many
 * segments a manifest declares.
 */
export function railHeightNeeded(
  win: Window,
  boundaries: number[],
  occupied: Array<{ lo: number; hi: number }> = [],
  slack = 0,
): number {
  const raw = rawSegments(win, boundaries, occupied);
  const gaps = raw.filter((s) => s.kind === "gap").length;
  return gaps * GAP_PX + (raw.length - gaps) * MIN_EXTENT_PX + slack;
}

/** log2 of a segment's size, floored at 1 so a 1-byte segment still has a
 *  positive weight. */
const log2Size = (s: RawSegment): number => Math.log2(Math.max(s.hi - s.lo, 2));

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
  const raw = rawSegments(win, boundaries, occupied);

  const plotHeight = plotBottom - plotTop;
  const gapCount = raw.filter((s) => s.kind === "gap").length;
  const extents = raw.filter((s) => s.kind === "extent");
  const fixed = gapCount * GAP_PX + extents.length * MIN_EXTENT_PX;

  // When the fixed minimums exceed the plot height, squeeze proportionally
  // to fit — gaps and extents by the same factor, so a gap stays shorter.
  const squeeze = fixed > plotHeight ? plotHeight / fixed : 1;
  const shareable = Math.max(plotHeight - fixed * squeeze, 0);

  // a + b·log2(size): the smallest extent's weight is 1 (it gets the floor
  // plus a sliver), and every doubling of size adds one more unit of `b`.
  const minLog = Math.min(...extents.map(log2Size));
  const weightOf = (s: RawSegment): number => log2Size(s) - minLog + 1;
  const weightTotal = extents.reduce((n, s) => n + weightOf(s), 0) || 1;

  // Laid out from the BOTTOM up: the lowest address sits lowest.
  const segments: Segment[] = [];
  let cursor = plotBottom;
  for (const s of raw) {
    const height =
      s.kind === "gap"
        ? GAP_PX * squeeze
        : MIN_EXTENT_PX * squeeze + (shareable * weightOf(s)) / weightTotal;
    cursor -= height;
    segments.push({ ...s, top: cursor, height });
  }

  const find = (address: number): Segment =>
    segments.find((s) => address >= s.lo && address <= s.hi)!;
  const segmentAtY = (y: number): Segment => {
    const clamped = Math.min(Math.max(y, plotTop), plotBottom);
    return (
      segments.find((s) => clamped >= s.top && clamped <= s.top + s.height) ??
      segments[segments.length - 1]
    );
  };

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
      const seg = segmentAtY(clamped);
      const ratio = 1 - (clamped - seg.top) / (seg.height || 1);
      // Clamped to the window's LAST BYTE: `win.hi` is exclusive, so the
      // top pixel must never read one byte past the last region.
      return Math.min(
        Math.round(seg.lo + (seg.hi - seg.lo) * ratio),
        win.hi - 1,
      );
    },
    isExactAt(y: number): boolean {
      const seg = segmentAtY(y);
      return seg.hi - seg.lo <= seg.height;
    },
  };
}
