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

/**
 * tan's catch-all: ANY exception from its run is wrapped in this code with no
 * entries. It can be raised after the MRAM write (record, read-back, boot
 * confirmation), so it is never evidence that nothing was written.
 */
const FLASH_INTERNAL_FAILURE_CODE = "flash.internal-failure";

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
  | { kind: "unknown"; detail?: string };

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
  if (env.issues.some((i) => i.code === FLASH_INTERNAL_FAILURE_CODE)) {
    return { kind: "unknown", detail: issueMessages(env) };
  }

  const entries = env.entries.filter((e) => e.status !== "skipped");
  const ok = entries.filter((e) => e.status === "ok");
  const planned = entries.filter((e) => e.status === "planned");
  const failed = entries.filter((e) => e.status === "failed");

  if (failed.length > 0) {
    // Attribute a refusal to the entry it belongs to. tan raises each refusal
    // as an issue whose message IS the entry's message (a co-slice quotes its
    // lead's), so a code elsewhere in the run says nothing about THIS entry:
    // a Flow D probe refusal beside a cmake flash that died mid-program is a
    // partial write, not a refusal.
    const isTied = (e: FlashEnvelopeEntry): boolean =>
      env.issues.some(
        (i) =>
          // Only an ERROR can tie an entry to a refusal: tan emits some of
          // these codes as warning/info about an entry that then went on.
          i.severity === "error" &&
          FLASH_REFUSAL_CODES.has(i.code) &&
          i.message !== "" &&
          e.message.includes(i.message),
      );
    // Provably before the first byte: no write session opened, and either tan
    // tied a refusal to this entry or it is Flow D (whose only write session is
    // the one that leaves a transcript). Anything else MAY have written.
    const isPreWrite = (e: FlashEnvelopeEntry): boolean =>
      !e.hasWriteTranscript && (isTied(e) || e.method === FLOW_D_METHOD);
    if (ok.length > 0 || !failed.every(isPreWrite)) {
      return {
        kind: "failed-during-write",
        written: ids(ok),
        failed: ids(failed),
        detail: failed.map((e) => `${e.id}: ${e.message}`).join("\n"),
      };
    }
    return {
      kind: "refused",
      codes: env.issues
        .map((i) => i.code)
        .filter((code) => FLASH_REFUSAL_CODES.has(code)),
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

  // A run tan itself calls not-ok cannot be a clean write, whatever its
  // entries say: report the state as unknown rather than green.
  if (ok.length > 0 && !env.ok) {
    return { kind: "unknown", detail: issueMessages(env) };
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

  // Nothing ok, planned or failed. If tan itself says not-ok with no entry to
  // account for it, that is not evidence of anything: an exception can escape
  // after a write. Only an ok run with nothing selected is "nothing written".
  if (!env.ok) return { kind: "unknown", detail: issueMessages(env) };
  return {
    kind: "refused",
    codes: env.issues.map((i) => i.code),
    detail: issueMessages(env) || "tan selected nothing to write.",
  };
}

/**
 * The envelope as log lines, one per entry then one per issue, so the output
 * channel shows what `tan flash` said even though the run was read as JSON
 * rather than streamed as text. tan's words are printed verbatim.
 */
export function formatFlashEnvelopeLog(env: FlashEnvelope): string {
  const lines = env.entries.map(
    (e) =>
      `[${e.status}] ${e.kind} ${e.id}` +
      (e.method !== null ? ` (${e.method})` : "") +
      `: ${e.message}`,
  );
  for (const issue of env.issues) {
    lines.push(`${issue.severity} ${issue.code}: ${issue.message}`);
  }
  return `${lines.join("\n")}\n`;
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
          "Alp Flash did not complete cleanly, and tan's result is not one Alp can read as a verdict. " +
          "That does not say whether any slice was written, and the device may be partly programmed — " +
          "read the log before re-flashing.",
        detail: outcome.detail,
      };
  }
}
