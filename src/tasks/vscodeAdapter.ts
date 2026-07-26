// SPDX-License-Identifier: Apache-2.0
//
// VS Code wiring for the four `preLaunchTask` targets tan's generated
// launch.json profiles reference (see service.ts for the string contract and
// PR #342 for why this exists: nothing defined these tasks, so pressing
// Debug wrote a profile whose preLaunchTask VS Code could never resolve —
// silent pre-launch abort, no useful error). This file owns the vscode/
// child-process seam: resolving the `tan` binary, building its argv/cwd the
// same way the rest of the extension does, and the CustomExecution
// pseudo-terminal for the one task with no tan equivalent.

import * as vscode from "vscode";

import { ResolvedBinary } from "../alpCli/adapterCore";
import {
  resolveAlpBinaryForContext,
  withSdkRoot,
} from "../alpCli/vscodeAdapter";
import { TASK_SOURCE, TASK_SPECS, TaskSpec } from "./service";

const TASK_TYPE = "alp";

/** A trivial Pseudoterminal that writes one line then closes with
 *  `exitCode`. Backs both the "deploy and start gdbserver" placeholder (no
 *  tan equivalent exists — see service.ts) and the fallback used when the
 *  `tan` binary itself can't be resolved for a build task, so a resolution
 *  failure fails just that task with a readable reason instead of throwing
 *  out of `provideTasks` (which would silently drop every contributed task,
 *  not just the one that failed to resolve). */
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

function toVsCodeTask(
  spec: TaskSpec,
  execution: vscode.ProcessExecution | vscode.CustomExecution,
): vscode.Task {
  const task = new vscode.Task(
    { type: TASK_TYPE, task: spec.name },
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
 * per-target selector — see service.ts) via a `ProcessExecution`, spawned
 * directly as an argv array with no shell in between (same shape
 * `runInTerminal` in `util.ts` uses). Binary resolution and the `--sdk-root`
 * augmentation mirror `runAlpInTerminal`/`runAlpCommand` in
 * `alpCli/vscodeAdapter.ts` rather than re-deriving new logic.
 */
async function createBuildTask(
  context: vscode.ExtensionContext,
  spec: TaskSpec,
): Promise<vscode.Task> {
  let binary: ResolvedBinary;
  try {
    binary = await resolveAlpBinaryForContext(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toVsCodeTask(
      spec,
      new vscode.CustomExecution(
        async () => new MessagePty(`Alp: tan CLI unavailable -- ${message}`, 1),
      ),
    );
  }
  // Same cwd the existing plain "alp build" command uses (buildPlanPanel.ts
  // handleRunBuild / west.ts alpBuild): the workspace root, since `tan build`
  // resolves its own project scope from the cwd.
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const argv = [binary.command, ...withSdkRoot(["build"])];
  return toVsCodeTask(
    spec,
    new vscode.ProcessExecution(argv[0], argv.slice(1), { cwd }),
  );
}

function createDeployGdbserverTask(spec: TaskSpec): vscode.Task {
  return toVsCodeTask(
    spec,
    new vscode.CustomExecution(
      async () => new MessagePty(DEPLOY_GDBSERVER_MESSAGE, 1),
    ),
  );
}

class AlpTaskProvider implements vscode.TaskProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async provideTasks(): Promise<vscode.Task[]> {
    return Promise.all(
      TASK_SPECS.map((spec) =>
        spec.kind === "build"
          ? createBuildTask(this.context, spec)
          : Promise.resolve(createDeployGdbserverTask(spec)),
      ),
    );
  }

  /** Every task this provider contributes is already fully resolved by
   *  `provideTasks` above (no lazy `tasks.json`-declared "alp" task exists
   *  for VS Code to hand back here for completion), so there's nothing to
   *  resolve. */
  resolveTask(): vscode.ProviderResult<vscode.Task> {
    return undefined;
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
