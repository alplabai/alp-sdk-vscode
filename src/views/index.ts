// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { BuildTreeProvider } from "./build";
import { EnvironmentTreeProvider } from "./environment";
import { ProjectsWorkspacesTreeProvider } from "./projectsWorkspaces";
import type { StateManager } from "./stateManager";

export function registerTreeViews(
  context: vscode.ExtensionContext,
  stateMgr: StateManager,
): vscode.Disposable[] {
  // Environment = Setup + SDK; Projects & Workspaces = Projects + Workspaces.
  // Each composite provider owns + disposes its two constituent providers.
  const environmentProvider = new EnvironmentTreeProvider(stateMgr);
  const projectsWorkspacesProvider = new ProjectsWorkspacesTreeProvider(
    stateMgr,
  );
  const buildProvider = new BuildTreeProvider(stateMgr);

  const getLastBootstrapAt = (): string | null =>
    context.globalState.get<string>("alp.lastBootstrapAt") ?? null;

  const doRefresh = (): void => {
    void stateMgr.refresh(getLastBootstrapAt());
  };

  const boardYamlWatcher =
    vscode.workspace.createFileSystemWatcher("**/board.yaml");

  const disposables: vscode.Disposable[] = [
    environmentProvider,
    projectsWorkspacesProvider,
    buildProvider,
    boardYamlWatcher,
    vscode.window.createTreeView("alp-ide.setup", {
      treeDataProvider: environmentProvider,
      showCollapseAll: false,
    }),
    vscode.window.createTreeView("alp-ide.projects", {
      treeDataProvider: projectsWorkspacesProvider,
      showCollapseAll: false,
    }),
    vscode.window.createTreeView("alp-ide.build", {
      treeDataProvider: buildProvider,
      showCollapseAll: false,
    }),
    vscode.commands.registerCommand("alp.views.refresh", doRefresh),
    // Back-compat aliases over the native shell: the flow panels, the setup
    // orchestrator, and the setup-flow webview still call these IDs (they were
    // registered by the now-retired ideHub webview provider). Focus reveals the
    // Alp IDE container; refresh re-runs the tree state load.
    vscode.commands.registerCommand("alp.ideHub.focus", () =>
      vscode.commands.executeCommand("workbench.view.extension.alp-ide"),
    ),
    vscode.commands.registerCommand("alp.ideHub.refresh", doRefresh),
    vscode.workspace.onDidChangeWorkspaceFolders(doRefresh),
    boardYamlWatcher.onDidCreate(doRefresh),
    boardYamlWatcher.onDidChange(doRefresh),
    boardYamlWatcher.onDidDelete(doRefresh),
  ];

  // Initial state load
  doRefresh();

  return disposables;
}
