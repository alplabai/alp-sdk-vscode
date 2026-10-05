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
import { formatBytes } from "./format";
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

/** The most glyphs a centred label holds inside the rail at base size
 *  (RAIL_W less a 5-unit pad each side, ~7.8 units per mono glyph). */
const RAIL_LABEL_MAX_GLYPHS = 17;

/**
 * The visible text of a compressed gap's label: the size as `formatBytes`
 * prints it when that fits inside the rail, else the exact hex size alone
 * (`0x47f70000 empty`) — exact either way, never a rounded figure on its
 * own. The full sentence stays in the gap's `<title>` and `aria-label`.
 */
export function gapText(bytes: number): string {
  const friendly = `${formatBytes(bytes)} empty`;
  if (friendly.length <= RAIL_LABEL_MAX_GLYPHS) return friendly;
  return `0x${bytes.toString(16)} empty`;
}

/**
 * Which edge labels to print. Every edge keeps its tick LINE; a LABEL is
 * omitted when it would sit closer than `labelHeight` (MemoryChart.tsx's TICK_LABEL_H) to one
 * already kept,
 * so 0x80550000 / 0x80560000 / 0x80578000 / 0x80580000 never stack into one
 * unreadable smear. The window's own two ends are kept first — they bound
 * the drawing — then every other edge in address order.
 */
export function thinEdgeLabels(
  addrs: readonly number[],
  yOf: (address: number) => number,
  labelHeight: number,
): Set<number> {
  if (addrs.length === 0) return new Set();
  const ends = [addrs[0], addrs[addrs.length - 1]];
  const keptYs: number[] = [];
  const kept = new Set<number>();
  for (const a of [...ends, ...addrs]) {
    if (kept.has(a)) continue;
    const y = yOf(a);
    if (keptYs.every((k) => Math.abs(k - y) >= labelHeight)) {
      kept.add(a);
      keptYs.push(y);
    }
  }
  return kept;
}

/** The names under an address: every placed span (or its `tan size` budget)
 *  and every resolved region whose half-open extent contains it — spans
 *  first, then regions, innermost (smallest) first within each. */
export function namesAt(
  address: number,
  spans: MemorySpan[],
  budgets: Map<string, SliceSize>,
  regions: ResolvedRegion[],
): string[] {
  const hits: Array<{ name: string; size: number; order: number }> = [];
  for (const s of spans) {
    if (s.base === null) continue;
    const reach = Math.max(
      endOf(s) ?? s.base,
      budgetEnd(s, budgets.get(s.label)) ?? s.base,
    );
    if (address >= s.base && address < reach) {
      hits.push({ name: s.label, size: reach - s.base, order: 0 });
    }
  }
  for (const r of regions) {
    if (address >= r.lo && address < r.hi) {
      hits.push({ name: r.region.name, size: r.hi - r.lo, order: 1 });
    }
  }
  hits.sort((a, b) => a.order - b.order || a.size - b.size);
  return [...new Set(hits.map((h) => h.name))];
}
