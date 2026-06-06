// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import type { AlpIdeState } from "../ideHub/messages";
import type { StateManager } from "./stateManager";

class SetupItem extends vscode.TreeItem {
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
  }
}

export class SetupTreeProvider
  implements vscode.TreeDataProvider<SetupItem>, vscode.Disposable
{
  private readonly _emitter = new vscode.EventEmitter<
    SetupItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._emitter.event;
  private items: SetupItem[] = [];

  constructor(stateMgr: StateManager) {
    stateMgr.onStateChange((s) => this.updateItems(s));
    this.updateItems(stateMgr.state);
  }

  private updateItems(state: AlpIdeState): void {
    const { setup, sdk, workspace } = state;

    const readyIcon = new vscode.ThemeIcon(
      "pass",
      new vscode.ThemeColor("testing.iconPassed"),
    );
    const warnIcon = new vscode.ThemeIcon(
      "warning",
      new vscode.ThemeColor("problemsWarningIcon.foreground"),
    );
    const unknownIcon = new vscode.ThemeIcon("circle-slash");

    const toolsReady = setup.pythonAvailable && setup.westAvailable;

    this.items = [
      new SetupItem("Overview", "", new vscode.ThemeIcon("home"), {
        command: "alp.openOverview",
        title: "Open Overview",
      }),
      new SetupItem(
        "Host Tools",
        toolsReady ? "Ready" : "Action Required",
        toolsReady ? readyIcon : warnIcon,
        toolsReady
          ? undefined
          : {
              command: "alp.installDependencies",
              title: "Install Dependencies",
            },
      ),
      new SetupItem(
        "Python",
        setup.toolVersions.python ?? "Not found",
        setup.pythonAvailable ? readyIcon : warnIcon,
      ),
      new SetupItem(
        "West",
        setup.toolVersions.west ?? "Not found",
        setup.westAvailable ? readyIcon : warnIcon,
      ),
      new SetupItem(
        "Alp SDK",
        sdk.version
          ? `v${sdk.version}`
          : sdk.activePath
            ? "Path set"
            : "Not configured",
        sdk.activePath ? readyIcon : warnIcon,
        { command: "alp.openSdkManager", title: "Open SDK Manager" },
      ),
      new SetupItem(
        "Workspace",
        workspace.westInitialized
          ? "Initialized"
          : workspace.workspaceRoot
            ? "Not initialized"
            : "No workspace",
        workspace.westInitialized
          ? readyIcon
          : workspace.workspaceRoot
            ? warnIcon
            : unknownIcon,
        workspace.westInitialized
          ? undefined
          : { command: "alp.openSetupFlow", title: "Open Setup" },
      ),
    ];

    this._emitter.fire(undefined);
  }

  getTreeItem(element: SetupItem): SetupItem {
    return element;
  }

  getChildren(element?: SetupItem): SetupItem[] {
    if (element) return [];
    return this.items;
  }

  dispose(): void {
    this._emitter.dispose();
  }
}
