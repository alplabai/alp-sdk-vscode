// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createStatusBarPresentation } from "@alp-sdk/core/boardSummary/service";
import { loadBoardSummary } from "./boardSummary/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";

// Mirrors BUILD_TARGET_KEY in src/west.ts — the remembered { board, example }.
const BUILD_TARGET_KEY = "alp.buildTarget";

function refresh(
  context: vscode.ExtensionContext,
  summaryItem: vscode.StatusBarItem,
  buildItem: vscode.StatusBarItem,
  flashItem: vscode.StatusBarItem,
): void {
  const summary = loadBoardSummary(collectProjectContext().boardYamlPath);
  const presentation = createStatusBarPresentation(summary);
  summaryItem.text = presentation.text;
  summaryItem.tooltip = presentation.tooltip;
  summaryItem.command = presentation.command;
  summaryItem.show();

  const target = context.workspaceState.get<{ board?: string; example?: string }>(
    BUILD_TARGET_KEY,
  );
  buildItem.tooltip =
    target?.board && target?.example
      ? `Alp: west build — ${target.board} · ${target.example}`
      : "Alp: west build";

  if (summary?.sku) {
    buildItem.show();
    flashItem.show();
  } else {
    buildItem.hide();
    flashItem.hide();
  }
}

export function createStatusBar(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const summaryItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );

  const buildItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99,
  );
  buildItem.text = "$(tools) Build";
  buildItem.command = "alp.westBuild";

  const flashItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    98,
  );
  flashItem.text = "$(zap) Flash";
  flashItem.tooltip = "Alp: west flash";
  flashItem.command = "alp.westFlash";

  refresh(context, summaryItem, buildItem, flashItem);

  const watcher = vscode.workspace.createFileSystemWatcher("**/board.yaml");
  watcher.onDidChange(() => refresh(context, summaryItem, buildItem, flashItem));
  watcher.onDidCreate(() => refresh(context, summaryItem, buildItem, flashItem));
  watcher.onDidDelete(() => refresh(context, summaryItem, buildItem, flashItem));

  context.subscriptions.push(watcher, summaryItem, buildItem, flashItem);

  return summaryItem;
}
