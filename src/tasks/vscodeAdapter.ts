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
import { warnIfCliCannotBuildSom } from "../build/somCliFloorGuard";
import { planPrecondition } from "../notify/service";
import { notifyAsync } from "../notify/vscodeAdapter";
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
    // #605: `cwd` unresolved must REFUSE, not dispatch with it `undefined` —
    // `runAlpInTerminal`'s own doc names exactly this hazard: an omitted cwd
    // reaches `child_process.spawn` unset and the child inherits the
    // extension host's own directory (on Windows, the VS Code install
    // directory), and `tan build` WRITES a `build/` tree where it runs. This
    // task is what `--pre-launch-task` runs on F5, so a customer with no
    // folder open would otherwise get a build in the wrong place with no
    // explanation — the same shape `src/models/panel.ts` and
    // `src/ideHub/buildPlanPanel.ts` already refuse in this diff. Checked
    // BEFORE the "building..." line and the finish-event subscription: no
    // run is dispatched, so nothing should look like one started.
    if (!this.cwd) {
      notifyAsync(planPrecondition("noWorkspace", { operation: "build" }));
      this.writeEmitter.fire("Alp: open a folder to build this project.\r\n");
      this.finish(1);
      return;
    }
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
      void this.dispatchBuild(this.cwd).then(
        () => this.failIfNothingStarted(),
        () => this.failIfNothingStarted(),
      );
    }
  }

  /** #606: this `tan build` was one of the four spawn sites that skipped
   *  #502's Renesas CLI-floor warning — and the one reached by `--pre-
   *  launch-task`, so a Renesas customer hitting it from F5 got the bare
   *  Kconfig abort with no explanation at all. `cwd` is narrowed to `string`
   *  by the caller (`open()`'s guard above), so this always runs the check —
   *  there is no second "cwd unresolved" branch to keep in sync with it. */
  private async dispatchBuild(cwd: string): Promise<void> {
    await warnIfCliCannotBuildSom(this.context, cwd);
    await runAlpInTerminal(this.context, ["build"], {
      name: BUILD_RUN_NAME,
      cwd,
    });
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
 *  deploy story, and the yocto-userspace configuration `tan debug-config`
 *  writes ships `miDebuggerServerAddress: "<host>:<port>"` for the user to
 *  fill in by hand — a remote address nothing can derive from a build (see
 *  docs/DEBUG.md §10.4). This must never silently succeed — exiting 0 would
 *  imply a deploy happened, so it exits 1 with the manual step named.
 *
 *  That exit code is also why no generated profile references this label:
 *  `preLaunchTaskFor` (./service.ts) maps yocto-userspace to nothing, because
 *  a task that always fails would raise VS Code's failed-preLaunchTask dialog
 *  on every F5, including a remote setup the customer already has working.
 *  The label stays registered, reachable from the Tasks picker, which is
 *  where this message shows. */
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

/** Registers the provider backing the four `alp:` task labels — the three a
 *  generated launch.json profile references as its `preLaunchTask`, plus the
 *  picker-only gdbserver placeholder. Caller pushes the returned disposable
 *  onto `context.subscriptions`. */
export function registerAlpTaskProvider(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.tasks.registerTaskProvider(
    TASK_TYPE,
    new AlpTaskProvider(context),
  );
}
