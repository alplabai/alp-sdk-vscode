// SPDX-License-Identifier: Apache-2.0
//
// What the system manifest PINS in the address space, what it refuses to, and
// where two things it pinned land on top of each other (#484).
//
// ── Why this module is narrow ────────────────────────────────────────────────
//
// The SoM's own region table is not in the contract. `system-manifest-v1`
// declares eight root keys — `schema_version, generated_by, hw_info, slices,
// ipc, helper_mcus, boot_order, storage` — and none of them carries a region, a
// base or a size. Measured on the vendored copy, on the submodule copy and on
// alp-sdk `dev`; alp-sdk#1365 is the request that would add one. Reading
// `metadata/e1m_modules/<SKU>.yaml` from TypeScript instead is what the
// manifest's own description forbids ("Tools read THIS instead of re-deriving
// folder layout / build wiring from board.yaml + the SoM presets").
//
// So this module derives ONLY the extents the manifest already resolves, which
// is precisely the customer-owned half: the IPC carve-outs and the storage
// partitions the customer declared in `board.yaml`, plus the load address the
// emitter pins for each Zephyr slice. Everything else renders as absent, and
// absent is rendered as absent — never as zero.
//
// ── The key names are the EMITTER's, not the dataclass's ─────────────────────
//
// A resolved carve-out is written as `carve_out_base` / `carve_out_size` /
// `carve_out_region`, with the two addresses QUOTED HEX (`'0x00010000'`), and a
// resolved partition as `offset_kib` — verified against
// `alp_orchestrate/models.py`'s `to_manifest_entry` on alp-sdk v0.16.0-rc1 and
// against the SDK's own golden snapshots. The dataclass field names (`base`,
// `size`, `region`, `base_kib`) never reach the file. An earlier revision of
// this module read the dataclass names and so reported every RESOLVED entry as
// unresolved — the exact inversion, on the one screen whose job is to say where
// things landed. `test/fixtures/system-manifest.rpmsg-v2n.snap.yaml` is the
// SDK's own emitted output, vendored so the gate cannot drift back.
//
// A resolved entry carries NO `status` key at all; only a blocked one does.
// Absence therefore means resolved, and is treated that way.
//
// ── Why every field is narrowed rather than cast ─────────────────────────────
//
// `parseSystemManifest` casts `slices`, `ipc` and `storage` wholesale, which is
// right for a tolerant reader whose job is to carry unknown additive fields
// through. It is wrong here, because these values become ADDRESSES on a picture
// of memory. A cast lets `carve_out_base: "0x80540000"` through as a `number`,
// and arithmetic on a string silently produces a span that is off by an address
// space. The rule is DROP what does not match the shape, never coerce it, and
// never invent a replacement. That includes the ARRAY MEMBERS: a manifest
// caught mid-write can hand this module a null element, and the cast above will
// not stop it.

import type { SystemManifest } from "./models";

/**
 * What kind of thing occupies an extent.
 *
 *  - `slot_image`  the primary image slot a Zephyr slice loads into
 *                  (`slices[].flash_args.slot0_load_address`)
 *  - `carve_out`   a resolved IPC shared-memory carve-out (`ipc[]`)
 *  - `partition`   a resolved storage partition (`storage[]`)
 */
export type MemorySpanKind = "slot_image" | "carve_out" | "partition";

/** One extent the manifest pins, with the provenance to say where it came from. */
export interface MemorySpan {
  /** Stable render key. `<kind>:<label>`. */
  id: string;
  kind: MemorySpanKind;
  /** The carve-out / partition name, or the `core_id` for a slot image. */
  label: string;
  /**
   * Absolute base address, or `null` when the manifest pins no absolute one.
   *
   * A storage partition is always `null` here even when it fully resolves: the
   * emitter reports `offset_kib` as an offset WITHIN its flash device, and the
   * device's own base lives in the region table this contract does not carry.
   * Adding the two would require a base this extension cannot know, so the
   * offset is reported as an offset and the absolute address is left absent.
   */
  base: number | null;
  /** Offset within `device`, in bytes. Partitions only; `null` elsewhere. */
  deviceOffset: number | null;
  /** Extent in bytes, or `null` when the manifest pins a base but no size —
   *  which is the normal state of a slot image, whose capacity is a SoM budget
   *  the manifest does not carry. */
  sizeBytes: number | null;
  /** `carve_out_region`: the SoM region the resolver allocated from. */
  region: string | null;
  /** `flash_device`: the device this partition lives in. */
  device: string | null;
  /** Cores that reach this extent: a carve-out's endpoints, or a slot image's
   *  own core. Empty when the manifest names none. */
  cores: string[];
  /** Filesystem for a partition (`littlefs` / `fat` / `ext4` / `raw`). */
  fs: string | null;
}

/** One thing the customer declared that did NOT resolve to an extent. */
export interface MemoryUnresolved {
  id: string;
  kind: MemorySpanKind;
  label: string;
  cores: string[];
  /** The emitter's own status word (`blocked`, `degraded`, …), or
   *  `"unresolved"` when it stated none and the extent is missing anyway. */
  status: string;
  /** The resolver's sentence, VERBATIM and in full, or `null` when it gave
   *  none. It is the only actionable half — a summary of
   *  "memory_map.base is TBD for region 'mram_main' … Add a `memory_map:`
   *  block to metadata/e1m_modules/E1M-AEN801.yaml" tells the reader nothing. */
  reason: string | null;
}

/**
 * A region or flash device the manifest NAMES but does not describe.
 *
 * `carve_out_region` and `flash_device` say which aperture the resolver
 * allocated out of; the aperture's own base and size live in the SoM region
 * table, which this contract does not carry. So an aperture here is a name plus
 * the hull of what landed inside it — never the aperture's own extent. The
 * distinction matters on screen: a rail drawn to the hull says "at least this
 * much of it is in use", which is true, where a rail drawn to a guessed extent
 * would say how much is left, which nothing here knows.
 */
export interface MemoryAperture {
  id: string;
  /** The name the manifest gave it. */
  name: string;
  /** `region` for a `carve_out_region`, `device` for a `flash_device`. */
  kind: "region" | "device";
  /** Labels of the extents the resolver placed inside it, in map order. */
  members: string[];
  /** Lowest base among the members, or null when they are device-relative. */
  hullBase: number | null;
  /** Highest end among the members, or null for the same reason. */
  hullEnd: number | null;
}

/**
 *  - `overlap`              two sized extents share addresses
 *  - `covers_load_address`  a sized extent contains a slice's load address —
 *                           the shape of the ATOC incident (alp-sdk#1289): an
 *                           allocation landing on top of something already
 *                           living there, with nothing failing at build time
 *  - `device_overlap`       two partitions overlap inside one flash device
 */
export type MemoryConflictKind =
  | "overlap"
  | "covers_load_address"
  | "device_overlap";

/** Two extents the manifest placed on top of each other. */
export interface MemoryConflict {
  id: string;
  kind: MemoryConflictKind;
  /** The two labels, in map order — for `covers_load_address` the sized
   *  extent first, then the slice whose load address it covers. */
  first: string;
  second: string;
  /** The shared range, half-open: absolute addresses, or offsets in `device`.
   *  For `covers_load_address` both ends are the address itself. */
  from: number;
  to: number;
  /** The flash device both partitions live in; null for absolute conflicts. */
  device: string | null;
}

export interface MemoryView {
  /** `hw_info.sku`, so the view can name the part its addresses belong to. */
  sku: string;
  /** Resolved extents, ordered by base ascending; the ones with no absolute
   *  base last, then by label. Deterministic so a re-render never reshuffles. */
  spans: MemorySpan[];
  /** Declared-but-unresolved entries, in manifest order. */
  unresolved: MemoryUnresolved[];
  /** The regions and devices the manifest names, with what landed in each. */
  apertures: MemoryAperture[];
  /**
   * Extents the manifest placed on top of one another.
   *
   * Computed rather than trusted: the allocator's own overlap check runs only
   * against carve-outs already placed in the SAME region, so two extents that
   * reach one address by different routes — a pinned `ipc[].address:`, a
   * partition offset, a slice's load address — are compared nowhere upstream.
   * This is the one thing this view can say that the manifest does not.
   */
  conflicts: MemoryConflict[];
}

/** The status word for an entry that resolved to nothing and said nothing. */
const NO_STATUS = "unresolved";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A non-empty string, or null. Never a coerced number or a trimmed blank. */
function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A byte count: a safe, non-negative integer, or null.
 *
 * `Number.isSafeInteger` and not `isFinite`: a 64-bit address past 2^53 cannot
 * round-trip through a JS number, and a base that is off by a few bytes is
 * worse on this screen than one that is absent.
 */
function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * A hex-or-integer quantity, from either spelling the emitter uses.
 *
 * `carve_out_base` / `carve_out_size` and `flash_args.slot0_load_address` all
 * arrive QUOTED (`'0x00010000'`); `offset_kib` / `size_kib` arrive as YAML
 * integers. Both are accepted, nothing else is: a bare decimal string is
 * refused rather than parsed, since an unprefixed number in a field of hex is
 * more likely a mistake than a base-10 address.
 */
function asHexOrCount(value: unknown): number | null {
  if (typeof value === "number") return asCount(value);
  if (typeof value !== "string") return null;
  if (!/^0x[0-9a-fA-F]{1,16}$/.test(value)) return null;
  return asCount(Number(value));
}

/** The core ids a link names. Non-string members are dropped, not stringified. */
function asCores(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}

/** A status that is present and not `ok` — the same rule `unhealthyIpcLinks`
 *  applies, so the two surfaces cannot disagree about what "resolved" means.
 *  A resolved entry carries no `status` at all, so absence is not degraded. */
function isDegraded(status: string | null): boolean {
  return status !== null && status !== "ok";
}

/** Only the members that are objects. The cast in `parseSystemManifest` admits
 *  anything a YAML list can hold, including the `null` a half-written file
 *  yields at a `- ` boundary. */
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

/**
 * Slot images.
 *
 * Only slices that participate at all: an `os: "off"` core builds nothing, so
 * a load address on one would point at an image that does not exist. Size is
 * left null on purpose — the slot's capacity is a budget from the SoM, which
 * `tan size` reports separately and this contract does not carry.
 */
function slotSpans(slices: unknown): MemorySpan[] {
  const spans: MemorySpan[] = [];
  for (const slice of records(slices)) {
    const coreId = asText(slice.core_id);
    if (coreId === null || slice.os === "off") continue;
    const args = slice.flash_args;
    if (!isRecord(args)) continue;
    const base = asHexOrCount(args.slot0_load_address);
    if (base === null) continue;
    spans.push({
      id: `slot_image:${coreId}`,
      kind: "slot_image",
      label: coreId,
      base,
      deviceOffset: null,
      sizeBytes: null,
      region: null,
      device: null,
      cores: [coreId],
      fs: null,
    });
  }
  return spans;
}

/** IPC carve-outs, split into the ones that landed and the ones that did not. */
function carveOuts(manifest: SystemManifest): {
  spans: MemorySpan[];
  unresolved: MemoryUnresolved[];
} {
  const spans: MemorySpan[] = [];
  const unresolved: MemoryUnresolved[] = [];
  for (const link of records(manifest.ipc)) {
    const label = asText(link.name);
    if (label === null) continue;
    const cores = asCores(link.endpoints);
    const status = asText(link.status);
    const base = asHexOrCount(link.carve_out_base);
    const sizeBytes = asHexOrCount(link.carve_out_size);
    // A degraded link is unresolved whatever it carries, and a link that
    // states no status but pins no extent is unresolved too: the picture
    // cannot place it either way, and saying so is the honest half.
    if (isDegraded(status) || base === null || sizeBytes === null) {
      unresolved.push({
        id: `carve_out:${label}`,
        kind: "carve_out",
        label,
        cores,
        status: status ?? NO_STATUS,
        reason: asText(link.reason),
      });
      continue;
    }
    spans.push({
      id: `carve_out:${label}`,
      kind: "carve_out",
      label,
      base,
      deviceOffset: null,
      sizeBytes,
      region: asText(link.carve_out_region),
      device: null,
      cores,
      fs: null,
    });
  }
  return { spans, unresolved };
}

/**
 * Storage partitions.
 *
 * `storage` is typed `unknown[]` on the manifest because the schema declares
 * its items as bare objects, so every field is narrowed from scratch here. A
 * partition resolves when it has a size and an offset; its ABSOLUTE base stays
 * null even then, for the reason `MemorySpan.base` documents.
 */
function partitions(manifest: SystemManifest): {
  spans: MemorySpan[];
  unresolved: MemoryUnresolved[];
} {
  const spans: MemorySpan[] = [];
  const unresolved: MemoryUnresolved[] = [];
  for (const entry of records(manifest.storage)) {
    const label = asText(entry.name);
    if (label === null) continue;
    const status = asText(entry.status);
    const device = asText(entry.flash_device);
    const sizeKib = asCount(entry.size_kib);
    const offsetKib = asCount(entry.offset_kib);
    if (isDegraded(status) || sizeKib === null || offsetKib === null) {
      unresolved.push({
        id: `partition:${label}`,
        kind: "partition",
        label,
        cores: [],
        status: status ?? NO_STATUS,
        reason: asText(entry.reason),
      });
      continue;
    }
    spans.push({
      id: `partition:${label}`,
      kind: "partition",
      label,
      base: null,
      deviceOffset: offsetKib * 1024,
      sizeBytes: sizeKib * 1024,
      region: null,
      device,
      cores: [],
      fs: asText(entry.fs),
    });
  }
  return { spans, unresolved };
}

/** The absolute half-open range an extent occupies, or null for a point. */
function extentOf(span: MemorySpan): { lo: number; hi: number } | null {
  if (span.base === null || span.sizeBytes === null || span.sizeBytes <= 0) {
    return null;
  }
  return { lo: span.base, hi: span.base + span.sizeBytes };
}

/** The device-relative half-open range of a partition, or null. */
function deviceExtentOf(span: MemorySpan): { lo: number; hi: number } | null {
  if (
    span.deviceOffset === null ||
    span.sizeBytes === null ||
    span.sizeBytes <= 0
  ) {
    return null;
  }
  return { lo: span.deviceOffset, hi: span.deviceOffset + span.sizeBytes };
}

const intersects = (
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
function findConflicts(spans: MemorySpan[]): MemoryConflict[] {
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

/** The regions and devices the manifest names, each with what landed in it. */
function findApertures(spans: MemorySpan[]): MemoryAperture[] {
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

/** Ascending by base; the extents with no absolute base last, then by label. */
function byAddress(a: MemorySpan, b: MemorySpan): number {
  if (a.base === null && b.base === null) return a.label.localeCompare(b.label);
  if (a.base === null) return 1;
  if (b.base === null) return -1;
  if (a.base !== b.base) return a.base - b.base;
  return a.label.localeCompare(b.label);
}

/**
 * The address-space view of one manifest. Pure and TOTAL: no IO, no clock, no
 * `vscode`, and no input it can throw on — the caller reads a file that another
 * process is writing, and a throw there would leave the panel showing the
 * PREVIOUS build's manifest as current, which is the #470 failure class.
 *
 * Order of the unresolved list is manifest order — carve-outs then partitions,
 * each as the emitter wrote them — so a reader comparing this against
 * `build/system-manifest.yaml` by eye finds the rows where they expect them.
 */
export function buildMemoryView(manifest: SystemManifest): MemoryView {
  const ipc = carveOuts(manifest);
  const storage = partitions(manifest);
  const spans = [
    ...slotSpans(manifest.slices),
    ...ipc.spans,
    ...storage.spans,
  ].sort(byAddress);
  return {
    sku: asText(manifest.hw_info?.sku) ?? "",
    spans,
    unresolved: [...ipc.unresolved, ...storage.unresolved],
    apertures: findApertures(spans),
    conflicts: findConflicts(spans),
  };
}
