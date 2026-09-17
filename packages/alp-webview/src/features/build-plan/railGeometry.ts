// SPDX-License-Identifier: Apache-2.0
//
// The rail's pure geometry: what a piecewise scale must land on, and the
// mark that says a run was compressed.
//
// Extracted from `MemoryChart.tsx` when that file crossed its 800-line cap
// (#484 phase 4). Both functions below are arithmetic over the manifest's own
// numbers with no React and no DOM in them, which is the same reason
// `memoryTableRows.ts` was split out of `MemoryTable.tsx`: logic that decides
// WHICH addresses are real should be answerable on its own, not only through
// a jsdom render of the picture drawn from it.
//
// READ-ONLY, same as the rest of the feature:
// `test/memoryRegions.readOnly.test.js`'s VIEW_FILES covers this file too.

import type { MemorySpan, SliceSize } from "../../types";
import { budgetEnd, endOf, type ResolvedRegion } from "./regionWindow";

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

/**
 * A "torn edge" across the rail's width, marking a run of address space the
 * piecewise scale compressed rather than drew to scale. Ten teeth regardless
 * of `width`, so the mark reads the same at every rail width this panel
 * draws — a jagged rule is a convention read by its SHAPE, not by counting
 * its teeth.
 */
export function zigzagPath(x: number, yMid: number, width: number): string {
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
