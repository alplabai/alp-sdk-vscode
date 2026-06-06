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
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.command = command;
    this.contextValue = "project-item";
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

    if (!workspace.workspaceRoot) {
      this.items = [
        new ProjectItem("No workspace open", "", new vscode.ThemeIcon("info")),
      ];
    } else if (!workspace.boardYamlExists) {
      this.items = [
        new ProjectItem(
          "No board.yaml found",
          "Create or open an Alp project",
          new vscode.ThemeIcon(
            "warning",
            new vscode.ThemeColor("problemsWarningIcon.foreground"),
          ),
        ),
        new ProjectItem(
          "New Project",
          "Create from template",
          new vscode.ThemeIcon("add"),
          { command: "alp.newProjectWizard", title: "New Project" },
        ),
        new ProjectItem(
          "Open Existing",
          "Open existing Alp project",
          new vscode.ThemeIcon("folder-opened"),
          {
            command: "alp.openExistingProject",
            title: "Open Existing Project",
          },
        ),
      ];
    } else {
      const projectName = path.basename(workspace.workspaceRoot);
      this.items = [
        new ProjectItem(
          projectName,
          "Active project",
          new vscode.ThemeIcon("circuit-board"),
          { command: "alp.openConfigurator", title: "Open Configurator" },
        ),
        new ProjectItem(
          "Configure Board",
          "Open board configurator",
          new vscode.ThemeIcon("settings-gear"),
          { command: "alp.openConfigurator", title: "Open Configurator" },
        ),
        new ProjectItem(
          "Validate board.yaml",
          "",
          new vscode.ThemeIcon("check-all"),
          { command: "alp.validateBoardYaml", title: "Validate" },
        ),
        new ProjectItem(
          "Preview Config",
          "Preview effective config",
          new vscode.ThemeIcon("eye"),
          { command: "alp.previewEffectiveConfig", title: "Preview Config" },
        ),
      ];
    }

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
