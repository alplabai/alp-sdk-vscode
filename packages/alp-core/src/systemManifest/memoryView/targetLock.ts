// SPDX-License-Identifier: Apache-2.0
//
// The fail-closed TARGET LOCK on `memory[]` regions (#484, D5 re-taken).
//
// A region is offered as the target of a customer edit ONLY when the producer
// has said, in so many words, that the customer's running firmware owns it:
//
//   status === "ok"
//   write_authority === "customer_runtime"   (present, exact spelling)
//   base and size_bytes both resolved, size non-zero
//   no overlap with a row that is not customer_runtime; a unique name
//   kind fits the field: ipc → "ram"; storage → "flash" | "unclassified"
//
// Everything else is LOCKED, and says why. This is an ALLOWLIST on purpose:
// on E1M-AEN801 the Secure-Enclave ATOC sits at 0x80578000, directly above a
// customer `storage` band, and writing it can leave the part unbootable
// (alp-sdk#1289). A value this module does not recognise — a new upstream
// enum member, a typo, a different case — is therefore locked, never guessed.
// `source` and the region's NAME never unlock anything: a `soc_derived` row
// carries no authored authority at all, and a row called `storage` is exactly
// the shape of the #1289 incident.
//
// `test/memoryRegions.targetLock.test.js` pins this against the vendored
// schema's enums and as a full cartesian product.

import { intersects, regionExtentOf } from "./analysis";
import type {
  MemoryRegion,
  MemoryRegionTargetLock,
  TargetLock,
  TargetLockField,
} from "./types";

/**
 * Every value of the schema's `memory[]` enums this module has CLASSIFIED —
 * which is not the same as unlocked. The test compares these against the
 * vendored `system-manifest-v1.schema.json`, so a value upstream adds fails
 * the suite until someone decides, here, what it means. Until then it locks.
 */
export const TARGET_LOCK_CLASSIFIED = {
  write_authority: [
    "customer_image",
    "vendor_image",
    "customer_runtime",
    "secure_enclave",
    "none",
    "composite",
  ],
  kind: ["flash", "ram", "unclassified", "unresolved"],
  status: ["ok", "unresolved"],
  source: ["som_preset", "soc_derived"],
} as const;

/** Why each recognised non-customer authority locks. A Map, not an object
 *  literal: `"__proto__"` or `"constructor"` must miss, not hit a prototype
 *  member (the same reasoning as `authority.ts`). */
const LOCKED_AUTHORITY_REASON = new Map<string, string>([
  [
    "secure_enclave",
    "write authority is secure_enclave — the Secure Enclave owns it",
  ],
  ["vendor_image", "write authority is vendor_image — a vendor image owns it"],
  [
    "customer_image",
    "write authority is customer_image — a firmware image slot, not runtime data",
  ],
  ["none", "write authority is none — reserved, nothing may write it"],
  [
    "composite",
    "write authority is composite — it mixes owners, so no part of it is proven customer-writable",
  ],
]);

/** The region kinds each field may target. */
const KINDS_FOR = new Map<TargetLockField, readonly string[]>([
  ["ipc", ["ram"]],
  ["storage", ["flash", "unclassified"]],
]);

const locked = (reason: string): TargetLock => ({ locked: true, reason });

function authorityLock(writeAuthority: string | null): TargetLock | null {
  if (writeAuthority === null) return locked("write authority not declared");
  if (writeAuthority === "customer_runtime") return null;
  return locked(
    LOCKED_AUTHORITY_REASON.get(writeAuthority) ??
      `write authority "${writeAuthority}" is not recognised`,
  );
}

function kindLock(kind: string, field: TargetLockField): TargetLock | null {
  const allowed = KINDS_FOR.get(field) ?? [];
  if (allowed.includes(kind)) return null;
  const what = field === "ipc" ? "an IPC carve-out" : "a storage partition";
  return locked(
    `${what} needs a ${allowed.join(" or ")} region; this one is ` +
      (kind === "" ? "of no stated kind" : `"${kind}"`),
  );
}

/**
 * Whether `region` may be the target of a `field` edit. Pure and total:
 * every path that is not the one allowlisted tuple returns `locked: true`.
 * Checks run status → authority → base → size → kind, and the first failure
 * is the reason reported.
 */
export function regionTargetLock(
  region: MemoryRegion | Omit<MemoryRegion, "targetLock">,
  field: TargetLockField,
): TargetLock {
  if (region.status !== "ok") {
    return locked(
      region.status === ""
        ? "region status not stated"
        : `region status is "${region.status}", not ok`,
    );
  }
  const authority = authorityLock(region.writeAuthority);
  if (authority) return authority;
  if (region.base === null) return locked("base address not resolved");
  if (region.sizeBytes === null) return locked("size not resolved");
  if (region.sizeBytes === 0) return locked("zero-size region");
  const kind = kindLock(region.kind, field);
  if (kind) return kind;
  return {
    locked: false,
    reason: `customer_runtime ${region.kind} region — a ${field} target`,
  };
}

type UnlockedRegion = Omit<MemoryRegion, "targetLock">;

/**
 * A reason the row's NEIGHBOURS lock it, or null. A row is only as open as
 * the rows around it allow:
 *
 *  - its name occurs more than once — `ipc[].carve_out_region` and
 *    `storage[].flash_device` join BY NAME, so an ambiguous name cannot say
 *    which extent an edit would land in;
 *  - its extent intersects (half-open) any other row's resolved extent that
 *    is not itself `customer_runtime` — growing into the AEN ATOC by one
 *    byte is exactly the #1289 shape. A row with no resolved extent cannot
 *    be intersected and is not counted here; it is locked on its own.
 */
export function neighbourLockReason(
  region: UnlockedRegion,
  all: readonly UnlockedRegion[],
): string | null {
  if (all.filter((r) => r.name === region.name).length > 1) {
    return "region name is ambiguous";
  }
  const own = regionExtentOf(region);
  if (own === null) return null;
  for (const other of all) {
    if (other === region || other.writeAuthority === "customer_runtime") {
      continue;
    }
    const theirs = regionExtentOf(other);
    if (theirs === null || !intersects(own, theirs)) continue;
    const authority = other.writeAuthority ?? "write authority not declared";
    return `overlaps ${other.name} (${authority})`;
  }
  return null;
}

/** Both verdicts. Locked with `paneReason` when the whole pane is untrusted
 *  (see `paneLockReason`), then with the neighbour reason, then per row. */
export function targetLockOf(
  region: UnlockedRegion,
  paneReason: string | null,
  all: readonly UnlockedRegion[] = [region],
): MemoryRegionTargetLock {
  const shared = paneReason ?? neighbourLockReason(region, all);
  if (shared !== null) {
    return { ipc: locked(shared), storage: locked(shared) };
  }
  return {
    ipc: regionTargetLock(region, "ipc"),
    storage: regionTargetLock(region, "storage"),
  };
}

/**
 * A reason to lock EVERY region, or null. A manifest whose `schema_version`
 * is not exactly 1 is a contract this build has not read, so none of its
 * authority values is trusted — even though `parseSystemManifest` already
 * refuses one, this is the second gate behind it. A manifest with no
 * `memory[]` pane yields no regions at all (`buildMemoryView` omits the
 * field), so nothing can be targeted there either.
 */
export function paneLockReason(schemaVersion: unknown): string | null {
  if (schemaVersion === 1) return null;
  return (
    `manifest schema_version ${JSON.stringify(schemaVersion ?? null)} is ` +
    "not 1 — an unknown contract version, so every region is locked"
  );
}
