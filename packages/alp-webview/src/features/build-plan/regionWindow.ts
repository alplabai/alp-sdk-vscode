// SPDX-License-Identifier: Apache-2.0
//
// The memory-region window helpers (#484 phase 2): pure address and pixel
// arithmetic, no React and no CSS import, so a table (MemoryTable.tsx)
// and the chart (MemoryChart.tsx) both pull from one place rather than
// drifting apart with two copies of the same rule. `Window`, `endOf`,
// `budgetEnd` and `windowOf` live here for the same reason: both
// `MemoryRegions.tsx` and `MemoryChart.tsx` need the window a manifest's
// spans cover, and `chartWindowOf` below is the one place that also grows
// it over resolved regions — the table's "outside this map's window" note
// and the chart's own drawn window read the identical computation, so the
// two can never drift the way two copies of the same three steps
// eventually do.

import type { MemoryRegion, MemorySpan, SliceSize } from "../../types";

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

/** A region's own resolved extent, paired with the row it came from — the
 *  shape both the window-growth rule and a rail's frame-drawing want, so
 *  neither re-derives `status === "ok"` + a positive size itself. */
export interface ResolvedRegion {
  region: MemoryRegion;
  lo: number;
  hi: number;
}

/** Every region that resolves an extent: `status: "ok"`, a base, and a
 *  positive size. An unresolved, sizeless or zero-size region draws no
 *  frame and cannot grow the window. */
export function resolvedRegions(regions: MemoryRegion[]): ResolvedRegion[] {
  const out: ResolvedRegion[] = [];
  for (const region of regions) {
    if (region.status !== "ok" || region.base === null) continue;
    if (region.sizeBytes === null || region.sizeBytes <= 0) continue;
    out.push({ region, lo: region.base, hi: region.base + region.sizeBytes });
  }
  return out;
}

/**
 * Grows a window, to a FIXPOINT, over every resolved region that
 * intersects or TOUCHES it — so a region ending exactly where the window
 * begins (the normal adjacency of a region table, not a gap) still pulls
 * the window's edge out to cover it, and the next region touching THAT new
 * edge is pulled in too, and so on until nothing moves. A region that
 * never intersects or touches the window through that whole process is
 * left out on purpose — the region table then says it is outside it.
 */
export function growWindowOverRegions(
  win: Window,
  regions: ResolvedRegion[],
): Window {
  let { lo, hi } = win;
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of regions) {
      if (r.lo > hi || r.hi < lo) continue;
      if (r.lo < lo) {
        lo = r.lo;
        changed = true;
      }
      if (r.hi > hi) {
        hi = r.hi;
        changed = true;
      }
    }
  }
  return { lo, hi };
}

/**
 * The single window computation both the chart and the table draw from:
 * the placed spans' own window (`windowOf`, on the `base !== null` subset),
 * grown over every region `resolvedRegions` resolves for this SoM. Null
 * when the spans alone pin no window — regions never CREATE one, only
 * widen one that already exists.
 *
 * Called once per render from each of `MemoryChart.tsx` and
 * `MemoryRegions.tsx` rather than each doing its own `windowOf` +
 * `resolvedRegions` + `growWindowOverRegions` in sequence: two copies of
 * the same three steps are exactly how the drawn window and the region
 * table's "outside this map's window" note would drift apart the moment
 * either copy was touched without the other.
 */
export function chartWindowOf(
  spans: MemorySpan[],
  budgets: Map<string, SliceSize>,
  regions: MemoryRegion[],
): Window | null {
  const placed = spans.filter((s) => s.base !== null);
  const rawWindow = windowOf(placed, budgets);
  if (!rawWindow) return null;
  return growWindowOverRegions(rawWindow, resolvedRegions(regions));
}

/** The resolved regions that actually intersect a window — what a rail
 *  draws a frame for. Strict intersection, not "touches": a region merely
 *  adjacent to the window has nothing to show and would draw a
 *  zero-height frame. */
export function regionsInWindow(
  win: Window,
  regions: ResolvedRegion[],
): ResolvedRegion[] {
  return regions.filter((r) => r.lo < win.hi && r.hi > win.lo);
}

/** Names shared by two or more rows. Selecting a region row sets `selected`
 *  to its id (`memory:<name>`) — for a duplicated name that id belongs to
 *  every row sharing it, so a click could highlight all of them at once
 *  unless the caller refuses the join. The single source of truth for that
 *  refusal: `MemoryTable.tsx` imports this instead of keeping its own
 *  copy, so the chart frame, the aperture bar and the table row all refuse
 *  the same names the same way. */
export function duplicatedNames(regions: MemoryRegion[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const region of regions) {
    if (seen.has(region.name)) dupes.add(region.name);
    seen.add(region.name);
  }
  return dupes;
}

/**
 * How many label-line steps a region's label must drop to stay clear of
 * every OTHER top already claiming its own row — a band's, a budget's, or
 * an earlier region's, in draw order. Returns one count per entry in
 * `regionTops`, aligned by index: the number of `otherTops` entries within
 * `tolerance` of it, plus the number of EARLIER `regionTops` entries
 * (lower index — the same array's own draw order) within `tolerance`.
 *
 * A region whose top matches nothing gets 0 and keeps today's baseline.
 * Two regions sharing a top — including a `composite` region nested over
 * another region at the same address — resolve too: index order IS draw
 * order regardless of nesting, so the later one always gets the deeper
 * level.
 */
export function regionLabelLevels(
  regionTops: number[],
  otherTops: number[],
  tolerance = 1,
): number[] {
  return regionTops.map((top, i) => {
    let level = 0;
    for (const other of otherTops) {
      if (Math.abs(other - top) <= tolerance) level++;
    }
    for (let j = 0; j < i; j++) {
      if (Math.abs(regionTops[j] - top) <= tolerance) level++;
    }
    return level;
  });
}
