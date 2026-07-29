// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import type { AlpIdeState } from "../ideHub/messages";
import type { StateManager } from "./stateManager";

class SdkItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: vscode.ThemeIcon,
    command?: vscode.Command,
    contextVal?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = icon;
    this.command = command;
    this.contextValue = contextVal ?? "sdk-item";
  }
}

export class SdkTreeProvider
  implements vscode.TreeDataProvider<SdkItem>, vscode.Disposable
{
  private readonly _emitter = new vscode.EventEmitter<
    SdkItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._emitter.event;
  private items: SdkItem[] = [];

  constructor(stateMgr: StateManager) {
    stateMgr.onStateChange((s) => this.updateItems(s));
    this.updateItems(stateMgr.state);
  }

  private updateItems(state: AlpIdeState): void {
    const { sdk } = state;

    const readyIcon = new vscode.ThemeIcon(
      "pass",
      new vscode.ThemeColor("testing.iconPassed"),
    );
    const inactiveIcon = new vscode.ThemeIcon("package");

    // `active` is decided host-side (#361) — a raw path compare here misses
    // when a hand-typed alpSdk.path differs only in case or a trailing slash.
    const activeEntry = sdk.localEntries.find((e) => e.active);
    const otherEntries = sdk.localEntries.filter((e) => !e.active);

    this.items = [];

    if (!sdk.activePath) {
      this.items.push(
        new SdkItem(
          "No SDK configured",
          "Click to configure",
          new vscode.ThemeIcon(
            "warning",
            new vscode.ThemeColor("problemsWarningIcon.foreground"),
          ),
          { command: "alp.openSdkManager", title: "Configure SDK" },
        ),
      );
    } else if (activeEntry) {
      this.items.push(
        new SdkItem(
          `SDK ${activeEntry.version ?? "unknown"}`,
          "Active",
          readyIcon,
          undefined,
          "sdk-active",
        ),
      );
    } else {
      this.items.push(
        new SdkItem(
          "Custom SDK",
          sdk.activePath,
          readyIcon,
          undefined,
          "sdk-active",
        ),
      );
    }

    for (const entry of otherEntries) {
      this.items.push(
        new SdkItem(
          `SDK ${entry.version ?? "unknown"}`,
          "Installed",
          inactiveIcon,
          { command: "alp.openSdkManager", title: "Manage SDKs" },
        ),
      );
    }

    this.items.push(
      new SdkItem(
        "Manage SDKs",
        "Install, switch, update",
        new vscode.ThemeIcon("extensions"),
        { command: "alp.openSdkManager", title: "Open SDK Manager" },
      ),
    );

    this._emitter.fire(undefined);
  }

  getTreeItem(element: SdkItem): SdkItem {
    return element;
  }

  getChildren(element?: SdkItem): SdkItem[] {
    if (element) return [];
    return this.items;
  }

  dispose(): void {
    this._emitter.dispose();
  }
}
