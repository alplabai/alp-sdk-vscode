// SPDX-License-Identifier: Apache-2.0
//
// What a finished `tan flash` run MEANS, read from its envelope (#540). Pure.
//
// The exit code cannot say. At tan 0.7.0 all three of these exit non-zero, and
// one of them can exit zero:
//
//   previewed, not written    every entry `planned` → `flash.nothing-flashed`,
//                             exit 1; a MIXED run (one entry ok, one planned)
//                             exits 0 with a per-entry `flash.confirm-required`
//   refused before writing    a precondition tan checks ahead of the first byte
//   failed during the write   an entry `failed` after a write session started
//
// and a toast that says "failed" over a run that wrote nothing — or "finished"
// over a run that wrote half the board — is the bug this module exists to end.
//
// "Cancelled" (either modal declined) never reaches here: nothing was spawned,
// so there is no envelope. The gate says it itself.

import type { FlashEnvelope, FlashEnvelopeEntry } from "./envelope";
import { FLOW_D_METHOD } from "./envelope";

/**
 * Codes tan raises BEFORE the first byte of a confirmed write. Every one is
 * `reserved` with consumer `none` in tan v0.7.0's envelope-contract.json;
 * freezing them is an upstream ask, and `test/tanContract.test.js` files each
 * as `reserved` so the day tan changes its mind a test goes red.
 */
const FLASH_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "flash.atoc-replacement-unacknowledged",
  "flash.setools-untrusted-source",
  "flash.atoc-guard-refused",
  "flash.atoc-guard-unavailable",
  "flash.probe-ambiguous",
  "flash.probe-isolation-required",
  "flash.probe-not-found",
  "flash.probe-selector-conflict",
  "flash.probe-selector-unsupported",
  "flash.probe-verify-failed",
  "flash.mram-image-not-mram-linked",
  "flash.device-config-missing",
  "flash.device-config-mismatch",
  "flash.write-sector-overlap",
  "flash.slice-not-built",
]);

/** The run planned something and, by tan's own account, did not write it. */
const FLASH_PREVIEW_ONLY_CODES: ReadonlySet<string> = new Set([
  "flash.confirm-required",
  "flash.nothing-flashed",
]);

/** A write that completed but whose reset J-Link could not confirm. Info only. */
const FLASH_RESET_UNCONFIRMED_CODE = "flash.jlink-reset-unconfirmed";

export type FlashOutcome =
  | {
      kind: "previewed";
      /** Entries a MIXED run did write. Empty when nothing was. */
      written: readonly string[];
      previewedOnly: readonly string[];
      detail: string;
    }
  | { kind: "refused"; codes: readonly string[]; detail: string }
  | {
      kind: "failed-during-write";
      written: readonly string[];
      failed: readonly string[];
      detail: string;
    }
  | {
      kind: "written";
      written: readonly string[];
      resetUnconfirmed: boolean;
      detail: string;
    }
  /** No envelope: the state of the device cannot be stated. */
  | { kind: "unknown" };

const ids = (entries: readonly FlashEnvelopeEntry[]): string[] =>
  entries.map((e) => e.id);

function issueMessages(
  env: FlashEnvelope,
  codes?: ReadonlySet<string>,
): string {
  return env.issues
    .filter((i) => (codes ? codes.has(i.code) : i.severity === "error"))
    .map((i) => i.message)
    .join("\n");
}

export function classifyFlashOutcome(env: FlashEnvelope | null): FlashOutcome {
  if (env === null) return { kind: "unknown" };

  const entries = env.entries.filter((e) => e.status !== "skipped");
  const ok = entries.filter((e) => e.status === "ok");
  const planned = entries.filter((e) => e.status === "planned");
  const failed = entries.filter((e) => e.status === "failed");

  if (failed.length > 0) {
    const refusalCodes = env.issues
      .map((i) => i.code)
      .filter((code) => FLASH_REFUSAL_CODES.has(code));
    // A failed entry that opened a write session may have changed the device.
    // So may a failed entry of a backend this module cannot see inside, unless
    // tan named a pre-write refusal — a conservative default, because the
    // alternative is telling a customer a half-written board is untouched.
    const startedWriting = failed.some(
      (e) =>
        e.hasWriteTranscript ||
        (e.method !== FLOW_D_METHOD && refusalCodes.length === 0),
    );
    if (ok.length > 0 || startedWriting) {
      return {
        kind: "failed-during-write",
        written: ids(ok),
        failed: ids(failed),
        detail: failed.map((e) => `${e.id}: ${e.message}`).join("\n"),
      };
    }
    return {
      kind: "refused",
      codes: refusalCodes,
      detail: failed.map((e) => `${e.id}: ${e.message}`).join("\n"),
    };
  }

  if (
    planned.length > 0 ||
    env.issues.some((i) => FLASH_PREVIEW_ONLY_CODES.has(i.code))
  ) {
    return {
      kind: "previewed",
      written: ids(ok),
      previewedOnly: ids(planned),
      detail: issueMessages(env, FLASH_PREVIEW_ONLY_CODES),
    };
  }

  if (ok.length > 0) {
    return {
      kind: "written",
      written: ids(ok),
      resetUnconfirmed: env.issues.some(
        (i) => i.code === FLASH_RESET_UNCONFIRMED_CODE,
      ),
      detail: issueMessages(env, new Set([FLASH_RESET_UNCONFIRMED_CODE])),
    };
  }

  // Nothing ok, planned or failed: tan matched nothing, or every entry was
  // skipped. Whatever tan said is the reason, and no write happened.
  return {
    kind: "refused",
    codes: env.issues.map((i) => i.code),
    detail: issueMessages(env) || "tan selected nothing to write.",
  };
}

export interface FlashOutcomeText {
  severity: "info" | "warning" | "error";
  /** Customer-facing; carries no absolute path, so the presenter keeps it. */
  message: string;
  /** Channel-only: tan's own words. */
  detail?: string;
}

const list = (names: readonly string[]): string => names.join(", ");

export function describeFlashOutcome(outcome: FlashOutcome): FlashOutcomeText {
  switch (outcome.kind) {
    case "previewed": {
      if (outcome.written.length > 0) {
        return {
          severity: "warning",
          message:
            `Alp Flash wrote ${list(outcome.written)}; ${list(outcome.previewedOnly)} ` +
            "was only previewed and nothing was written for it — it needs a confirmed flash of its own.",
          detail: outcome.detail,
        };
      }
      return {
        severity: "info",
        message:
          "Alp Flash only previewed this run — nothing was written to the device.",
        detail: outcome.detail,
      };
    }
    case "refused":
      return {
        severity: "warning",
        message:
          "Alp Flash was refused before it wrote anything — nothing was written to the device. " +
          "Read the Alp SDK log for tan's reason.",
        detail: outcome.detail,
      };
    case "failed-during-write":
      return {
        severity: "error",
        message:
          "Alp Flash stopped while writing" +
          (outcome.written.length > 0
            ? ` (${list(outcome.written)} was written)`
            : "") +
          `. ${list(outcome.failed)} may be only partly programmed and the device may not boot — ` +
          "read the log before re-flashing.",
        detail: outcome.detail,
      };
    case "written":
      return {
        severity: "info",
        message: `Alp Flash wrote ${list(outcome.written)}.`,
        detail: outcome.resetUnconfirmed
          ? "The image is written, but J-Link could not confirm the device reset — power-cycle the board before judging it. " +
            outcome.detail
          : undefined,
      };
    case "unknown":
      return {
        severity: "warning",
        message:
          "Alp Flash did not complete, and tan returned no result Alp can read. That does not say " +
          "whether any slice was written — read the log before re-flashing.",
      };
  }
}
