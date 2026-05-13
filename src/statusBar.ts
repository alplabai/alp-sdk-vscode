// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createStatusBarPresentation } from "./boardSummary/service";
import { loadBoardSummary } from "./boardSummary/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";

function refresh(item: vscode.StatusBarItem): void {
  const summary = loadBoardSummary(collectProjectContext().boardYamlPath);
  const presentation = createStatusBarPresentation(summary);
  item.text = presentation.text;
  item.tooltip = presentation.tooltip;
  item.command = presentation.command;
  item.show();
}

export function createStatusBar(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  refresh(item);

  const watcher = vscode.workspace.createFileSystemWatcher("**/board.yaml");
  watcher.onDidChange(() => refresh(item));
  watcher.onDidCreate(() => refresh(item));
  watcher.onDidDelete(() => refresh(item));
  context.subscriptions.push(watcher);

  return item;
}
