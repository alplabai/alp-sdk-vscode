// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import * as vscode from "vscode";
import type { AlpIdeState } from "../ideHub/messages";
import type { StateManager } from "./stateManager";

class WorkspaceItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: vscode.ThemeIcon,
    command?: vscode.Command,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.command = command;
    this.contextValue = "workspace-item";
  }
}

export class WorkspacesTreeProvider
  implements vscode.TreeDataProvider<WorkspaceItem>, vscode.Disposable
{
  private readonly _emitter = new vscode.EventEmitter<
    WorkspaceItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._emitter.event;
  private items: WorkspaceItem[] = [];

  constructor(stateMgr: StateManager) {
    stateMgr.onStateChange((s) => this.updateItems(s));
    this.updateItems(stateMgr.state);
  }

  private updateItems(state: AlpIdeState): void {
    const { workspace } = state;

    if (!workspace.workspaceRoot) {
      this.items = [
        new WorkspaceItem(
          "No workspace open",
          "Open a folder to get started",
          new vscode.ThemeIcon("info"),
        ),
      ];
    } else if (!workspace.westInitialized) {
      this.items = [
        new WorkspaceItem(
          path.basename(workspace.workspaceRoot),
          "West not initialized",
          new vscode.ThemeIcon("folder"),
        ),
        new WorkspaceItem(
          "Initialize West",
          "Run west init",
          new vscode.ThemeIcon("play"),
          { command: "alp.openSetupFlow", title: "Setup" },
        ),
      ];
    } else {
      this.items = [
        new WorkspaceItem(
          path.basename(workspace.workspaceRoot),
          "Initialized",
          new vscode.ThemeIcon(
            "folder-opened",
            new vscode.ThemeColor("testing.iconPassed"),
          ),
        ),
        new WorkspaceItem(
          "West Update",
          "Fetch & update modules",
          new vscode.ThemeIcon("sync"),
          { command: "alp.westUpdate", title: "West Update" },
        ),
      ];
    }

    this._emitter.fire(undefined);
  }

  getTreeItem(element: WorkspaceItem): WorkspaceItem {
    return element;
  }

  getChildren(element?: WorkspaceItem): WorkspaceItem[] {
    if (element) return [];
    return this.items;
  }

  dispose(): void {
    this._emitter.dispose();
  }
}
