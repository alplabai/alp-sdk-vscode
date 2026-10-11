// SPDX-License-Identifier: Apache-2.0
//
// Reading the host's fail-closed target lock (#484). The verdict itself is
// computed host-side by `regionTargetLock` in `@alp-sdk/core`; this module
// only reads it, and reads a missing or malformed verdict as LOCKED — an
// older host, or a payload caught mid-change, must never render a region as
// open to edits.

import type { MemoryRegion, TargetLock, TargetLockField } from "../../types";

const NO_VERDICT: TargetLock = {
  locked: true,
  reason: "no target-lock verdict from the host",
};

const FIELD_LABEL: Record<TargetLockField, string> = {
  ipc: "IPC carve-out",
  storage: "Storage partition",
};

/** The host's verdict for `field`, or a locked one when it sent none. */
export function lockOf(
  region: MemoryRegion,
  field: TargetLockField,
): TargetLock {
  const all = (region as { targetLock?: unknown }).targetLock;
  if (typeof all !== "object" || all === null) return NO_VERDICT;
  const one = (all as Record<string, unknown>)[field];
  if (typeof one !== "object" || one === null) return NO_VERDICT;
  const { locked, reason } = one as { locked?: unknown; reason?: unknown };
  if (locked !== false) {
    return {
      locked: true,
      reason:
        typeof reason === "string" && reason.length > 0
          ? reason
          : NO_VERDICT.reason,
    };
  }
  return {
    locked: false,
    reason: typeof reason === "string" ? reason : "",
  };
}

/** Both verdicts, each read fail-closed. */
export function locksOf(
  region: MemoryRegion,
): Record<TargetLockField, TargetLock> {
  return { ipc: lockOf(region, "ipc"), storage: lockOf(region, "storage") };
}

/** One line for the detail pane: `IPC carve-out: locked · <reason>`. */
export function lockLine(field: TargetLockField, lock: TargetLock): string {
  const state = lock.locked ? "locked" : "open";
  return lock.reason
    ? `${FIELD_LABEL[field]}: ${state} · ${lock.reason}`
    : `${FIELD_LABEL[field]}: ${state}`;
}
