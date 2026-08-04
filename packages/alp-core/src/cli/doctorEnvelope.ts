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
}
