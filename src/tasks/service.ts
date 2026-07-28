// SPDX-License-Identifier: Apache-2.0
//
// Pure task specs for the four `preLaunchTask` labels `tan debug-config`
// writes into launch.json (tan-cli crates/tan-core/src/debug_launch.rs:49,62,
// 75,93,107,115 — see docs/DEBUG.md §10). VS Code renders a *provided* task's
// label as `${source}: ${name}`, so TASK_SOURCE plus each spec's `name` here
// are the exact string contract with tan: renaming either side breaks
// `vscode.debug.startDebugging`'s `preLaunchTask` resolution silently (no
// compile error, no lint — the debug run just aborts pre-launch). This file
// is what makes that contract testable without an extension host: no
// `vscode`, `fs`, or `child_process` import here — those seams live in
// `vscodeAdapter.ts`.

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
}

/** The label VS Code shows and matches `preLaunchTask` against for `spec`. */
export function taskLabel(spec: TaskSpec): string {
  return `${TASK_SOURCE}: ${spec.name}`;
}

/**
 * The four tasks tan's generated launch.json profiles reference by label.
 *
 * `tan build` has NO per-target selector (crates/tan-cli/src/cli.rs
 * `BuildArgs`: only --plan/--plan-from/--materialise/--native/--manifest/
 * --manifest-from/--no-auto-bootstrap) — it builds every slice board.yaml
 * declares. So the three "build …" names below all run the identical `tan
 * build`; three labels exist because three debug-target kinds (zephyr-mcu,
 * baremetal-mcu, native-host) reference them under different names, not
 * because the command differs. Do not invent a --target/--core flag to
 * "properly" distinguish them — none exists on the tan side.
 *
 * "deploy and start gdbserver" has no tan equivalent at all: the extension
 * has no deploy story, and the yocto-userspace debug profile ships
 * `miDebuggerServerAddress: "<host>:<port>"` for the user to fill in by
 * hand. Its `deployGdbserver` kind gets a placeholder task (adapter side)
 * that names the manual step and fails loudly rather than faking success.
 */
export const TASK_SPECS: readonly TaskSpec[] = [
  { name: "build active target", kind: "build" },
  { name: "build baremetal target", kind: "build" },
  { name: "build native_sim target", kind: "build" },
  { name: "deploy and start gdbserver", kind: "deployGdbserver" },
];
