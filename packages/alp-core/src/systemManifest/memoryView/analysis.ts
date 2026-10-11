// SPDX-License-Identifier: Apache-2.0
//
// Derives extents, apertures and conflicts from built spans and regions (#484).

import type {
  MemoryAperture,
  MemoryConflict,
  MemoryRegion,
  MemorySpan,
} from "./types";

/** The absolute half-open range an extent occupies, or null for a point. */
export function extentOf(span: MemorySpan): { lo: number; hi: number } | null {
  if (span.base === null || span.sizeBytes === null || span.sizeBytes <= 0) {
    return null;
  }
  return { lo: span.base, hi: span.base + span.sizeBytes };
}

/** The device-relative half-open range of a partition, or null. */
export function deviceExtentOf(
  span: MemorySpan,
): { lo: number; hi: number } | null {
  if (
    span.deviceOffset === null ||
    span.sizeBytes === null ||
    span.sizeBytes <= 0
  ) {
    return null;
  }
  return { lo: span.deviceOffset, hi: span.deviceOffset + span.sizeBytes };
}

export const intersects = (
  a: { lo: number; hi: number },
  b: { lo: number; hi: number },
): boolean => a.lo < b.hi && b.lo < a.hi;

/**
 * Every pair of placed extents that share addresses.
 *
 * Half-open throughout: a region ending exactly where the next begins is the
 * normal adjacency of a partition table, not a conflict. A zero-size extent is
 * skipped rather than reported — `extentOf` refuses it — because a blocked
 * entry's `size: 0` projection would otherwise pair with everything at its base.
 */
export function findConflicts(spans: MemorySpan[]): MemoryConflict[] {
  const out: MemoryConflict[] = [];
  const sized = spans.filter((s) => extentOf(s) !== null);
  const points = spans.filter(
    (s) => s.kind === "slot_image" && s.base !== null && s.sizeBytes === null,
  );

  for (let i = 0; i < sized.length; i += 1) {
    const a = extentOf(sized[i]) as { lo: number; hi: number };
    for (let j = i + 1; j < sized.length; j += 1) {
      const b = extentOf(sized[j]) as { lo: number; hi: number };
      if (!intersects(a, b)) continue;
      out.push({
        id: `overlap:${sized[i].label}:${sized[j].label}`,
        kind: "overlap",
        first: sized[i].label,
        second: sized[j].label,
        from: Math.max(a.lo, b.lo),
        to: Math.min(a.hi, b.hi),
        device: null,
      });
    }
    for (const point of points) {
      const at = point.base as number;
      if (at < a.lo || at >= a.hi) continue;
      out.push({
        id: `covers_load_address:${sized[i].label}:${point.label}`,
        kind: "covers_load_address",
        first: sized[i].label,
        second: point.label,
        from: at,
        to: at,
        device: null,
      });
    }
  }

  // Partitions are compared only against siblings in the SAME device: two
  // offsets in different devices are two different address spaces, and pairing
  // them would invent a collision out of arithmetic.
  const byDevice = new Map<string, MemorySpan[]>();
  for (const span of spans) {
    if (span.kind !== "partition" || span.device === null) continue;
    if (deviceExtentOf(span) === null) continue;
    byDevice.set(span.device, [...(byDevice.get(span.device) ?? []), span]);
  }
  for (const [device, list] of byDevice) {
    for (let i = 0; i < list.length; i += 1) {
      const a = deviceExtentOf(list[i]) as { lo: number; hi: number };
      for (let j = i + 1; j < list.length; j += 1) {
        const b = deviceExtentOf(list[j]) as { lo: number; hi: number };
        if (!intersects(a, b)) continue;
        out.push({
          id: `device_overlap:${device}:${list[i].label}:${list[j].label}`,
          kind: "device_overlap",
          first: list[i].label,
          second: list[j].label,
          from: Math.max(a.lo, b.lo),
          to: Math.min(a.hi, b.hi),
          device,
        });
      }
    }
  }
  return out;
}

/** A region's own absolute extent, or null when it does not resolve one —
 *  the same half-open shape `extentOf` gives a span. */
export function regionExtentOf(
  region: MemoryRegion,
): { lo: number; hi: number } | null {
  if (region.status !== "ok" || region.base === null) return null;
  if (region.sizeBytes === null || region.sizeBytes <= 0) return null;
  return { lo: region.base, hi: region.base + region.sizeBytes };
}

/**
 * The one finding that reads both `spans` and `regions`: a resolved
 * carve-out whose `carve_out_region` names exactly one resolved region,
 * and whose extent that region does not fully contain. Worded as the
 * manifest's own numbers disagreeing, not as a collision — rendered by
 * the webview's `OutsideRegionNotice`, its own component with its own
 * heading, never through `Conflicts`/`CONFLICT_TITLE`'s collision framing.
 *
 * "Exactly one": a region name shared by two or more rows is ambiguous, so
 * this join refuses it rather than guessing which one the carve-out meant.
 * Never emitted for an unresolved, sizeless or absent region either — there
 * is nothing to compare the carve-out's extent against.
 */
export function findOutsideRegion(
  spans: MemorySpan[],
  regionRows: MemoryRegion[],
): MemoryConflict[] {
  const byName = new Map<string, MemoryRegion[]>();
  for (const region of regionRows) {
    byName.set(region.name, [...(byName.get(region.name) ?? []), region]);
  }

  const out: MemoryConflict[] = [];
  for (const span of spans) {
    if (span.kind !== "carve_out" || span.region === null) continue;
    const extent = extentOf(span);
    if (extent === null) continue;

    const candidates = byName.get(span.region);
    if (!candidates || candidates.length !== 1) continue;
    const regionExtent = regionExtentOf(candidates[0]);
    if (regionExtent === null) continue;
    if (extent.lo >= regionExtent.lo && extent.hi <= regionExtent.hi) continue;

    out.push({
      id: `outside_region:${span.label}:${candidates[0].name}`,
      kind: "outside_region",
      first: span.label,
      second: candidates[0].name,
      from: extent.lo,
      to: extent.hi,
      device: null,
    });
  }
  return out;
}

/** The regions and devices the manifest names, each with what landed in it. */
export function findApertures(spans: MemorySpan[]): MemoryAperture[] {
  const out = new Map<string, MemoryAperture>();
  for (const span of spans) {
    const name = span.region ?? span.device;
    if (name === null) continue;
    const kind: MemoryAperture["kind"] =
      span.region !== null ? "region" : "device";
    const id = `${kind}:${name}`;
    const found: MemoryAperture = out.get(id) ?? {
      id,
      name,
      kind,
      members: [],
      hullBase: null,
      hullEnd: null,
    };
    found.members.push(span.label);
    const extent = extentOf(span);
    if (extent !== null) {
      found.hullBase =
        found.hullBase === null
          ? extent.lo
          : Math.min(found.hullBase, extent.lo);
      found.hullEnd =
        found.hullEnd === null ? extent.hi : Math.max(found.hullEnd, extent.hi);
    }
    out.set(id, found);
  }
  return [...out.values()];
}
