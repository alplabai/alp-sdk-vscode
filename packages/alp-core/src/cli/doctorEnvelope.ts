// SPDX-License-Identifier: Apache-2.0
//
// The `tan doctor` envelope's `data` shape — hoisted here so every slice that
// renders a doctor run (deps/planner.ts's dependency table, debug/*'s doctor
// consumers, #376) reads the SAME types without one importing the other's
// slice. `deps/planner.ts`'s own header states the rule this module exists to
// let both sides follow: tan owns the facts. Rows/checks are DERIVED from
// `data.checks[]` verbatim — no allowlist, no status filter, nothing
// TypeScript re-derives — that is how tan-cli#104/#105 happened.

/**
 * A check's status, VERBATIM from tan. Deliberately `string`, not a union: a
 * consumer passes it through untouched, so a status tan adds later (e.g.
 * `unknown`) survives the trip instead of being coerced into today's
 * vocabulary.
 */
export type DoctorCheckStatus = string;

/** One entry of the doctor envelope's `data.checks[]`. */
export interface DoctorCheckEnvelope {
  name: string;
  status: DoctorCheckStatus;
  detail: string;
  /**
   * Whether this check reads the PROJECT or only the HOST — tan's own word for
   * it, `"project"` or `"host"`. It is what decides whether a row is withheld
   * when no folder is open (`src/deps/vscodeAdapter.ts`), replacing a hand
   * list of check names that had already rotted once (#472).
   *
   * REQUIRED, because tan's frozen contract says so: `envelopes.doctor
   * .dataKeys.checks.requiredKeys` names `scope` alongside `name`, `status`
   * and `detail` at SUPPORTED_CLI_VERSION. `test/tanContract.test.js` refuses
   * a `?` here for exactly that reason.
   *
   * Deliberately `string`, like `status`: a scope tan adds later must survive
   * the trip rather than be coerced into today's two words. A consumer that
   * branches on it must have an answer for a THIRD word, not only for the two
   * this pin emits.
   *
   * A binary older than the contract does not emit it — tan v0.4.0's envelopes
   * carry no `scope` on any check — and `isDoctorEnvelopeData` deliberately
   * does not refuse those envelopes over it. So a defensive read is still
   * correct in a consumer even though this type promises a value; see
   * `isProjectCheck`.
   */
  scope: string;
  /**
   * PROSE from tan — "Install Ninja.", "Run Yocto builds on Linux (WSL2 /
   * Docker)." Shown to the user and NEVER parsed into a command: commit
   * e359d37 (#347) established that parse is unrecoverable, and a mangled
   * command reaching a terminal is worse than no button at all.
   */
  fix?: string | null;
}

/**
 * tan's `MissingPrerequisite` (tan-cli #78/#81), verbatim:
 * `{ tool: String, command: Option<String> }`.
 *
 * `command: null` is a real answer — "tan knows of no command for this tool"
 * — not an invitation to look somewhere else.
 */
export interface MissingPrerequisite {
  tool: string;
  command: string | null;
}

/** The `data` payload of a `tan doctor` / `tan doctor --build` envelope. */
export interface DoctorEnvelopeData {
  checks: DoctorCheckEnvelope[];
  summary: { pass: number; warn: number; fail: number };
  /**
   * PRESENT on the pinned tan (tan-cli #78/#81), absent on older binaries
   * still reachable through `alpSdk.cliPath`. Feature-detected and never
   * assumed — see the tri-state this enables in `deps/planner.ts`'s
   * `planDependencyReport`.
   */
  missingPrerequisites?: MissingPrerequisite[] | null;
  /**
   * The report-level follow-up list, PROSE from tan — same rule as a check's
   * `fix`: shown verbatim, never parsed. Measured on the pinned tan 0.5.1, a
   * real entry is "Run `JLinkExe -?` by hand and confirm the banner reports
   * V9.46 or newer."
   *
   * Optional for the same reason `missingPrerequisites` is: an older binary
   * reachable through `alpSdk.cliPath` may not emit it, so it is
   * feature-detected and never assumed.
   */
  nextSteps?: string[] | null;
}
