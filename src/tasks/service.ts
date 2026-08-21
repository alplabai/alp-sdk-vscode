// SPDX-License-Identifier: Apache-2.0
//
// Pure task specs for the four `alp:` task labels this extension contributes.
// All four are spelled the way tan itself hardcoded them before tan-cli#85
// made the key opt-in (crates/tan-core/src/debug_launch.rs:49,62,75,93,107,
// 115 — see docs/DEBUG.md §10). THREE of them are what a generated
// launch.json now carries as its `preLaunchTask`; the fourth, "deploy and
// start gdbserver" (line 107, under `DebugTargetKind::YoctoUserspace`), is
// reachable only from the Tasks picker, because this extension deliberately
// does not restore that pairing — see `preLaunchTaskFor`. VS Code renders a
// *provided* task's label as `${source}: ${name}`, so TASK_SOURCE plus each
// spec's `name` here are the exact string contract with tan: renaming either
// side breaks
// `vscode.debug.startDebugging`'s `preLaunchTask` resolution silently (no
// compile error, no lint — the debug run just aborts pre-launch). This file
// is what makes that contract testable without an extension host: no
// `vscode`, `fs`, or `child_process` import here — those seams live in
// `vscodeAdapter.ts`.
//
// Registering the tasks is only half of it: tan emits `preLaunchTask` ONLY
// when `--pre-launch-task` names one (tan-cli v0.4.0
// `crates/tan-core/src/debug_launch.rs`, `drop_absent_pre_launch_task`), so
// four registered labels that nothing referenced left F5 launching
// cortex-debug at an ELF no step had built. `preLaunchTaskFor` below is the
// half that names the three, and `debugConfigArgs` (../debug/service.ts) is
// its only caller.
// @callers 1 preLaunchTaskFor

import { DebugTargetKind } from "@alp-sdk/core/debug/models";

/** VS Code renders `${source}: ${name}` for a task this provider contributes;
 *  `source` is fixed across all four. Must stay lowercase `alp` — that's the
 *  literal prefix tan's generated `preLaunchTask` strings carry. */
export const TASK_SOURCE = "alp";

export type TaskKind = "build" | "deployGdbserver";

export interface TaskSpec {
  /** Combined with TASK_SOURCE via `taskLabel`, this is the exact
   *  `preLaunchTask` string a generated debug profile references. */
  name: string;
  kind: TaskKind;
  /** The `--target-kind` whose generated debug profile should reference this
   *  task, if any. Carried HERE rather than in a lookup table beside
   *  `debugConfigArgs` so the label and the kind that names it cannot drift:
   *  renaming a spec moves both at once, and a table keyed on these strings
   *  from another file would not even fail to compile. */
  targetKind?: DebugTargetKind;
}

/** The label VS Code shows and matches `preLaunchTask` against for `spec`. */
export function taskLabel(spec: TaskSpec): string {
  return `${TASK_SOURCE}: ${spec.name}`;
}

/**
 * The four tasks this extension contributes. THREE are referenced by label
 * from a generated launch.json profile; the fourth is picker-only.
 *
 * `tan build` has NO WORKING per-target selector, so the three "build …"
 * names below all run the identical `tan build` — it builds every slice
 * board.yaml declares. Three labels exist because three debug-target kinds
 * (zephyr-mcu, baremetal-mcu, native-host) reference them under different
 * names, not because the command differs.
 *
 * THE FLAG LIST THIS PARAGRAPH USED TO CARRY WAS READ OFF THE WRONG BINARY.
 * It enumerated `BuildArgs` from `crates/tan-cli/src/cli.rs` — the RETIRED
 * Rust CLI — as "--plan/--plan-from/--materialise/--native/--manifest/
 * --manifest-from/--no-auto-bootstrap". We ship the Python port, and its
 * surface is neither a superset nor a subset of that: `tan build` at
 * SUPPORTED_CLI_VERSION accepts twenty-two options, of which TWELVE are inert
 * ("Accepted by other commands; not implemented for `build` yet",
 * tan-cli#427) — `--plan`, `--manifest` and `--manifest-from` among them
 * (#541). Reading a shipped surface off the oracle is the root cause of #541,
 * so the enumeration is deleted rather than corrected: the recording in
 * `test/golden/tan-surface/surface.json` is the one place that answers "what
 * does the pinned tan accept", it is regenerated when the pin moves, and
 * `test/tan.surfaceContract.test.js` checks every argv this tree sends
 * against it.
 *
 * What survives as a CLAIM, because it is what these three labels rest on:
 * there is no per-target build selector. `--target` IS accepted by `tan
 * build` at this pin and is recorded INERT, and `--core` exists on
 * `flash`/`run` but not on `build` at all. Do not reach for either to
 * "properly" distinguish the three labels — one does nothing and the other
 * does not exist.
 *
 * "deploy and start gdbserver" has no tan equivalent at all: the extension
 * has no deploy story, and the yocto-userspace debug profile ships
 * `miDebuggerServerAddress: "<host>:<port>"` for the user to fill in by
 * hand. Its `deployGdbserver` kind gets a placeholder task (adapter side)
 * that names the manual step and fails loudly rather than faking success.
 * That is why it carries NO `targetKind` — see `preLaunchTaskFor`.
 */
export const TASK_SPECS: readonly TaskSpec[] = [
  { name: "build active target", kind: "build", targetKind: "zephyr-mcu" },
  {
    name: "build baremetal target",
    kind: "build",
    targetKind: "baremetal-mcu",
  },
  {
    name: "build native_sim target",
    kind: "build",
    targetKind: "native-host",
  },
  { name: "deploy and start gdbserver", kind: "deployGdbserver" },
];

/**
 * The task label a `targetKind`'s generated debug profile should reference,
 * or undefined when it should reference none.
 *
 * The three build kinds map one-to-one onto the three build labels — the same
 * pairing tan itself hardcoded before tan-cli#85 made the key opt-in, so this
 * restores the intended profiles rather than inventing an association.
 *
 * yocto-userspace deliberately gets NOTHING. The only task registered for it
 * is the "deploy and start gdbserver" placeholder, which exits 1 by design
 * (`vscodeAdapter.ts`) because the extension cannot deploy or start a remote
 * gdbserver. Naming it would put VS Code's "the preLaunchTask terminated with
 * exit code 1 — Debug Anyway / Show Errors" dialog in front of EVERY F5,
 * including one where the customer has already copied the binary across,
 * started gdbserver by hand and filled in `miDebuggerServerAddress` — the
 * setup that works. Omitting the flag leaves that profile exactly as it is
 * today; it is not a claim that the build step is unwanted there, only that
 * no task this extension registers can supply it.
 */
export function preLaunchTaskFor(
  targetKind: DebugTargetKind,
): string | undefined {
  const spec = TASK_SPECS.find(
    (candidate) => candidate.targetKind === targetKind,
  );
  return spec ? taskLabel(spec) : undefined;
}
