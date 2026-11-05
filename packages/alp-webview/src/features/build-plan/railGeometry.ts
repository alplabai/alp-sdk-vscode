// SPDX-License-Identifier: Apache-2.0
//
// The strip's pure geometry: which addresses a piecewise scale must land on,
// and where each edge label sits.
//
// Both functions are arithmetic over the manifest's own numbers with no React
// and no DOM in them, for the same reason `memoryRows.ts` is separate from the
// component that renders it: logic that decides WHICH addresses are real
// should be answerable on its own, not only through a jsdom render of the
// picture drawn from it.
//
// READ-ONLY, same as the rest of the feature:
// `test/memoryRegions.readOnly.test.js` covers this file too.

import type { MemorySpan, SliceSize } from "../../types";
import { budgetEnd, endOf, type ResolvedRegion } from "./regionWindow";

/**
 * Every declared address a strip's piecewise scale must land on exactly, and
 * the intervals something actually occupies — the two arguments
 * `layoutRail` (railScale.ts) turns into a piecewise position function.
 *
 * A DECLARED address is a span's base, a span's own end, a slot image's
 * `tan size` budget end, or a resolved region's own lo/hi — never a computed
 * power-of-two mark, which is arithmetic convenience, not a fact about
 * anything real. `occupied` is built from the SAME sources as `boundaries`,
 * by construction: every occupied interval's own lo/hi is pushed into
 * `boundaries` in the same pass, which is what keeps `layoutRail`'s own
 * invariant (every occupied endpoint appears in boundaries) true without a
 * second, easy-to-drift bookkeeping pass.
 *
 * A span with a base but no size (a marker) contributes its base to
 * `boundaries` but no interval to `occupied` — a point has no width to
 * compress or to keep from compressing, and its surrounding run is decided
 * by whatever else covers that space.
 */
export function railBoundaries(
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

/** How many staggered rows the axis labels may use (three: at the 640px
 * fallback width the last four AEN801 edges need all three). */
export const AXIS_ROWS = 3;

/** A label's horizontal extent, in strip pixels. */
export interface LabelBox {
  x0: number;
  x1: number;
}

/**
 * Where each edge label goes. Every edge keeps its tick LINE; its LABEL goes
 * on the first (row, placement) where it clears every label already on that
 * row by `minGap`. `candidatesOf` lists the placements an edge accepts, best
 * first — the strip offers centred, then starting at the tick, then ending
 * at it, so a label crowded against a strip end anchors to its tick instead
 * of being pushed off it. A row is tried with every placement before the next
 * row, so neighbours stagger before they slide. Only an edge that fits no
 * placement on any row is dropped (absent from the result).
 *
 * The window's own two ends are placed first — they bound the drawing — then
 * every other edge in address order.
 */
export function stackEdgeLabels(
  addrs: readonly number[],
  candidatesOf: (address: number) => readonly LabelBox[],
  minGap: number,
  rows: number = AXIS_ROWS,
): Map<number, { row: number; box: LabelBox }> {
  const out = new Map<number, { row: number; box: LabelBox }>();
  if (addrs.length === 0) return out;
  const taken: LabelBox[][] = Array.from({ length: rows }, () => []);
  const clears = (row: number, b: LabelBox): boolean =>
    taken[row].every((t) => b.x1 + minGap <= t.x0 || b.x0 >= t.x1 + minGap);
  const ends = [addrs[0], addrs[addrs.length - 1]];
  for (const a of [...ends, ...addrs]) {
    if (out.has(a)) continue;
    const candidates = candidatesOf(a);
    search: for (let row = 0; row < rows; row++) {
      for (const box of candidates) {
        if (!clears(row, box)) continue;
        taken[row].push(box);
        out.set(a, { row, box });
        break search;
      }
    }
  }
  return out;
}
