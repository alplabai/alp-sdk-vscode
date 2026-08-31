// SPDX-License-Identifier: Apache-2.0
//
// Reading what `tan scaffold` answered (#601): its `data` payload, and the ways
// it refuses.
//
// Both halves follow rules this repo already paid for:
//
//   NARROW, NEVER CAST (#611, #517). A field that is not the declared type is
//   DROPPED, not coerced, and a payload missing the field the call exists to
//   get answers `null` rather than an empty-looking success. The failure that
//   rule prevents is written down in `test/ideHub.materialiseGuard.test.js`:
//   `written ?? []` cannot throw, so a renamed field reported "Materialised 0
//   file(s)" through a SUCCESS toast, indistinguishable from a run that
//   legitimately had nothing to do.
//
//   CLASSIFY ON THE CODE, NEVER ON THE PROSE (`project/initRefusal.ts`,
//   `features/models/cliSurface.ts`). A message is a sentence tan is free to
//   reword; a code is the contract. Matching text turns a copy-edit upstream
//   into a silently dead branch here.

/** One planned or applied file, as tan reports it. */
export interface ScaffoldFileChange {
  relativePath: string;
  /**
   * tan's own word for what happens to this path. `"new"`, `"update"` and
   * `"unchanged"` are the three the pinned tan 0.6.0 emits.
   *
   * Kept as a plain `string` rather than narrowed to that union ON PURPOSE, and
   * read at TWO decision points, both of which fail OPEN — toward showing the
   * customer more, never toward a silent success:
   *
   *   `isScaffoldNoOp` here treats only the literal `"unchanged"` as "nothing
   *   to do", so an unseen word falls through to the confirm.
   *
   *   `describeOverwrite` in `src/wizard.ts` names every path whose kind is not
   *   `"unchanged"`, so an unseen word is LISTED as at risk rather than
   *   quietly left out of the dialog that gates `--force`.
   *
   * Walked through: a hypothetical `kind: "delete"` is not a no-op, appears in
   * the first confirm, and appears in the overwrite confirm. The dialogs' prose
   * ("will write", "will be REPLACED") would then be the wrong verb for it —
   * wrong words, right severity, and nothing acts on it silently.
   *
   * Nothing here predicts whether `--force` is required. tan decides that, by
   * refusing with `scaffold.would-overwrite`; see `classifyScaffoldRefusal`.
   */
  kind: string;
}

/** `tan scaffold`'s `data`, as much of it as this extension uses. */
export interface ScaffoldResult {
  /** tan's normalized module name, or `null` when it reported none. Display
   *  only — the paths below are tan's, never rebuilt from this. */
  normalizedModuleName: string | null;
  /** Every path the run planned or touched. */
  fileChanges: ScaffoldFileChange[];
  /** Paths actually written. `[]` on a `--preview` pass. */
  written: string[];
  /** Paths already byte-identical to what tan would generate. */
  unchanged: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function narrowStringList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Narrow `tan scaffold`'s untrusted `data` into `ScaffoldResult`, or `null`.
 *
 * `fileChanges` and `written` must BOTH be arrays or the answer is `null` —
 * EITHER one missing is enough to refuse, not both. One rule for both passes:
 * `fileChanges` is the list shown before the write, `written` the list reported
 * after it, and a preview legitimately reports `written: []`, which is an array.
 *
 * That is deliberately stricter than any single caller needs (the preview reads
 * only `fileChanges`, the write only `written`), and the cost is real: a future
 * tan that drops one field from one pass dead-ends a flow it could have
 * completed. The trade is taken because the alternative — degrading a missing
 * list to `[]` — is the `written ?? []` shape that reported a SUCCESS for a run
 * whose output nobody could read. The caller's failure sentence is worded for
 * this: it says the result could not be read and that files may already have
 * been written, never that nothing was.
 */
export function narrowScaffoldResult(raw: unknown): ScaffoldResult | null {
  if (!isRecord(raw)) return null;

  if (!Array.isArray(raw.fileChanges)) return null;
  const written = narrowStringList(raw.written);
  if (written === null) return null;

  const fileChanges: ScaffoldFileChange[] = [];
  for (const entry of raw.fileChanges) {
    if (!isRecord(entry)) continue;
    if (typeof entry.relativePath !== "string") continue;
    if (typeof entry.kind !== "string") continue;
    fileChanges.push({ relativePath: entry.relativePath, kind: entry.kind });
  }

  return {
    normalizedModuleName:
      typeof raw.normalizedModuleName === "string"
        ? raw.normalizedModuleName
        : null,
    fileChanges,
    written,
    // Absent or malformed degrades to `[]` rather than dropping the whole
    // result: it is only ever counted in a summary line, never acted on.
    unchanged: narrowStringList(raw.unchanged) ?? [],
  };
}

/**
 * True when tan planned nothing at all to do — every path it would write is
 * already byte-identical to what it would generate.
 *
 * An EMPTY `fileChanges` is NOT a no-op: it is a payload that named no files,
 * which is drift, not agreement. Answering `false` sends it down the confirm
 * path, where the file list is empty and the customer can see that for
 * themselves, rather than announcing "nothing to write" for a run this
 * extension could not read.
 */
export function isScaffoldNoOp(result: ScaffoldResult): boolean {
  if (result.fileChanges.length === 0) return false;
  return result.fileChanges.every((change) => change.kind === "unchanged");
}

/**
 * Which refusal this is. A narrow union on purpose: an unrecognised code is
 * `null`, not a third kind, so a refusal this extension has no guidance for
 * keeps tan's own reporting rather than being wrapped in a wrong sentence.
 */
export type ScaffoldRefusalKind =
  /** A file on disk differs from what tan would generate. Recoverable, and the
   *  ONLY route by which this extension ever sends `--force`. */
  | "would-overwrite"
  /** The name normalizes to nothing, or none was sent. Recoverable by typing
   *  another one. */
  | "invalid-name"
  /** The template id is not one tan ships. Recoverable by picking another —
   *  and a signal the picker's catalogue is stale. */
  | "invalid-template";

export interface ScaffoldRefusal {
  kind: ScaffoldRefusalKind;
  /** tan's code, verbatim — the thing that was classified. */
  code: string;
  /** tan's own message, verbatim, or `null` when it sent none. DISPLAY ONLY,
   *  never parsed. */
  message: string | null;
}

/** Code → kind. The whole vocabulary this module understands, every entry
 *  measured against the pinned tan 0.6.0 rather than read off a help page. */
const KINDS: Readonly<Record<string, ScaffoldRefusalKind>> = {
  // exit 3. The envelope still carries `fileChanges[]` with the offending
  // paths marked `"update"`, which is what the overwrite confirm names.
  "scaffold.would-overwrite": "would-overwrite",
  // exit 2, "Module name is empty after normalization."
  "scaffold.invalid-name": "invalid-name",
  // exit 2, "Module name is required. Use --name <name> or run interactively."
  // Unreachable from this extension, which always sends `--name`; classified
  // anyway so a future argv change that drops the flag reports something the
  // customer can act on instead of a raw refusal.
  "scaffold.name-required": "invalid-name",
  // exit 2, "Unknown module template '<id>'."
  "scaffold.invalid-template": "invalid-template",
};

/**
 * Classify a `tan scaffold` failure's issues, or answer `null`.
 *
 * `issues` is typed `unknown` because it arrives from an envelope: it can be
 * absent, null, or not a list at all, and none of those may throw.
 */
export function classifyScaffoldRefusal(
  issues: unknown,
): ScaffoldRefusal | null {
  if (!Array.isArray(issues)) return null;
  for (const issue of issues) {
    if (!isRecord(issue)) continue;
    const code = issue.code;
    if (typeof code !== "string") continue;
    // `hasOwnProperty`, not `KINDS[code]`. A plain object literal inherits
    // `Object.prototype`, so `code: "constructor"` (or `toString`, `valueOf`,
    // `__proto__`) reads back a FUNCTION, which is truthy — the refusal then
    // classifies as a kind that does not exist, `scaffoldAdvice` falls off the
    // end of its switch returning `undefined`, and the customer's sentence ends
    // in the literal word "undefined" while the designed fallback (tan's own
    // issues behind "Show issues") is bypassed. Unreachable at this pin, where
    // every tan code is dotted; a guard costs one call.
    if (!Object.prototype.hasOwnProperty.call(KINDS, code)) continue;
    const kind = KINDS[code];
    return {
      kind,
      code,
      message: typeof issue.message === "string" ? issue.message : null,
    };
  }
  return null;
}
