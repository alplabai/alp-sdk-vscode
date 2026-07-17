// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { ProjectsTreeProvider } from "./projects";
import type { StateManager } from "./stateManager";
import { WorkspacesTreeProvider } from "./workspaces";

/** Non-interactive separator between the Projects and Workspaces sections. */
class SectionHeaderItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "section-header";
  }
}

/**
 * Composes the Projects and Workspaces tree views into the single
 * "Projects & Workspaces" view: Projects items first, then Workspaces items,
 * under section-header separators.
 *
 * Both `ProjectsTreeProvider` and `WorkspacesTreeProvider` are flat (root
 * items only, `getChildren(element)` is always `[]`), so composition is a
 * root-level concatenation rather than nested delegation. `getChildren(element)`
 * still routes to whichever sub-provider produced `element` — via an
 * ownership map rebuilt on every root query — so this keeps working if either
 * sub-provider grows real nested children later.
 */
export class ProjectsWorkspacesTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private readonly projectsProvider: ProjectsTreeProvider;
  private readonly workspacesProvider: WorkspacesTreeProvider;
  private readonly _emitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._emitter.event;
  private readonly owner = new Map<
    vscode.TreeItem,
    "projects" | "workspaces"
  >();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(stateMgr: StateManager) {
    this.projectsProvider = new ProjectsTreeProvider(stateMgr);
    this.workspacesProvider = new WorkspacesTreeProvider(stateMgr);
    this.disposables.push(
      this.projectsProvider,
      this.workspacesProvider,
      this.projectsProvider.onDidChangeTreeData(() =>
        this._emitter.fire(undefined),
      ),
      this.workspacesProvider.onDidChangeTreeData(() =>
        this._emitter.fire(undefined),
      ),
    );
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      this.owner.clear();
      const projectItems = this.projectsProvider.getChildren(undefined);
      const workspaceItems = this.workspacesProvider.getChildren(undefined);
      for (const item of projectItems) this.owner.set(item, "projects");
      for (const item of workspaceItems) this.owner.set(item, "workspaces");
      return [
        new SectionHeaderItem("Projects"),
        ...projectItems,
        new SectionHeaderItem("Workspaces"),
        ...workspaceItems,
      ];
    }

    const owner = this.owner.get(element);
    if (owner === "projects") return this.projectsProvider.getChildren(element);
    if (owner === "workspaces")
      return this.workspacesProvider.getChildren(element);
    return [];
  }

  dispose(): void {
    this._emitter.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
