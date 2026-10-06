// SPDX-License-Identifier: Apache-2.0
//
// The strip's pure geometry: which addresses a piecewise scale must land on,
// and which edge labels fit beside each other.
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

/**
 * Which edge labels to print. Every edge keeps its tick LINE; a LABEL is
 * omitted when it would sit closer than `minSpacing` to one already kept,
 * so 0x80550000 / 0x80560000 / 0x80578000 / 0x80580000 never overprint into
 * one unreadable smear. The window's own two ends are kept first — they
 * bound the drawing — then every other edge in address order.
 *
 * `positionOf` is whatever axis the caller lays the edges along; the strip
 * passes its clamped label centre so two labels pinned to the same end of
 * the strip are measured where they are actually drawn.
 */
export function thinEdgeLabels(
  addrs: readonly number[],
  positionOf: (address: number) => number,
  minSpacing: number,
): Set<number> {
  if (addrs.length === 0) return new Set();
  const ends = [addrs[0], addrs[addrs.length - 1]];
  const kept: number[] = [];
  const keptAddrs = new Set<number>();
  for (const a of [...ends, ...addrs]) {
    if (keptAddrs.has(a)) continue;
    const p = positionOf(a);
    if (kept.every((k) => Math.abs(k - p) >= minSpacing)) {
      keptAddrs.add(a);
      kept.push(p);
    }
  }
  return keptAddrs;
}
