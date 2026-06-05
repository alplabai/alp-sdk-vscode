// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { registerBootstrapCommand } from "./bootstrap";
import { registerConfiguratorCommand } from "./configuratorPanel";
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
import { createStatusBar } from "./statusBar";
import { registerToolchainCommands } from "./toolchain";
import { registerTreeViews } from "./views";
import { registerWestCommands } from "./west";
import {
  maybeOfferFirstRunWizard,
  registerProjectWizardCommand,
} from "./wizard";

export function activate(context: vscode.ExtensionContext): void {
  startLanguageServer(context);

  context.subscriptions.push(
    ...registerLoaderCommands(context),
    ...registerWestCommands(context),
    ...registerBootstrapCommand(context),
    createStatusBar(),
    registerConfiguratorCommand(context),
    ...registerToolchainCommands(context),
    registerProjectWizardCommand(),
    ...registerLspCommands(),
    ...registerDebugCommands(),
    ...registerTreeViews(context),
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
  );

  void maybeOfferFirstRunWizard(context);
  void maybeOfferSetupPanel(context);
}

export async function deactivate(): Promise<void> {
  await stopLanguageServer();
}
