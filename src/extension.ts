// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { resetResolvedBinary } from "./alpCli/vscodeAdapter";
import { registerBootstrapCommand } from "./bootstrap";
import { registerConfiguratorEditor } from "./configurator/customEditor";
import { registerDebugCommands } from "./debug";
import { showHardwareExplorerPanel } from "./hardwareExplorer/panel";
import {
  BuildPlanPanel,
  ExistingProjectFlowPanel,
  NewProjectFlowPanel,
  OverviewPanel,
  registerWorkspaceCommands,
  SdkManagerPanel,
  SetupFlowPanel,
} from "./ideHub";
import { maybeOfferSetupPanel } from "./ideHub/setupOrchestrator";
import { registerLoaderCommands } from "./loader";
import { startLanguageServer, stopLanguageServer } from "./lsp/client";
import { registerLspCommands } from "./lsp/commands";
import { registerSelectSdkCommand } from "./sdk/activeSdk";
import { createStatusBar } from "./statusBar";
import { registerToolchainCommands } from "./toolchain";
import { showOutput } from "./util";
import { registerTreeViews } from "./views";
import { StateManager } from "./views/stateManager";
import { registerWestCommands } from "./west";
import {
  maybeOfferFirstRunWizard,
  registerProjectWizardCommand,
} from "./wizard";

export function activate(context: vscode.ExtensionContext): void {
  startLanguageServer(context);

  // One shared state source for both the native trees and the status bar, so
  // the Build & Flash tree and the status-bar Build/Flash gating never disagree.
  const stateMgr = new StateManager();
  const refreshState = () =>
    void stateMgr.refresh(
      context.globalState.get<string>("alp.lastBootstrapAt") ?? null,
    );

  context.subscriptions.push(
    stateMgr,
    // Reactivity (no window reload): re-derive shared state on alpSdk config
    // edits (SDK activate/deactivate via alpSdk.path) and when the window
    // regains focus (e.g. after running bootstrap/install in a terminal). A
    // cliPath edit also resets the cached CLI-binary resolution.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("alpSdk.cliPath")) resetResolvedBinary();
      if (e.affectsConfiguration("alpSdk")) refreshState();
    }),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) refreshState();
    }),
    ...registerLoaderCommands(context),
    ...registerWestCommands(context),
    ...registerBootstrapCommand(context),
    createStatusBar(stateMgr),
    registerSelectSdkCommand(),
    ...registerConfiguratorEditor(context),
    ...registerToolchainCommands(context),
    registerProjectWizardCommand(),
    ...registerLspCommands(),
    ...registerDebugCommands(),
    ...registerTreeViews(context, stateMgr),
    ...registerWorkspaceCommands(),
    vscode.commands.registerCommand("alp.openSetupFlow", () =>
      SetupFlowPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.openOverview", () =>
      OverviewPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.newProjectWizard", () =>
      NewProjectFlowPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.openExistingProject", () =>
      ExistingProjectFlowPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.openSdkManager", () =>
      SdkManagerPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.openSettings", () =>
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:alplabai.alp-sdk",
      ),
    ),
    vscode.commands.registerCommand("alp.openHardwareExplorer", () =>
      showHardwareExplorerPanel(context),
    ),
    vscode.commands.registerCommand("alp.showBuildPlan", () =>
      BuildPlanPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.openGettingStarted", () =>
      vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        "alplabai.alp-sdk#alpGettingStarted",
        false,
      ),
    ),
    vscode.commands.registerCommand("alp.showOutput", () => showOutput()),
  );

  void maybeOfferFirstRunWizard(context);
  void maybeOfferSetupPanel(context);
}

export async function deactivate(): Promise<void> {
  await stopLanguageServer();
}
