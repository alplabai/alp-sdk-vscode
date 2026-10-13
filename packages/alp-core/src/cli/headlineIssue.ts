// SPDX-License-Identifier: Apache-2.0
//
// Which of an envelope's `issues[]` a one-line headline should quote.
//
// `issues[0]` USED to be the answer, and from tan 0.7.0-rc1 it is not: tan now
// puts its SDK-resolution advisories — `sdk.project-pin-unresolved`,
// `sdk.global-default-foreign-project`, both `warning` — AHEAD of the
// command's own refusal (`size_cmd.py` `_error_outcome` at the rc1 tag, and
// the same ordering on presets/clean/diff/lock/migrate/quality/examples/
// generate/bootstrap/new-som/explain). A toast reading `issues[0]` on a failed
// run would then headline "no project pin" over the error that actually
// stopped it. So: the first `error`, else the first issue at all.
//
// One helper, every headline consumer, so the rule cannot drift between them.

/** The issue a headline quotes: the first `severity: "error"`, falling back
 *  to `issues[0]` (an all-warning success, or a tan that sends no severity). */
export function headlineIssue<T extends { severity?: string | null }>(
  issues: readonly T[] | null | undefined,
): T | undefined {
  if (!issues || issues.length === 0) return undefined;
  return issues.find((issue) => issue?.severity === "error") ?? issues[0];
}
