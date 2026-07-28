// SPDX-License-Identifier: Apache-2.0
//
// VS Code wiring for the four `preLaunchTask` targets tan's generated
// launch.json profiles reference (see service.ts for the string contract and
// PR #342 for why this exists: nothing defined these tasks, so pressing
// Debug wrote a profile whose preLaunchTask VS Code could never resolve —
// silent pre-launch abort, no useful error). This file owns the vscode seam:
// the CustomExecution pseudoterminals backing all four tasks. The three
// build tasks do NOT spawn `tan` themselves — they delegate to
// `runAlpInTerminal` (alpCli/vscodeAdapter.ts), the exact call the Build
// Plan panel's build button uses, under the identical run name (`BUILD_RUN_NAME`, exported by util.ts).
// That keeps binary resolution, `--sdk-root` augmentation, and the
// `runInTerminal` #146/#341 concurrency reservation in the ONE place that
// already owns them, instead of a second copy here — and, just as
// importantly, means `provideTasks` below does no I/O at all: resolution
// only happens inside a pseudoterminal's `open()`, which VS Code calls only
// when a task actually runs, never while merely populating the Run Task
// picker. A `provideTasks` that awaits a network-bound CLI download (the
// earlier shape of this file) can get the whole provider dropped by VS Code
// on a slow host, silently vanishing all four labels -- with the
// `onTaskType:alp` activation event, merely opening that picker was enough
// to trigger it. "deploy and start gdbserver" has no tan equivalent (see
// service.ts) and stays a simple one-line message pty.

import * as vscode from "vscode";

import { runAlpInTerminal } from "../alpCli/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import {
  BUILD_RUN_NAME,
  isRunActive,
  onDidFinishTerminalCommand,
} from "../util";
import { TASK_SOURCE, TASK_SPECS, TaskSpec } from "./service";

const TASK_TYPE = "alp";

// `BUILD_RUN_NAME` is IMPORTED, never re-declared here. This file used to
// carry its own `const BUILD_RUN_NAME = "alp build"` while the Build button
// dispatched under `"Alp Build"` — two literals in one registry are two
// reservations, i.e. a `preLaunchTask` build and a button build each running
// `tan build`/`ninja` over the same `build/` directory. The #146/#341 guard
// refuses a second dispatch only when both spell the name identically, which
// is why the name has exactly one definition (`src/util.ts`) and
// `test/util.terminalFinish.test.js` walks `src/**` for a re-typed literal.

/** A trivial Pseudoterminal that writes one line then closes with
 *  `exitCode`. Backs the "deploy and start gdbserver" placeholder (no tan
 *  equivalent exists — see service.ts). */
class MessagePty implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  // Typed to match Pseudoterminal.onDidClose exactly (Event<number | void>)
  // so `closeEmitter.event` needs no variance-dependent cast.
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  constructor(
    private readonly message: string,
    private readonly exitCode: number,
  ) {}

  open(): void {
    this.writeEmitter.fire(`${this.message}\r\n`);
    this.closeEmitter.fire(this.exitCode);
  }

  close(): void {
    // No child process was ever spawned — nothing to terminate.
  }
}

/**
 * Pseudoterminal backing the three build tasks. Delegates the actual build
 * to `runAlpInTerminal` under `BUILD_RUN_NAME` rather than spawning `tan`
 * itself, so this task's dispatch and the Build Plan panel's build button
 * share one reservation (see `BUILD_RUN_NAME`). If that name is already
 * running, this does NOT start a second one — it just waits for the
 * in-flight run to finish, since a duplicate `tan build`/`ninja` against the
 * same build dir is exactly what the shared reservation exists to prevent.
 *
 * This pty's own output stays a one-line pointer, not a duplicate log: its
 * own dispatch streams into the terminal `runAlpInTerminal` opens (or
 * reuses), and a run it merely WAITED on may be a channel run instead — the
 * Build button streams `tan build` into the "Alp SDK" output channel — so the
 * pointer names both surfaces rather than promising a terminal that, in that
 * case, does not exist.
 *
 * Residual behaviour: when a build is already running, this task WAITS for
 * it rather than failing fast, so a `preLaunchTask` stacked behind an
 * in-flight manual build blocks the debug session until that build
 * finishes. The user can cancel by terminating this task from the Tasks UI;
 * the build it was waiting on (owned by the other dispatch) keeps running
 * either way.
 */
class BuildDelegatePty implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;
  private subscription: vscode.Disposable | undefined;
  private settled = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cwd: string | undefined,
  ) {}

  open(): void {
    const alreadyRunning = isRunActive(BUILD_RUN_NAME);
    const status = alreadyRunning
      ? "a build is already running -- waiting for it to finish"
      : "building";
    this.writeEmitter.fire(
      `Alp: ${status} (output: the "${BUILD_RUN_NAME}" terminal, or the "Alp SDK" channel if it was started from the Build button)...\r\n`,
    );
    // Subscribe before dispatching so a same-tick finish can't be missed.
    this.subscription = onDidFinishTerminalCommand((event) => {
      if (event.name !== BUILD_RUN_NAME) return;
      // An undefined code means the task ended with no verdict (see
      // util.ts's `finish`) -- that must never read as success to a
      // `preLaunchTask`, which treats a 0 exit as "go ahead and debug".
      this.finish(event.code ?? 1);
    });
    if (!alreadyRunning) {
      void runAlpInTerminal(this.context, ["build"], {
        name: BUILD_RUN_NAME,
        cwd: this.cwd,
      }).then(
        () => this.failIfNothingStarted(),
        () => this.failIfNothingStarted(),
      );
    }
  }

  /** `runAlpInTerminal` RESOLVES without dispatching anything when the `tan`
   *  binary cannot be resolved — it reports that itself and returns. Nothing
   *  is reserved in that case, so no finish event will ever arrive and a
   *  `preLaunchTask` waiting on one would hang the debug session forever
   *  behind a terminal that says "building". `runInTerminal` reserves its
   *  slot synchronously before dispatching, so an active reservation here is
   *  proof a run really started. */
  private failIfNothingStarted(): void {
    if (this.settled || isRunActive(BUILD_RUN_NAME)) return;
    this.writeEmitter.fire(
      "Alp: the build did not start -- see the Alp SDK output channel.\r\n",
    );
    this.finish(1);
  }

  close(): void {
    this.subscription?.dispose();
    this.subscription = undefined;
  }

  private finish(code: number): void {
    this.settled = true;
    this.subscription?.dispose();
    this.subscription = undefined;
    this.closeEmitter.fire(code);
  }
}

/** "deploy and start gdbserver" has no tan equivalent: the extension has no
 *  deploy story, and the yocto-userspace debug profile ships
 *  `miDebuggerServerAddress: "<host>:<port>"` for the user to fill in by
 *  hand (see docs/DEBUG.md §10.4). This must never silently succeed — a
 *  no-op preLaunchTask would send the user straight into a cppdbg session
 *  with no gdbserver listening on the other end and no explanation. Exiting
 *  1 makes VS Code raise its "the preLaunchTask terminated with exit code 1
 *  — Debug Anyway / Show Errors" dialog, which is where this message shows. */
const DEPLOY_GDBSERVER_MESSAGE =
  "Alp: no automated deploy for a Yocto/userspace target -- copy the built " +
  "binary to the target and start gdbserver there by hand, then fill in " +
  '"miDebuggerServerAddress" in launch.json.';

/** Builds the `vscode.Task` for `spec` against `definition`. `resolveTask`
 *  must reuse the EXACT `TaskDefinition` object VS Code handed it (see its
 *  doc comment below), so `definition` is a parameter rather than always
 *  built fresh here. */
function toVsCodeTask(
  definition: vscode.TaskDefinition,
  spec: TaskSpec,
  execution: vscode.CustomExecution,
): vscode.Task {
  const task = new vscode.Task(
    definition,
    vscode.TaskScope.Workspace,
    spec.name,
    TASK_SOURCE,
    execution,
    // Explicitly NO problem matchers: an undefined list makes VS Code ask
    // "which kind of errors should the output be scanned for" the first time
    // the task runs, and a `preLaunchTask` prompting mid-Debug is worse than
    // no inline diagnostics. `$gcc` is contributed by cpptools, which is only
    // in the extension pack — naming it here would warn on a host without it.
    [],
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    clear: true,
  };
  return task;
}

/**
 * All three "build …" names run the identical `tan build` (it has no
 * per-target selector — see service.ts), delegated to `runAlpInTerminal` via
 * `BuildDelegatePty` — no binary resolution or workspace lookup happens
 * here; both are deferred into the pty's `open()`, which only runs once the
 * task actually starts.
 */
function createBuildTask(
  context: vscode.ExtensionContext,
  spec: TaskSpec,
  definition: vscode.TaskDefinition,
): vscode.Task {
  return toVsCodeTask(
    definition,
    spec,
    new vscode.CustomExecution(async () => {
      // Single source of truth for the workspace root (docs/ARCHITECTURE_
      // RULES.md §3) — in a multi-root workspace this picks the folder
      // holding board.yaml, same as every other Alp command, instead of
      // blindly taking workspaceFolders[0].
      const cwd = collectProjectContext().workspaceRoot ?? undefined;
      return new BuildDelegatePty(context, cwd);
    }),
  );
}

function createDeployGdbserverTask(
  spec: TaskSpec,
  definition: vscode.TaskDefinition,
): vscode.Task {
  return toVsCodeTask(
    definition,
    spec,
    new vscode.CustomExecution(
      async () => new MessagePty(DEPLOY_GDBSERVER_MESSAGE, 1),
    ),
  );
}

function buildTaskFor(
  context: vscode.ExtensionContext,
  spec: TaskSpec,
  definition: vscode.TaskDefinition,
): vscode.Task {
  return spec.kind === "build"
    ? createBuildTask(context, spec, definition)
    : createDeployGdbserverTask(spec, definition);
}

class AlpTaskProvider implements vscode.TaskProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  provideTasks(): vscode.Task[] {
    // No I/O, no binary resolution here — see the file-header comment. This
    // must stay cheap and synchronous so a slow/offline host never risks VS
    // Code dropping the provider before the four labels appear.
    return TASK_SPECS.map((spec) =>
      buildTaskFor(this.context, spec, { type: TASK_TYPE, task: spec.name }),
    );
  }

  /** VS Code calls this for a task declared in the user's `tasks.json`
   *  (`{"type": "alp", "task": "..."}`, offered by the `taskDefinitions`
   *  contribution in package.json) rather than one this provider already
   *  returned from `provideTasks`. Per the `TaskProvider.resolveTask` API
   *  contract, the returned task must reuse the EXACT `task.definition`
   *  object handed in here — not a freshly built one — so `definition` is
   *  threaded through to `toVsCodeTask` unchanged. An unrecognised `task`
   *  name (typo, or a stale label from a since-renamed spec) resolves to
   *  undefined rather than guessing. */
  resolveTask(task: vscode.Task): vscode.ProviderResult<vscode.Task> {
    const name = (task.definition as { task?: unknown }).task;
    if (typeof name !== "string") return undefined;
    const spec = TASK_SPECS.find((candidate) => candidate.name === name);
    if (!spec) return undefined;
    return buildTaskFor(this.context, spec, task.definition);
  }
}

/** Registers the provider backing the four `preLaunchTask` labels tan's
 *  generated launch.json profiles reference. Caller pushes the returned
 *  disposable onto `context.subscriptions`. */
export function registerAlpTaskProvider(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.tasks.registerTaskProvider(
    TASK_TYPE,
    new AlpTaskProvider(context),
  );
}
