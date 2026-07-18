// SPDX-License-Identifier: Apache-2.0
//
// Build/flash commands. The orchestrator-backed workflow (build/image/flash/
// clean/renode) now delegates to the native CLI, which wraps the SDK's
// `west alp-*` driver — board.yaml validation, per-core generation, and the
// Zephyr/Yocto/baremetal dispatch all live in the SDK orchestrator, not here
// (see EXTENSION_CLI_INTEGRATION.md §6a). board.yaml diagnostics still surface
// live via the in-process LSP, so no pre-build check is duplicated here.
//
// The plain `west flash`/`west update` commands have no CLI equivalent and stay
// as direct west terminal invocations for now (revisited in B4). `west run` for
// native_sim is already folded into `alp run` (#131 — see westRunNativeSim below).

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

// ── CLI-backed orchestrator workflow (alp build/image/flash/clean/renode) ─────

async function alpBuild(context: vscode.ExtensionContext): Promise<void> {
  const app = await pickAppPath("examples/peripheral-io/gpio-button-led");
  if (!app) return;
  await runAlpInTerminal(context, ["build", app], {
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
  // Route through the CLI (`alp run`) so the SDK owns the board target and
  // build dir — a bare `west build -t run` has no `-b`/`-d`, so it aborts on an
  // unbuilt project or reuses a prior silicon `build/` dir, and never lands the
  // binary where the native_sim debug config looks (issue #131).
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
