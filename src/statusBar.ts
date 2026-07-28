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
 *   $(play) Build            → alp.westBuild    (tan build)
 *   $(zap)  Flash            → alp.westAlpFlash (tan flash)
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
  // Overall Alp env-readiness glance (Python/west/tan/SDK/workspace/bootstrap
  // in flight). Full detail lives in the hover + the Hub; clicking opens the
  // Hub.
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

  // Build/Flash both drive the tan-orchestrated pipeline (validate + generate +
  // per-slice build/flash) — only meaningful once a board.yaml exists AND the
  // west workspace is initialized (matches the tree's gating), and never while
  // a bootstrap is still populating that workspace: `.west/config` exists from
  // the start of the run, so `westInitialized` alone offered Build over a
  // half-fetched module tree.
  if (
    summary?.sku &&
    state.workspace.westInitialized &&
    !state.setup.bootstrapRunning
  ) {
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
  // Orchestrated flash (tan flash — board.yaml validation + per-slice dispatch),
  // matching the Build button's pipeline. The legacy plain `west flash`
  // (alp.westFlash, "Alp: Flash (single image)") stays in the Command Palette as the
  // advanced escape hatch.
  flash.tooltip =
    "Alp: build all slices and flash the device (alp.westAlpFlash)";
  flash.command = "alp.westAlpFlash";

  render(stateMgr.state, env, sdk, target, build, flash);
  const sub = stateMgr.onStateChange((state) =>
    render(state, env, sdk, target, build, flash),
  );
  // No terminal-finish subscription here on purpose: re-rendering the snapshot
  // this file already holds would repaint STALE state — at the exact moment a
  // bootstrap succeeds, a bar still holding `westInitialized: false` would
  // paint "$(warning) Alp: setup", a warning at the moment of success.
  // src/extension.ts refreshes the shared state on that same event (and on
  // task start), and the refresh fires `onStateChange` above.
  return vscode.Disposable.from(env, sdk, target, build, flash, sub);
}
