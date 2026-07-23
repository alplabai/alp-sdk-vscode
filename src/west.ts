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

import {
  createWestFlashPlan,
  createWestUpdatePlan,
} from "@alp-sdk/core/west/service";
import * as vscode from "vscode";

import { runAlpCommand, runAlpInTerminal } from "./alpCli/vscodeAdapter";
import {
  collectWestWorkspaceContext,
  executeWestPlan,
  nativeSimOverlayExists,
} from "./west/vscodeAdapter";
import { log } from "./util";

function westCwd(): string | undefined {
  const context = collectWestWorkspaceContext();
  return context.westCwd ?? context.workspaceRoot ?? undefined;
}

async function pickAppPath(value: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: "Path to the application (relative to the west cwd)",
    value,
  });
}

// ── CLI-backed orchestrator workflow (tan build/image/flash/clean/renode) ─────

async function alpBuild(context: vscode.ExtensionContext): Promise<void> {
  const app = await pickAppPath("examples/peripheral-io/gpio-button-led");
  if (!app) return;
  // `tan build` (cli.rs BuildArgs) has no positional app_path — unlike
  // image/flash/clean/renode, project scope only resolves from the global
  // `--project` flag (native.rs resolve_cli_project_context). A bare
  // positional here is a parse error, not a silently-ignored arg.
  await runAlpInTerminal(context, ["--project", app, "build"], {
    name: "Alp Build",
    cwd: westCwd(),
  });
}

async function alpImage(context: vscode.ExtensionContext): Promise<void> {
  const app = await pickAppPath("examples/multicore/rpmsg-v2n");
  if (!app) return;
  await runAlpInTerminal(context, ["image", app], {
    name: "Alp Image",
    cwd: westCwd(),
  });
}

async function alpFlash(context: vscode.ExtensionContext): Promise<void> {
  const app = await pickAppPath("examples/multicore/rpmsg-v2n");
  if (!app) return;
  await runAlpInTerminal(context, ["flash", app], {
    name: "Alp Flash",
    cwd: westCwd(),
  });
}

async function alpClean(context: vscode.ExtensionContext): Promise<void> {
  const app = await pickAppPath("examples/multicore/rpmsg-v2n");
  if (!app) return;
  await runAlpInTerminal(context, ["clean", app], {
    name: "Alp Clean",
    cwd: westCwd(),
  });
}

async function alpRenode(context: vscode.ExtensionContext): Promise<void> {
  const app = await pickAppPath("examples/multicore/rpmsg-v2n");
  if (!app) return;
  await runAlpInTerminal(context, ["renode", app], {
    name: "Alp Renode",
    cwd: westCwd(),
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
    cwd: westCwd(),
  });
}

/** Generate `boards/native_sim_native_64.overlay` on demand before a native_sim
 *  run so a GPIO app resolves its pins under host emulation (issue #86).
 *  Best-effort: a non-GPIO app doesn't need it, and an older SDK may not ship
 *  the emit, so a failure is logged and the run proceeds regardless. */
async function ensureNativeSimOverlay(
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
