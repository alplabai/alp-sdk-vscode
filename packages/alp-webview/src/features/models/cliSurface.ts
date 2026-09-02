// SPDX-License-Identifier: Apache-2.0
//
// Whether the resolved tan implements the model surface this panel drives.
//
// The panel is a thin `runAlpCommand(["model", ...])` shell over NINE
// subcommands — list, doctor, check, zoo, add, prep, run, ab, build.
// RE-MEASURED against the pinned CLI (`SUPPORTED_CLI_VERSION = "0.6.0"`, GA —
// this used to read `0.6.0-rc1`, and the whole surface was re-run rather than
// relabelled, per #609): the GA tag still implements exactly one of the nine,
// `build`.
//
// The other eight do NOT refuse identically, and an earlier revision of this
// header said they did. Measured per subcommand, GA:
//
//   tan model list                    exit 1  model.unknown-subcommand
//   tan model doctor                  exit 1  model.unknown-subcommand
//   tan model zoo                     exit 1  model.unknown-subcommand
//   tan model check                   exit 1  model.unknown-subcommand
//   tan model add m1                  exit 2  NO ENVELOPE
//   tan model prep p.tflite           exit 2  NO ENVELOPE
//   tan model run p.tflite            exit 2  NO ENVELOPE
//   tan model ab a.tflite b.tflite    exit 2  NO ENVELOPE
//
// `tan model` takes ONE optional SUBCOMMAND, so the four that supply a second
// positional die as click usage errors before any envelope is built. A
// code-based classifier structurally cannot see those — there is no `issues`
// list to scan.
//
// The split is easy to measure wrongly, and was: passing `"add m1"` as a
// single shell word makes it an unknown SUBCOMMAND and reproduces the exit-1
// shape for all eight. The positionals have to be separate arguments.
//
// WHY NO NO-ENVELOPE FAILURE REACHES THIS MODULE TODAY. The panel does not
// spawn those eight at all any more (#543): `unsupportedModelSubcommand`
// (`src/alpCli/pinnedSurface.ts`) SYNTHESISES the refusal from the pin, and a
// synthesised issue always has an envelope. So the exit-2 half is currently
// unreachable by construction, not merely unlikely.
//
// It becomes reachable again the moment #524 restores the spawns — which
// `src/models/panel.ts` already plans for ("each handler below gets its
// `runAlpCommand(["model", <verb>, …])` back"). Whoever does that rewiring
// needs the table above: FOUR of the eight will come back with no envelope,
// and a restoration that assumes the classifiable shape will render a bare
// failure where the capability notice belongs. `build` itself now fails on an
// empty project for an UNRELATED reason (`model.sdk-root-unresolved`, no SDK
// resolved) rather than an unknown-subcommand refusal, which is what proves
// it IS implemented: a subcommand tan does not recognise at all never gets
// far enough to name a different problem. So the alarm-collapsing logic below
// did not need to change, only this comment's version label.
//
// Before this module every refusal was rendered on its own, so ONE fact —
// "this CLI cannot do it yet" — reached the customer as FOUR red `Models
// unavailable` alarms carrying tan's own command-line text. Four alarms read
// as four broken things; a capability gap is not a breakage.
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
// Tracking: this repo's presentation fix is #522; re-exposing the surface is
// #524. The eight missing subcommands are **tan-cli#674** (OPEN). NOT #857,
// which this header used to name — that one was closed as a DUPLICATE of #674,
// so the pointer led to a closed issue and read as "already handled".

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
 * The first unknown-subcommand refusal in `issues`, or `null` when there is
 * none. Presence of one is what turns the panel from "something failed" into
 * "this CLI does not do this yet" — a different message and a different tone.
 *
 * `null` MEANS TWO DIFFERENT THINGS and this function cannot tell them apart:
 *
 *   1. tan answered and did not refuse — the subcommand IS implemented.
 *   2. tan produced no envelope at all, so there was nothing to classify.
 *
 * (2) is not hypothetical: `model add`/`prep`/`run`/`ab` supply a second
 * positional to a command that takes one, so they die as click usage errors at
 * exit 2 with no `issues` list (see the header's measured table). Reading
 * `null` as "implemented" would call four unsupported subcommands supported.
 *
 * Left as one value on purpose — the caller that would act on the difference
 * does not exist yet, and inventing a third state for a panel that is
 * currently hidden (#525) would be a guess about how it should read. What is
 * NOT left ambiguous is the meaning: an earlier revision of this comment said
 * `null` was "when this CLI implements what was asked", which is false for
 * half the surface.
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
