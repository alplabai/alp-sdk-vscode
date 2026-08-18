// SPDX-License-Identifier: Apache-2.0
//
// Whether the resolved tan implements the model surface this panel drives.
//
// The panel is a thin `runAlpCommand(["model", ...])` shell over NINE
// subcommands — list, doctor, check, zoo, add, prep, run, ab, build. The pinned
// CLI (`SUPPORTED_CLI_VERSION = "0.6.0-rc1"`) implements exactly one of them,
// `build`, and refuses the rest. Before this module every refusal was rendered
// on its own, so ONE fact — "this CLI cannot do it yet" — reached the customer
// as FOUR red `Models unavailable` alarms carrying tan's own command-line text.
// Four alarms read as four broken things; a capability gap is not a breakage.
//
// CLASSIFIED ON THE CODE, never on the message. Measured from the binary:
//
//   $ tan model list --format json
//   {"command":"model","ok":false,"exitCode":1, …
//    "issues":[{"code":"model.unknown-subcommand","severity":"error",
//               "message":"Unknown model subcommand: list. Available: build."}]}
//
// Matching prose would repeat the mistake that shipped in the proxy classifier
// (#511): a condition pinned to one spelling, blind to the others. The code is
// the contract; the message is for quoting, not for deciding.
//
// Tracking: this repo's presentation fix is #522; the eight missing subcommands
// are tan-cli#857.

/** The `{code, severity, message}` shape every tan envelope issue carries. */
export interface CliIssue {
  code: string;
  severity: string;
  message: string;
}

/** tan's code for "that subcommand does not exist in this build". */
export const UNKNOWN_SUBCOMMAND_CODE = "model.unknown-subcommand";

function isIssue(value: unknown): value is CliIssue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

/**
 * The first refusal in `issues`, or `null` when this CLI implements what was
 * asked. Presence of one is what turns the panel from "something failed" into
 * "this CLI does not do this yet" — a different message and a different tone.
 *
 * Tolerant of a malformed list on purpose: `issues` crosses the same wire as
 * the payload that blanked the panel in #517, and a capability probe that
 * throws is worse than one that reports nothing.
 */
export function findUnsupportedSubcommand(issues: unknown): CliIssue | null {
  if (!Array.isArray(issues)) return null;
  for (const issue of issues) {
    if (isIssue(issue) && issue.code === UNKNOWN_SUBCOMMAND_CODE) return issue;
  }
  return null;
}

/**
 * `issues` with the refusals removed, so the per-section banners carry only
 * failures that are actually about the customer's project. The capability gap
 * is stated ONCE, by the caller, instead of once per section.
 *
 * Everything else survives: a real `model.check-failed` is still a red banner,
 * and hiding it behind the capability notice would trade four honest alarms for
 * zero.
 */
export function withoutUnsupportedSubcommand(issues: unknown): CliIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.filter(
    (issue) => !(isIssue(issue) && issue.code === UNKNOWN_SUBCOMMAND_CODE),
  ) as CliIssue[];
}
