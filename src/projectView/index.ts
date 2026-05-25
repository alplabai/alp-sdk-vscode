// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import type { BoardSummary } from "@alp-sdk/core/boardSummary/models";
import { loadBoardSummary } from "../boardSummary/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import { AlpNode, buildProjectNodes } from "./model";

class AlpProjectTreeProvider implements vscode.TreeDataProvider<AlpNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  // Seeded by the mandatory refresh() in registerProjectView before first render.
  private summary: BoardSummary | null = null;

  getTreeItem(node: AlpNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.collapsible
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = node.id;
    if (node.description !== undefined) {
      item.description = node.description;
    }
    if (node.icon) {
      item.iconPath = new vscode.ThemeIcon(node.icon);
    }
    if (node.command) {
      item.command = { command: node.command, title: node.label };
    }
    return item;
  }

  getChildren(node?: AlpNode): AlpNode[] {
    if (node) {
      return node.children ?? [];
    }
    return buildProjectNodes(this.summary);
  }

  async refresh(): Promise<void> {
    this.summary = loadBoardSummary(collectProjectContext().boardYamlPath);
    // Await the context-key update so the welcome view's `!alpSdk.hasBoard`
    // guard is settled before the tree re-renders (no empty-tree flash).
    await vscode.commands.executeCommand(
      "setContext",
      "alpSdk.hasBoard",
      Boolean(this.summary?.sku),
    );
    this.emitter.fire();
  }
}

export function registerProjectView(): vscode.Disposable[] {
  const provider = new AlpProjectTreeProvider();
  const treeView = vscode.window.createTreeView("alpSdk.projectView", {
    treeDataProvider: provider,
  });

  const refreshCommand = vscode.commands.registerCommand(
    "alp.refreshProjectView",
    () => provider.refresh(),
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/board.yaml");

  // Seed the alpSdk.hasBoard context key for the welcome view.
  void provider.refresh();

  return [
    treeView,
    refreshCommand,
    watcher,
    watcher.onDidChange(() => provider.refresh()),
    watcher.onDidCreate(() => provider.refresh()),
    watcher.onDidDelete(() => provider.refresh()),
  ];
}
