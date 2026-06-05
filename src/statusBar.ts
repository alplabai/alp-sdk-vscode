// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createStatusBarPresentation } from "@alp-sdk/core/boardSummary/service";
import { loadBoardSummary } from "./boardSummary/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";

/**
 * Status-bar surface for the active board (left-aligned, reading order):
 *   $(circuit-board) <sku>   → open the board configurator
 *   $(play) Build            → alp.westBuild   (shown only when a board exists)
 *   $(zap)  Flash            → alp.westFlash   (shown only when a board exists)
 *
 * Making Build/Flash always-visible one-click actions follows the VS Code
 * status-bar pattern (cf. the run/debug + language items) — see
 * docs/ADR-native-shell-ux.md phase A.
 */
function refresh(
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

  // Build/Flash are only meaningful once a board.yaml exists; the target chip
  // otherwise reads "no board.yaml" and routes to the configurator.
  if (summary?.sku) {
    build.show();
    flash.show();
  } else {
    build.hide();
    flash.hide();
  }
}

export function createStatusBar(): vscode.Disposable {
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

  refresh(target, build, flash);

  const watcher = vscode.workspace.createFileSystemWatcher("**/board.yaml");
  watcher.onDidChange(() => refresh(target, build, flash));
  watcher.onDidCreate(() => refresh(target, build, flash));
  watcher.onDidDelete(() => refresh(target, build, flash));

  return vscode.Disposable.from(target, build, flash, watcher);
}
