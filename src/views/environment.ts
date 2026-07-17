// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { SdkTreeProvider } from "./sdk";
import { SetupTreeProvider } from "./setup";
import type { StateManager } from "./stateManager";

/** Non-interactive separator between the Setup and SDK sections. */
class SectionHeaderItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "section-header";
  }
}

/**
 * Composes the Setup and SDK tree views into the single "Environment" view:
 * Setup items first, then SDK items, under section-header separators.
 *
 * Both `SetupTreeProvider` and `SdkTreeProvider` are flat (root items only,
 * `getChildren(element)` is always `[]`), so composition is a root-level
 * concatenation rather than nested delegation. `getChildren(element)` still
 * routes to whichever sub-provider produced `element` — via an ownership map
 * rebuilt on every root query — so this keeps working if either sub-provider
 * grows real nested children later.
 */
export class EnvironmentTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private readonly setupProvider: SetupTreeProvider;
  private readonly sdkProvider: SdkTreeProvider;
  private readonly _emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._emitter.event;
  private readonly owner = new Map<vscode.TreeItem, "setup" | "sdk">();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(stateMgr: StateManager) {
    this.setupProvider = new SetupTreeProvider(stateMgr);
    this.sdkProvider = new SdkTreeProvider(stateMgr);
    this.disposables.push(
      this.setupProvider,
      this.sdkProvider,
      this.setupProvider.onDidChangeTreeData(() =>
        this._emitter.fire(undefined),
      ),
      this.sdkProvider.onDidChangeTreeData(() => this._emitter.fire(undefined)),
    );
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      this.owner.clear();
      const setupItems = this.setupProvider.getChildren(undefined);
      const sdkItems = this.sdkProvider.getChildren(undefined);
      for (const item of setupItems) this.owner.set(item, "setup");
      for (const item of sdkItems) this.owner.set(item, "sdk");
      return [
        new SectionHeaderItem("Setup"),
        ...setupItems,
        new SectionHeaderItem("SDK"),
        ...sdkItems,
      ];
    }

    const owner = this.owner.get(element);
    if (owner === "setup") return this.setupProvider.getChildren(element);
    if (owner === "sdk") return this.sdkProvider.getChildren(element);
    return [];
  }

  dispose(): void {
    this._emitter.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
