// SPDX-License-Identifier: Apache-2.0
//
// The memory-region window helpers (#484 phase 2): pure address and pixel
// arithmetic, no React and no CSS import, so a table (MemoryTable.tsx)
// and the chart (MemoryChart.tsx) both pull from one place rather than
// drifting apart with two copies of the same rule. `Window`, `endOf`,
// `budgetEnd` and `chartWindowOf` live here for the same reason: both
// `MemoryRegions.tsx` and `MemoryChart.tsx` need the window a manifest's
// spans and regions cover, and `chartWindowOf` below is the one place that
// computes it — the table's "outside this map's window" note and the chart's
// own drawn window read the identical computation, so the two can never
// drift the way two copies of the same steps eventually do.

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

/** A region's own resolved extent, paired with the row it came from — the
 *  shape both the window computation and a rail's region bands want, so
 *  neither re-derives `status === "ok"` + a positive size itself. */
export interface ResolvedRegion {
  region: MemoryRegion;
  lo: number;
  hi: number;
}

/** Every region that resolves an extent: `status: "ok"`, a base, and a
 *  positive size. An unresolved, sizeless or zero-size region draws no
 *  band and contributes no extent to the window. */
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
 * The single window computation both the chart and the table draw from: the
 * UNION of every declared address — each placed span's base and end, each
 * slot image's `tan size` budget end, and each resolved region's own extent.
 * Regions do not merely widen a window the spans already pinned: they CREATE
 * one, so a manifest whose spans pin fewer than two addresses still gets a
 * rail as long as one region resolves. And no resolved region is ever left
 * out because it sits far from the spans (V2N's `ddr_main` at 0x48000000,
 * 4 GiB): the piecewise scale (railScale.ts) compresses the empty run between
 * them and marks it, rather than this window dropping the region.
 *
 * Null only when fewer than two distinct addresses are known — one point is
 * not a range.
 *
 * Called from both `MemoryChart.tsx` and `MemoryRegions.tsx`, so the window
 * the chart draws and the one the table measures "outside" against can never
 * drift apart.
 */
export function chartWindowOf(
  spans: MemorySpan[],
  budgets: Map<string, SliceSize>,
  regions: MemoryRegion[],
): Window | null {
  const addresses = declaredAddresses(spans, budgets, regions);
  if (addresses.length === 0) return null;
  const lo = Math.min(...addresses);
  const hi = Math.max(...addresses);
  return hi > lo ? { lo, hi } : null;
}

/** Every address the memory view declares that has an extent: span bases
 *  and ends, budget ends, resolved region extents — what the window is the
 *  union of. */
function declaredAddresses(
  spans: MemorySpan[],
  budgets: Map<string, SliceSize>,
  regions: MemoryRegion[],
): number[] {
  const out: number[] = [];
  for (const s of spans) {
    if (s.base === null) continue;
    out.push(s.base);
    const end = endOf(s);
    if (end !== null) out.push(end);
    const bEnd = budgetEnd(s, budgets.get(s.label));
    if (bEnd !== null) out.push(bEnd);
  }
  for (const r of resolvedRegions(regions)) out.push(r.lo, r.hi);
  return out;
}

/** Resolved regions, largest extent first — the rail's draw order. SVG
 *  paints later siblings on top, so a nested region (V2N's `m33_tcm`
 *  inside `ddr_main`) is drawn after its container and wins the click,
 *  whatever order the manifest listed them in. Returns a new array. */
export function regionsLargestFirst(
  regions: readonly ResolvedRegion[],
): ResolvedRegion[] {
  return [...regions].sort((a, b) => b.hi - b.lo - (a.hi - a.lo));
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
