// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createStatusBarPresentation } from "@alp-sdk/core/boardSummary/service";
import { loadBoardSummary } from "./boardSummary/vscodeAdapter";
import type { AlpIdeState } from "./ideHub/messages";
import { collectProjectContext } from "./project/vscodeAdapter";
import type { StateManager } from "./views/stateManager";

/**
 * Status-bar surface for the active board (left-aligned, reading order):
 *   $(circuit-board) <sku>   → open the board configurator
 *   $(play) Build            → alp.westBuild
 *   $(zap)  Flash            → alp.westFlash
 *
 * Build/Flash are gated on the same `westInitialized` signal the Build & Flash
 * tree uses (a shared StateManager), so the two surfaces never disagree — and
 * the bar re-renders on every state change (board.yaml, west init, workspace).
 */
function render(
  state: AlpIdeState,
  target: vscode.StatusBarItem,
  build: vscode.StatusBarItem,
  flash: vscode.StatusBarItem,
): void {
  const summary = loadBoardSummary(collectProjectContext().boardYamlPath);
  const presentation = createStatusBarPresentation(summary);
  target.text = presentation.text;
  target.tooltip = presentation.tooltip;
  target.command = presentation.command;
  target.show();

  // Build/Flash invoke `west` commands — only meaningful once a board.yaml
  // exists AND the west workspace is initialized (matches the tree's gating).
  if (summary?.sku && state.workspace.westInitialized) {
    build.show();
    flash.show();
  } else {
    build.hide();
    flash.hide();
  }
}

export function createStatusBar(stateMgr: StateManager): vscode.Disposable {
  const target = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );

  const build = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99,
  );
  build.text = "$(play) Build";
  build.tooltip = "Alp: validate, generate, and build (alp.westBuild)";
  build.command = "alp.westBuild";

  const flash = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    98,
  );
  flash.text = "$(zap) Flash";
  flash.tooltip = "Alp: flash the connected device (alp.westFlash)";
  flash.command = "alp.westFlash";

  render(stateMgr.state, target, build, flash);
  const sub = stateMgr.onStateChange((state) =>
    render(state, target, build, flash),
  );

  return vscode.Disposable.from(target, build, flash, sub);
}
