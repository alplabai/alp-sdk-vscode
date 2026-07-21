// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { HubViewProvider } from "../ideHub/hubViewProvider";
import type { StateManager } from "./stateManager";

// The Alp IDE side panel is a single webview (HubViewProvider) rendering the
// Setup / Workspace / Project / SDK / Build & Flash sections the native trees
// used to. The tree provider files (setup / workspaces / projects / sdk / build)
// remain only for the in-host e2e suite. `stateMgr` is still refreshed here
// because the status bar (createStatusBar) reads from it; the hub is
// self-refreshing.
export function registerTreeViews(
  context: vscode.ExtensionContext,
  stateMgr: StateManager,
): vscode.Disposable[] {
  const hub = new HubViewProvider(context);

  const getLastBootstrapAt = (): string | null =>
    context.globalState.get<string>("alp.lastBootstrapAt") ?? null;

  const doRefresh = (): void => {
    void hub.refresh();
    void stateMgr.refresh(getLastBootstrapAt());
  };

  const boardYamlWatcher =
    vscode.workspace.createFileSystemWatcher("**/board.yaml");

  const disposables: vscode.Disposable[] = [
    boardYamlWatcher,
    vscode.window.registerWebviewViewProvider(HubViewProvider.viewType, hub, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("alp.views.refresh", doRefresh),
    // Back-compat aliases the flow panels, the setup orchestrator, and the
    // setup-flow webview still call. Focus reveals the Alp IDE container;
    // refresh re-runs both the hub and the status-bar state load.
    vscode.commands.registerCommand("alp.ideHub.focus", () =>
      vscode.commands.executeCommand("workbench.view.extension.alp-ide"),
    ),
    vscode.commands.registerCommand("alp.ideHub.refresh", doRefresh),
    vscode.workspace.onDidChangeWorkspaceFolders(doRefresh),
    boardYamlWatcher.onDidCreate(doRefresh),
    boardYamlWatcher.onDidChange(doRefresh),
    boardYamlWatcher.onDidDelete(doRefresh),
  ];

  // Initial status-bar state load (the hub loads on its own `ready`).
  void stateMgr.refresh(getLastBootstrapAt());

  return disposables;
}
