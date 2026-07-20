// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createStatusBarPresentation } from "@alp-sdk/core/boardSummary/service";
import { loadBoardSummary } from "./boardSummary/vscodeAdapter";
import type { AlpIdeState } from "./ideHub/messages";
import { derivePhase } from "./ideHub/phase";
import { collectProjectContext } from "./project/vscodeAdapter";
import type { StateManager } from "./views/stateManager";

/**
 * Status-bar surface (left-aligned, reading order):
 *   $(package) <sdk>         → alp.selectSdk (active SDK + per-project picker)
 *   $(circuit-board) <sku>   → open the board configurator
 *   $(play) Build            → alp.westBuild
 *   $(zap)  Flash            → alp.westFlash
 *
 * Everything reads one shared StateManager, so these items, the Build & Flash
 * tree, and the SDK Manager never disagree; the bar re-renders on every state
 * change (board.yaml, west init, active SDK, workspace).
 */
function render(
  state: AlpIdeState,
  sdk: vscode.StatusBarItem,
  target: vscode.StatusBarItem,
  build: vscode.StatusBarItem,
  flash: vscode.StatusBarItem,
): void {
  // Active SDK indicator + per-project picker (always visible).
  const sdkLabel =
    state.sdk.version ?? (state.sdk.activePath ? "SDK" : "No SDK");
  sdk.text = `$(package) ${sdkLabel}`;
  sdk.tooltip = state.sdk.activePath
    ? `Active Alp SDK: ${state.sdk.activePath}\nClick to change (per project)`
    : "No active Alp SDK — click to select";
  sdk.show();

  const summary = loadBoardSummary(collectProjectContext().boardYamlPath);
  const presentation = createStatusBarPresentation(summary);
  target.text = presentation.text;
  target.tooltip = presentation.tooltip;
  target.command = presentation.command;
  target.show();

  // Build/Flash invoke `west` commands — only meaningful once the full ladder
  // phase is "ready" (env set up + board present AND valid), matching the Build
  // & Flash tree and the palette enablement so the surfaces never disagree.
  if (derivePhase(state) === "ready") {
    build.show();
    flash.show();
  } else {
    build.hide();
    flash.hide();
  }
}

export function createStatusBar(stateMgr: StateManager): vscode.Disposable {
  const sdk = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    101,
  );
  sdk.command = "alp.selectSdk";

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

  render(stateMgr.state, sdk, target, build, flash);
  const sub = stateMgr.onStateChange((state) =>
    render(state, sdk, target, build, flash),
  );

  return vscode.Disposable.from(sdk, target, build, flash, sub);
}
