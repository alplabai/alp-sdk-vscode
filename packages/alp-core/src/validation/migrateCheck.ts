// SPDX-License-Identifier: Apache-2.0
//
// Reading `tan migrate --check` (#613).
//
// THE GAP, measured at tan 0.6.0 against alp-sdk v0.16.0-rc1. A `board.yaml`
// carrying `schemaVersion: 2` — written by a newer SDK, opened against an older
// one — passes `tan validate` with `ok: true`, `exitCode 0`, `issues: []`. The
// schema permits it (`schemaVersion` is `{"type":"integer","minimum":1}`), so
// the customer is told "board.yaml is clean" for a file the resolved SDK cannot
// process. `tan migrate --check` is the verb that knows better:
//
//   ok false, exitCode 1
//   issues[0].code    "migrate.failed"
//   data.stderr       alp-migrate: <path>: board.yaml schemaVersion 2 is newer
//                     than this SDK's latest (1); refusing to downgrade
//
// WHAT THIS MODULE DOES NOT DO. It does not say the board.yaml is "newer". That
// sentence exists only in `data.stderr`, which is `west alp-migrate`'s prose,
// and classifying on prose is what turns a copy-edit upstream into a silently
// dead branch here (`project/initRefusal.ts`, `features/models/cliSurface.ts`).
// `migrate.failed` is a GENERIC wrapper — tan emits it for any non-zero west
// exit — so the honest reading is "the resolved SDK's migrator refused this
// file", with west's own words carried verbatim to the output channel. That
// stays true if tan grows a second refusal tomorrow.
//
// WHAT IT ALSO IS NOT. It is not a drift check. At this pin the migration
// registry is EMPTY and `LATEST` is 1, and the schema says an absent
// `schemaVersion` means version 1 permanently and is never out of date — so
// nothing can BE behind, and `--check` on a normal project answers
// `alp-migrate: all board.yaml at v1.` #613's body describes a drift warning
// this extension raises and a migration path off it; neither exists at this
// pin, and this module deliberately covers only the case that does.

/** What `tan migrate --check` answered. */
export type MigrateCheck =
  /** The SDK's migrator is happy with this file. */
  | { kind: "clean" }
  /**
   * The migrator REFUSED the file. `message` is west's own sentence, verbatim
   * and unparsed — display it as a record, never branch on it.
   */
  | { kind: "refused"; code: string; message: string | null }
  /**
   * tan did not answer in a shape this extension recognises, or could not run
   * at all. NOT reported to the customer: `--check` is a second opinion
   * alongside `tan validate`, and a project with no SDK resolved must not turn
   * a clean validation into an error about a verb that never ran.
   */
  | { kind: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Classify a `tan migrate --check` envelope.
 *
 * `ok` and `issues` arrive as `unknown` because they come off an envelope: both
 * can be absent, null, or the wrong type, and none of those may throw.
 *
 * An `ok: true` is `clean` regardless of what `issues` carries — a warning on a
 * successful check is channel material, and the caller logs `issues[]`
 * separately. An `ok: false` is only `refused` when it names a code; without
 * one there is nothing the caller could act on, so it degrades to `unavailable`
 * rather than inventing a refusal.
 */
export function classifyMigrateCheck(
  ok: unknown,
  issues: unknown,
): MigrateCheck {
  if (ok === true) return { kind: "clean" };
  if (ok !== false) return { kind: "unavailable" };
  if (!Array.isArray(issues)) return { kind: "unavailable" };
  for (const issue of issues) {
    if (!isRecord(issue)) continue;
    if (typeof issue.code !== "string" || issue.code.length === 0) continue;
    return {
      kind: "refused",
      code: issue.code,
      message: typeof issue.message === "string" ? issue.message : null,
    };
  }
  return { kind: "unavailable" };
}

/**
 * The customer-facing sentence for a refusal.
 *
 * Says WHAT happened and does not guess WHY: the why is west's, lives in
 * `data.stderr` and in the issue message, and goes to the output channel. A
 * file the migrator refuses is one the resolved SDK cannot process, so "clean"
 * from `tan validate` is not the whole answer.
 */
export const MIGRATE_REFUSED_MESSAGE =
  "Alp: board.yaml passed validation, but the resolved SDK's migrator refused it — this project may have been created with a different SDK version.";
