// SPDX-License-Identifier: Apache-2.0
//
// Build/flash commands. The orchestrator-backed workflow (build/image/flash/
// clean/renode) now delegates to the native CLI, which wraps the SDK's
// `west alp-*` driver — board.yaml validation, per-core generation, and the
// Zephyr/Yocto/baremetal dispatch all live in the SDK orchestrator, not here
// (see EXTENSION_CLI_INTEGRATION.md §6a). board.yaml diagnostics still surface
// live via the in-process LSP, so no pre-build check is duplicated here.
//
// The plain `west flash/update/run` commands have no CLI equivalent and stay as
// direct west terminal invocations for now (revisited in B4).

import {
  createWestFlashPlan,
  createWestNativeRunPlan,
  createWestUpdatePlan,
} from "@alp-sdk/core/west/service";
import * as vscode from "vscode";

import { runAlpInTerminal } from "./alpCli/vscodeAdapter";
import {
  collectWestWorkspaceContext,
  executeWestPlan,
} from "./west/vscodeAdapter";

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
  const app = await pickAppPath("examples/gpio-button-led");
  if (!app) return;
  await runAlpInTerminal(context, ["build", app], {
    name: "ALP Build",
    cwd: westCwd(),
  });
}

async function alpImage(context: vscode.ExtensionContext): Promise<void> {
  const app = await pickAppPath("examples/rpmsg-v2n");
  if (!app) return;
  await runAlpInTerminal(context, ["image", app], {
    name: "ALP Image",
    cwd: westCwd(),
  });
}

async function alpFlash(context: vscode.ExtensionContext): Promise<void> {
  const app = await pickAppPath("examples/rpmsg-v2n");
  if (!app) return;
  await runAlpInTerminal(context, ["flash", app], {
    name: "ALP Flash",
    cwd: westCwd(),
  });
}

async function alpClean(context: vscode.ExtensionContext): Promise<void> {
  const app = await pickAppPath("examples/rpmsg-v2n");
  if (!app) return;
  await runAlpInTerminal(context, ["clean", app], {
    name: "ALP Clean",
    cwd: westCwd(),
  });
}

async function alpRenode(context: vscode.ExtensionContext): Promise<void> {
  const app = await pickAppPath("examples/rpmsg-v2n");
  if (!app) return;
  await runAlpInTerminal(context, ["renode", app], {
    name: "ALP Renode",
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

function westRunNativeSim(): void {
  executeWestPlan(createWestNativeRunPlan(collectWestWorkspaceContext()));
}

export function registerWestCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.westBuild", () => alpBuild(context)),
    vscode.commands.registerCommand("alp.westFlash", () => westFlash()),
    vscode.commands.registerCommand("alp.westUpdate", () => westUpdate()),
    vscode.commands.registerCommand("alp.westRunNativeSim", () =>
      westRunNativeSim(),
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
