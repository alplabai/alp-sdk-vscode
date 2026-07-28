// SPDX-License-Identifier: Apache-2.0
//
// Build/flash commands. The orchestrator-backed workflow (build/image/flash/
// clean/renode/run) delegates to the native `tan` CLI (ADR-0020: tan is the
// sole executor + whole user command surface) — board.yaml validation,
// per-core generation, and the Zephyr/Yocto/baremetal dispatch all live behind
// tan, not here (see EXTENSION_CLI_INTEGRATION.md §6a). board.yaml diagnostics
// still surface live via the in-process LSP, so no pre-build check is
// duplicated here.
//
// The plain `west flash/update` commands are vanilla Zephyr west subcommands
// (not the retired `west alp-*` driver) with no tan equivalent, so they stay as
// direct west terminal invocations.

import { WestWorkspaceContext } from "@alp-sdk/core/west/models";
import {
  createWestFlashPlan,
  createWestUpdatePlan,
} from "@alp-sdk/core/west/service";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { runAlpCommand, runAlpInTerminal } from "./alpCli/vscodeAdapter";
import { planPrecondition } from "./notify/service";
import { notify } from "./notify/vscodeAdapter";
import {
  collectWestWorkspaceContext,
  executeWestPlan,
  nativeSimOverlayExists,
} from "./west/vscodeAdapter";
import { log } from "./util";

/** The directory a `tan` run should use, or undefined when nothing resolves one
 *  (no folder open and no `alpSdk.westCwd`) — in which case the run must be
 *  refused, never spawned with an inherited cwd. Takes an already-collected
 *  context so a caller that needs both doesn't resolve the project twice. */
function westCwd(
  context: WestWorkspaceContext = collectWestWorkspaceContext(),
): string | undefined {
  return context.westCwd ?? context.workspaceRoot ?? undefined;
}

async function pickAppPath(value: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: "Path to the application (relative to the west cwd)",
    value,
  });
}

/**
 * Where an orchestrator command (build/image/flash/clean/renode) should run.
 *
 * When the workspace holds a real board.yaml, the command targets that project
 * directly — no app-path prompt. Every `tan` orchestrator subcommand defaults
 * its app/project to the current directory (the unified "run from the project
 * dir" convention), so we run from the project root and pass no app argument.
 *
 * Only when no project is open do we fall back to prompting for an example app
 * to build. Returns `undefined` when the user cancels that prompt — or when
 * nothing resolves a cwd at all, which is refused here rather than in each of
 * the five callers: `tan build/image/flash/clean/renode` all WRITE where they
 * run, and with no folder open the child inherits the extension host's own
 * directory (on Windows, the VS Code install directory) and drops a `build/`
 * there. `cwd` is narrowed to `string` on the way out so the guard cannot be
 * bypassed by a later caller. Same builder the sibling sites use (bootstrap.ts,
 * toolchain.ts, wizard.ts, debug.ts, ideHub/workspaceCommands.ts).
 *
 * `operation` is the verb phrase `planPrecondition` renders into "Open a folder
 * to <operation>.", so it is per-command, not per-resolver.
 *
 * @callers 5 resolveOrchestratorTarget
 */
async function resolveOrchestratorTarget(
  fallbackExample: string,
  operation: string,
): Promise<{ appArg: string[]; cwd: string; active: boolean } | undefined> {
  const projectCtx = collectWestWorkspaceContext();
  const root = westCwd(projectCtx);
  if (!root) {
    await notify(planPrecondition("noWorkspace", { operation }));
    return undefined;
  }

  const projectRoot =
    projectCtx.boardYamlPath && fs.existsSync(projectCtx.boardYamlPath)
      ? path.dirname(projectCtx.boardYamlPath)
      : undefined;
  if (projectRoot) return { appArg: [], cwd: projectRoot, active: true };

  const app = await pickAppPath(fallbackExample);
  if (!app) return undefined;
  return { appArg: [app], cwd: root, active: false };
}

// ── CLI-backed orchestrator workflow (tan build/image/flash/clean/renode) ─────

async function alpBuild(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/peripheral-io/gpio-button-led",
    "build this project",
  );
  if (!target) return;
  // `tan build` (cli.rs BuildArgs) has no positional app_path — project scope
  // resolves from `--project` (which defaults to the cwd). Active project: a
  // bare `build` from the project root. Fallback: point `--project` at the
  // chosen example (a bare positional would be a parse error, not ignored).
  const args = target.active
    ? ["build"]
    : ["--project", ...target.appArg, "build"];
  await runAlpInTerminal(context, args, { name: "Alp Build", cwd: target.cwd });
}

async function alpImage(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/multicore/rpmsg-v2n",
    "build a flash image",
  );
  if (!target) return;
  await runAlpInTerminal(context, ["image", ...target.appArg], {
    name: "Alp Image",
    cwd: target.cwd,
  });
}

async function alpFlash(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/multicore/rpmsg-v2n",
    "flash this device",
  );
  if (!target) return;
  await runAlpInTerminal(context, ["flash", ...target.appArg], {
    name: "Alp Flash",
    cwd: target.cwd,
  });
}

async function alpClean(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/multicore/rpmsg-v2n",
    "clean this project",
  );
  if (!target) return;
  await runAlpInTerminal(context, ["clean", ...target.appArg], {
    name: "Alp Clean",
    cwd: target.cwd,
  });
}

async function alpRenode(context: vscode.ExtensionContext): Promise<void> {
  const target = await resolveOrchestratorTarget(
    "examples/multicore/rpmsg-v2n",
    "run this project in Renode",
  );
  if (!target) return;
  await runAlpInTerminal(context, ["renode", ...target.appArg], {
    name: "Alp Renode",
    cwd: target.cwd,
  });
}

// ── legacy plain-west commands (no CLI equivalent yet) ────────────────────────

function westFlash(): void {
  executeWestPlan(createWestFlashPlan(collectWestWorkspaceContext()));
}

function westUpdate(): void {
  executeWestPlan(createWestUpdatePlan(collectWestWorkspaceContext()));
}

async function westRunNativeSim(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Its OWN guard, not the resolver's: this command never calls
  // `resolveOrchestratorTarget`, so deleting either one leaves the other path
  // still spawning `tan` with an inherited cwd. It sits ahead of the overlay
  // generation so that `tan generate` never runs against an arbitrary
  // directory either.
  const root = westCwd();
  if (!root) {
    await notify(
      planPrecondition("noWorkspace", { operation: "run this project" }),
    );
    return;
  }
  await ensureNativeSimOverlay(context);
  // Route through the CLI (`tan run`) so the SDK owns the board target and
  // build dir — a bare `west build -t run` has no `-b`/`-d`, so it aborts on an
  // unbuilt project or reuses a prior silicon `build/` dir, and never lands the
  // binary where the native_sim debug config looks (issue #131).
  //
  // native_sim is a HOST target: `tan run` (no `--flash`) builds + executes the
  // native_sim binary. Flashing needs EXPLICIT consent — a hardware target uses
  // `tan run --flash` (build + flash). This Run action is native_sim only, so
  // it never passes `--flash`; hardware programming is the separate Flash
  // action (`tan flash`, alp.westAlpFlash).
  await runAlpInTerminal(context, ["run"], {
    name: "Alp Run (native_sim)",
    cwd: root,
  });
}

/** Generate `boards/native_sim_native_64.overlay` on demand before a native_sim
 *  run so a GPIO app resolves its pins under host emulation (issue #86).
 *  Best-effort: a non-GPIO app doesn't need it, and an older SDK may not ship
 *  the emit, so a failure is logged and the run proceeds regardless. Idempotent
 *  (no-op when the overlay already exists) and fail-soft (generation failure
 *  is logged, never thrown) — safe to call from both the Run and Debug paths. */
export async function ensureNativeSimOverlay(
  context: vscode.ExtensionContext,
): Promise<void> {
  const root = collectWestWorkspaceContext().workspaceRoot;
  if (!root || nativeSimOverlayExists(root)) return;

  const { outcome } = await runAlpCommand(context, [
    "generate",
    "--target",
    "native-sim-overlay",
  ]);
  if (!outcome.ok) {
    log(`[native_sim] overlay generation skipped: ${outcome.message}`);
  }
}

export function registerWestCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.westBuild", () => alpBuild(context)),
    vscode.commands.registerCommand("alp.westFlash", () => westFlash()),
    vscode.commands.registerCommand("alp.westUpdate", () => westUpdate()),
    vscode.commands.registerCommand("alp.westRunNativeSim", () =>
      westRunNativeSim(context),
    ),
    vscode.commands.registerCommand("alp.westAlpImage", () =>
      alpImage(context),
    ),
    vscode.commands.registerCommand("alp.westAlpFlash", () =>
      alpFlash(context),
    ),
    vscode.commands.registerCommand("alp.westAlpClean", () =>
      alpClean(context),
    ),
    vscode.commands.registerCommand("alp.westAlpRenode", () =>
      alpRenode(context),
    ),
  ];
}
