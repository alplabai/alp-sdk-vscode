// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createStatusBarPresentation } from "@alp-sdk/core/boardSummary/service";
import { loadBoardSummary } from "./boardSummary/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";

function refresh(
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
  buildItem.tooltip = "Alp: west build";
  buildItem.command = "alp.westBuild";

  const flashItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    98,
  );
  flashItem.text = "$(zap) Flash";
  flashItem.tooltip = "Alp: west flash";
  flashItem.command = "alp.westFlash";

  refresh(summaryItem, buildItem, flashItem);

  const watcher = vscode.workspace.createFileSystemWatcher("**/board.yaml");
  watcher.onDidChange(() => refresh(summaryItem, buildItem, flashItem));
  watcher.onDidCreate(() => refresh(summaryItem, buildItem, flashItem));
  watcher.onDidDelete(() => refresh(summaryItem, buildItem, flashItem));

  context.subscriptions.push(watcher, summaryItem, buildItem, flashItem);

  return summaryItem;
}
