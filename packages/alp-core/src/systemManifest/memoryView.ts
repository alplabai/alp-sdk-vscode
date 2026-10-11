// SPDX-License-Identifier: Apache-2.0
//
// What the system manifest PINS in the address space, what it refuses to, and
// where two things it pinned land on top of each other (#484).
//
// ── Why this module is narrow ────────────────────────────────────────────────
//
// The SoM's own region table arrives as a NINTH root key, `memory[]`, only
// from an alp-sdk that carries alp-sdk#1365's `memory[]` pane (landed in
// alp-sdk#2030; not yet in a tagged release, alp-sdk#2047). Older
// producers, and this contract before that commit, declare only eight:
// `schema_version, generated_by, hw_info, slices, ipc, helper_mcus,
// boot_order, storage`. When
// `memory[]` is present it is narrowed into `MemoryRegion[]` below (#484
// phase 2) — but it is NEVER joined into a span's own `base`: a span's base
// stays exactly what the emitter pinned for it, never a value this module
// computed by combining two panes. Reading `metadata/e1m_modules/<SKU>.yaml`
// directly from TypeScript remains out of bounds either way — that is what
// the manifest's own description forbids ("Tools read THIS instead of
// re-deriving folder layout / build wiring from board.yaml + the SoM
// presets").
//
// So `spans`/`apertures`/`conflicts` below still derive ONLY the extents the
// manifest already resolves for the customer-owned half: the IPC carve-outs
// and the storage partitions declared in `board.yaml`, plus the load address
// the emitter pins for each Zephyr slice. `regions` is additive, read
// separately, and joined to the rest BY NAME only (see `MemoryRegion` and
// `findOutsideRegion`) — never folded into a span's own fields. Everything
// else renders as absent, and absent is rendered as absent — never as zero.
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
import {
  findApertures,
  findConflicts,
  findOutsideRegion,
} from "./memoryView/analysis";
import { asText } from "./memoryView/narrow";
import { carveOuts, partitions, regions, slotSpans } from "./memoryView/spans";
import { paneLockReason, targetLockOf } from "./memoryView/targetLock";
import type { MemorySpan, MemoryView } from "./memoryView/types";

export { authorityClassOf } from "./memoryView/authority";
export {
  regionTargetLock,
  TARGET_LOCK_CLASSIFIED,
} from "./memoryView/targetLock";
export type * from "./memoryView/types";

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
  // Every region carries its fail-closed target lock; a manifest of an
  // unknown schema_version locks them all (see `memoryView/targetLock.ts`).
  const paneReason = paneLockReason(manifest.schema_version);
  const memoryRegions = regions(manifest.memory).map((region) => ({
    ...region,
    targetLock: targetLockOf(region, paneReason),
  }));
  return {
    sku: asText(manifest.hw_info?.sku) ?? "",
    spans,
    unresolved: [...ipc.unresolved, ...storage.unresolved],
    apertures: findApertures(spans),
    conflicts: [
      ...findConflicts(spans),
      ...findOutsideRegion(spans, memoryRegions),
    ],
    ...(memoryRegions.length > 0 ? { regions: memoryRegions } : {}),
  };
}
