// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import {
    createWestBuildPlan,
    createWestFlashPlan,
    createWestNativeRunPlan,
} from "./west/service";
import {
    collectWestWorkspaceContext,
    executeWestPlan,
} from "./west/vscodeAdapter";

async function pickBoardAndExamplePath(): Promise<{
  board: string;
  example: string;
} | null> {
  const board = await vscode.window.showInputBox({
    prompt: "Zephyr board target (e.g. native_sim/native/64, alp_e1m_evk_aen)",
    value: "native_sim/native/64",
  });
  if (!board) return null;
  const example = await vscode.window.showInputBox({
    prompt: "Path to the application (relative to the west cwd)",
    value: "examples/gpio-button-led",
  });
  if (!example) return null;
  return { board, example };
}

async function westBuild(): Promise<void> {
  const sel = await pickBoardAndExamplePath();
  if (!sel) return;
  executeWestPlan(createWestBuildPlan(collectWestWorkspaceContext(), sel));
}

async function westFlash(): Promise<void> {
  executeWestPlan(createWestFlashPlan(collectWestWorkspaceContext()));
}

async function westRunNativeSim(): Promise<void> {
  executeWestPlan(createWestNativeRunPlan(collectWestWorkspaceContext()));
}

export function registerWestCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.westBuild", () => westBuild()),
    vscode.commands.registerCommand("alp.westFlash", () => westFlash()),
    vscode.commands.registerCommand("alp.westRunNativeSim", () =>
      westRunNativeSim(),
    ),
  ];
}
