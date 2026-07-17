// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";

/** Non-interactive separator rendered above each composed section. */
export class SectionHeaderItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "section-header";
  }
}

/**
 * A flat tree provider that can be composed into a {@link CompositeTreeProvider}:
 * synchronous, returns `TreeItem`s directly (identity `getTreeItem`). The
 * per-view providers (`SetupTreeProvider`, `SdkTreeProvider`, …) satisfy this
 * structurally.
 */
export interface ComposableView extends vscode.Disposable {
  readonly onDidChangeTreeData: vscode.Event<unknown>;
  getChildren(element?: vscode.TreeItem): vscode.TreeItem[];
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem;
}

/** One labelled section of a composite view. */
export interface CompositeSection {
  readonly label: string;
  readonly view: ComposableView;
}

/**
 * Composes several flat tree providers into a single view: each section's items
 * rendered under a {@link SectionHeaderItem}, in order. Re-fires on any section
 * change and owns/disposes every composed provider + subscription.
 *
 * The sections are flat today (root items only), so this is a root-level
 * concatenation. `getChildren(element)` still routes to whichever section
 * produced `element` — via an ownership map rebuilt on every root query — so it
 * keeps working if a section grows real nested children later.
 */
export class CompositeTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private readonly _emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._emitter.event;
  private readonly owner = new Map<vscode.TreeItem, ComposableView>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly sections: readonly CompositeSection[]) {
    for (const section of sections) {
      this.disposables.push(
        section.view,
        section.view.onDidChangeTreeData(() => this._emitter.fire(undefined)),
      );
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) {
      return this.owner.get(element)?.getChildren(element) ?? [];
    }
    this.owner.clear();
    const rows: vscode.TreeItem[] = [];
    for (const section of this.sections) {
      rows.push(new SectionHeaderItem(section.label));
      const items = section.view.getChildren(undefined);
      for (const item of items) this.owner.set(item, section.view);
      rows.push(...items);
    }
    return rows;
  }

  dispose(): void {
    this._emitter.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
