// SPDX-License-Identifier: Apache-2.0
//
// What the system manifest actually PINS in the address space, and what it
// refuses to (#484).
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
// ── Why every field is narrowed rather than cast ─────────────────────────────
//
// `parseSystemManifest` casts `ipc` and `storage` wholesale, which is right for
// a tolerant reader whose job is to carry unknown additive fields through. It
// is wrong here, because these values become ADDRESSES on a picture of memory.
// A cast lets `base: "0x80540000"` through as a `number`, and arithmetic on a
// string silently produces a span that is off by an address space. The rule is
// the one `narrowModelCoverage()` already applies elsewhere in this package:
// DROP what does not match the shape, never coerce it, and never invent a
// replacement. An extent this module cannot vouch for is reported as
// unresolved, which is a thing the UI can say out loud.

import type { ManifestSlice, SystemManifest } from "./models";

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
  /** Stable render key. `<kind>:<label>`, unique because names are unique
   *  within each block and `core_id` is unique across slices. */
  id: string;
  kind: MemorySpanKind;
  /** The carve-out / partition name, or the `core_id` for a slot image. */
  label: string;
  /**
   * Absolute base address, or `null` when the manifest pins no absolute one.
   *
   * A storage partition is always `null` here even when it fully resolves: the
   * emitter reports `base_kib` as an offset WITHIN its flash device, and the
   * device's own base lives in the region table this contract does not carry.
   * Adding the two would require a base this extension cannot know, so the
   * offset is reported as an offset and the absolute address is left absent.
   */
  base: number | null;
  /** Offset within `device`, in bytes. Partitions only; `null` elsewhere. */
  deviceOffset: number | null;
  /** Extent in bytes, or `null` when the manifest pins a base but no size —
   *  which is the normal state of a slot image, whose size is a budget the
   *  manifest does not carry. */
  sizeBytes: number | null;
  /** The SoM `memory_map` region the resolver allocated from (carve-outs). */
  region: string | null;
  /** The `storage[].flash_device` this partition lives in. */
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

export interface MemoryView {
  /** `hw_info.sku`, so the view can name the part its addresses belong to. */
  sku: string;
  /** Resolved extents, ordered by base ascending; the ones with no absolute
   *  base last, then by label. Deterministic so a re-render never reshuffles. */
  spans: MemorySpan[];
  /** Declared-but-unresolved entries, in manifest order. */
  unresolved: MemoryUnresolved[];
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
 * An address, from either spelling the emitter uses.
 *
 * `ipc[].base` arrives as a YAML integer; `flash_args.slot0_load_address`
 * arrives QUOTED (`'0x802b0000'`), because it is a flash-runner argument. Both
 * are accepted, nothing else is: a bare decimal string is refused rather than
 * parsed, since an unprefixed number in a field of hex is more likely a
 * mistake than a base-10 address.
 */
function asAddress(value: unknown): number | null {
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
 *  applies, so the two surfaces cannot disagree about what "resolved" means. */
function isDegraded(status: string | null): boolean {
  return status !== null && status !== "ok";
}

/** The load address the emitter pins for a slice, or null. */
function slotAddress(slice: ManifestSlice): number | null {
  const args = slice.flash_args;
  if (!isRecord(args)) return null;
  return asAddress(args.slot0_load_address);
}

/**
 * Slot images.
 *
 * Only slices that participate at all: an `os: "off"` core builds nothing, so
 * a load address on one would point at an image that does not exist. Size is
 * left null on purpose — the slot's capacity is a budget from the SoM, which
 * `tan size` reports separately and this contract does not carry.
 */
function slotSpans(slices: readonly ManifestSlice[]): MemorySpan[] {
  const spans: MemorySpan[] = [];
  for (const slice of slices) {
    if (slice.os === "off") continue;
    const base = slotAddress(slice);
    if (base === null) continue;
    spans.push({
      id: `slot_image:${slice.core_id}`,
      kind: "slot_image",
      label: slice.core_id,
      base,
      deviceOffset: null,
      sizeBytes: null,
      region: null,
      device: null,
      cores: [slice.core_id],
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
  for (const link of manifest.ipc ?? []) {
    const label = asText(link.name);
    if (label === null) continue;
    const cores = asCores(link.endpoints);
    const status = asText(link.status);
    const base = asAddress(link.base);
    const sizeBytes = asCount(link.size);
    // A degraded link is unresolved whatever it carries, and a link that
    // claims `ok` without an extent is unresolved too: the picture cannot
    // place it either way, and saying so is the honest half.
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
      region: asText(link.region),
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
  for (const entry of manifest.storage ?? []) {
    if (!isRecord(entry)) continue;
    const label = asText(entry.name);
    if (label === null) continue;
    const status = asText(entry.status);
    const device = asText(entry.flash_device);
    const sizeKib = asCount(entry.size_kib);
    const baseKib = asCount(entry.base_kib);
    if (isDegraded(status) || sizeKib === null || baseKib === null) {
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
      deviceOffset: baseKib * 1024,
      sizeBytes: sizeKib * 1024,
      region: null,
      device,
      cores: [],
      fs: asText(entry.fs),
    });
  }
  return { spans, unresolved };
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
 * The address-space view of one manifest. Pure: no IO, no clock, no `vscode`.
 *
 * Order of the unresolved list is manifest order — carve-outs then partitions,
 * each as the emitter wrote them — so a reader comparing this against
 * `build/system-manifest.yaml` by eye finds the rows where they expect them.
 */
export function buildMemoryView(manifest: SystemManifest): MemoryView {
  const ipc = carveOuts(manifest);
  const storage = partitions(manifest);
  return {
    sku: asText(manifest.hw_info?.sku) ?? "",
    spans: [
      ...slotSpans(manifest.slices ?? []),
      ...ipc.spans,
      ...storage.spans,
    ].sort(byAddress),
    unresolved: [...ipc.unresolved, ...storage.unresolved],
  };
}
