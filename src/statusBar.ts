// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createStatusBarPresentation } from "@alp-sdk/core/boardSummary/service";
import { envReadinessPresentation } from "@alp-sdk/core/statusReadiness/service";
import { loadBoardSummary } from "./boardSummary/vscodeAdapter";
import type { AlpIdeState } from "./ideHub/messages";
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
  env: vscode.StatusBarItem,
  sdk: vscode.StatusBarItem,
  target: vscode.StatusBarItem,
  build: vscode.StatusBarItem,
  flash: vscode.StatusBarItem,
): void {
  // Overall Alp env-readiness glance (Python/west/tan/SDK/workspace). Full
  // detail lives in the hover + the Hub; clicking opens the Hub.
  const envP = envReadinessPresentation(state);
  env.text = envP.text;
  env.tooltip = envP.tooltip;
  env.show();

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
  const env = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    102,
  );
  env.command = "alp.openHub";

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

  render(stateMgr.state, env, sdk, target, build, flash);
  const sub = stateMgr.onStateChange((state) =>
    render(state, env, sdk, target, build, flash),
  );

  return vscode.Disposable.from(env, sdk, target, build, flash, sub);
}
