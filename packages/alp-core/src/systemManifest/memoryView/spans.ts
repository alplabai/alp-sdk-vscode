// SPDX-License-Identifier: Apache-2.0
//
// Builds the spans, unresolved entries and regions from the manifest (#484).

import type { SystemManifest } from "../models";
import { authorityClassOf } from "./authority";
import {
  asCores,
  asCount,
  asHexOrCount,
  asOpenString,
  asText,
  isDegraded,
  isRecord,
  records,
} from "./narrow";
import type { MemoryRegion, MemorySpan, MemoryUnresolved } from "./types";

/** The status word for an entry that resolved to nothing and said nothing. */
const NO_STATUS = "unresolved";

/**
 * Slot images.
 *
 * Only slices that participate at all: an `os: "off"` core builds nothing, so
 * a load address on one would point at an image that does not exist. Size is
 * left null on purpose — the slot SPAN itself never carries one: `tan size`
 * reports the same slot's capacity separately (as a budget, not a manifest
 * fact), and a `memory[]` row may separately resolve that slot's own extent
 * as a region — joined to this span only in the UI, by name, never merged
 * into one object here.
 */
export function slotSpans(slices: unknown): MemorySpan[] {
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
export function carveOuts(manifest: SystemManifest): {
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
export function partitions(manifest: SystemManifest): {
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

/**
 * The SoM's own region table, when the manifest carries one.
 *
 * `base` and `size_bytes` are the emitter's own plain YAML integers here —
 * UNLIKE `carve_out_base`/`carve_out_size`, they are never quoted hex — so
 * `asCount` is the whole rule; a hex string in this pane is a producer
 * deviation and is dropped, never coerced (`asHexOrCount` is deliberately
 * not used here). A row with no text `name` is dropped whole; every other
 * field defaults to an empty string or null rather than dropping the row,
 * because an unrecognised `source`/`kind`/`status` is still something a UI
 * can render (as "not proven" / "unstated"), where dropping the row would
 * hide a resolved extent instead. Duplicate names are kept as separate
 * rows; only `findOutsideRegion`'s name-join refuses an ambiguous name.
 */
export function regions(value: unknown): MemoryRegion[] {
  const out: MemoryRegion[] = [];
  for (const row of records(value)) {
    const name = asText(row.name);
    if (name === null) continue;
    const source = asOpenString(row.source);
    const status = asOpenString(row.status);
    const writeAuthority = asText(row.write_authority);
    out.push({
      id: `memory:${name}`,
      name,
      source,
      kind: asOpenString(row.kind),
      status,
      base: status === "ok" ? asCount(row.base) : null,
      sizeBytes: asCount(row.size_bytes),
      writeAuthority,
      authorityClass: authorityClassOf(writeAuthority, source),
      cores: asCores(row.accessible_from),
      reason: asText(row.reason),
    });
  }
  return out;
}
