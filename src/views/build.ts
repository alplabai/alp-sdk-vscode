// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import type { AlpIdeState } from "../ideHub/messages";
import type { StateManager } from "./stateManager";

class BuildItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: vscode.ThemeIcon,
    command: vscode.Command,
    enabled = true,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = enabled ? description : "workspace not initialized";
    this.iconPath = icon;
    this.command = enabled ? command : undefined;
    this.contextValue = enabled ? "build-item" : "build-item-disabled";
    if (!enabled) {
      this.tooltip = "Initialize your workspace first";
    }
  }
}

const BUILD_ACTIONS: Array<{
  label: string;
  description: string;
  icon: string;
  command: string;
}> = [
  {
    label: "West Build",
    description: "validate + generate + build",
    icon: "play",
    command: "alp.westBuild",
  },
  {
    label: "West Flash",
    description: "flash connected device",
    icon: "zap",
    command: "alp.westFlash",
  },
  {
    label: "Run (native_sim)",
    description: "simulate under native_sim",
    icon: "debug-start",
    command: "alp.westRunNativeSim",
  },
  {
    label: "ALP Image",
    description: "assemble image bundle",
    icon: "package",
    command: "alp.westAlpImage",
  },
  {
    label: "ALP Flash",
    description: "flash all slices",
    icon: "rocket",
    command: "alp.westAlpFlash",
  },
  {
    label: "Renode Simulate",
    description: "simulate in Renode",
    icon: "beaker",
    command: "alp.westAlpRenode",
  },
  {
    label: "West Update",
    description: "fetch & update modules",
    icon: "sync",
    command: "alp.westUpdate",
  },
  {
    label: "Clean Build",
    description: "remove build directory",
    icon: "trash",
    command: "alp.westAlpClean",
  },
];

export class BuildTreeProvider
  implements vscode.TreeDataProvider<BuildItem>, vscode.Disposable
{
  private readonly _emitter = new vscode.EventEmitter<
    BuildItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._emitter.event;
  private items: BuildItem[] = [];

  constructor(stateMgr: StateManager) {
    stateMgr.onStateChange((s) => this.updateItems(s));
    this.updateItems(stateMgr.state);
  }

  private updateItems(state: AlpIdeState): void {
    const enabled = state.workspace.westInitialized;

    this.items = BUILD_ACTIONS.map(
      (a) =>
        new BuildItem(
          a.label,
          a.description,
          new vscode.ThemeIcon(a.icon),
          { command: a.command, title: a.label },
          enabled,
        ),
    );

    this._emitter.fire(undefined);
  }

  getTreeItem(element: BuildItem): BuildItem {
    return element;
  }

  getChildren(element?: BuildItem): BuildItem[] {
    if (element) return [];
    return this.items;
  }

  dispose(): void {
    this._emitter.dispose();
  }
}
