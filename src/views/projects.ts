// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import * as vscode from "vscode";
import type { AlpIdeState } from "../ideHub/messages";
import type { StateManager } from "./stateManager";

class ProjectItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: vscode.ThemeIcon,
    command?: vscode.Command,
    contextValue = "project-item",
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.command = command;
    this.contextValue = contextValue;
  }
}

export class ProjectsTreeProvider
  implements vscode.TreeDataProvider<ProjectItem>, vscode.Disposable
{
  private readonly _emitter = new vscode.EventEmitter<
    ProjectItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._emitter.event;
  private items: ProjectItem[] = [];

  constructor(stateMgr: StateManager) {
    stateMgr.onStateChange((s) => this.updateItems(s));
    this.updateItems(stateMgr.state);
  }

  private updateItems(state: AlpIdeState): void {
    const { workspace } = state;

    // Empty states (no workspace / no board.yaml) render via native
    // viewsWelcome panels (see package.json) keyed off the context key below,
    // so the tree returns no items and VS Code shows the welcome buttons.
    let stateKey: "no-workspace" | "no-board" | "ready";
    if (!workspace.workspaceRoot) {
      stateKey = "no-workspace";
      this.items = [];
    } else if (!workspace.boardYamlExists) {
      stateKey = "no-board";
      this.items = [];
    } else {
      stateKey = "ready";
      const projectName = path.basename(workspace.workspaceRoot);
      // One clean row for the active project; the Configure / Validate /
      // Preview actions hang off it as inline icons (package.json
      // view/item/context, group "inline") rather than stacked rows.
      this.items = [
        new ProjectItem(
          projectName,
          "Active project",
          new vscode.ThemeIcon("circuit-board"),
          { command: "alp.openConfigurator", title: "Open Configurator" },
          "alp-project-active",
        ),
      ];
    }

    void vscode.commands.executeCommand(
      "setContext",
      "alp-ide.projectsState",
      stateKey,
    );
    this._emitter.fire(undefined);
  }

  getTreeItem(element: ProjectItem): ProjectItem {
    return element;
  }

  getChildren(element?: ProjectItem): ProjectItem[] {
    if (element) return [];
    return this.items;
  }

  dispose(): void {
    this._emitter.dispose();
  }
}
