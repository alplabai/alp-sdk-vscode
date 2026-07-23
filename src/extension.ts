// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import {
  checkCliVersion,
  ensureTanCliProvisioned,
  installTanCliGlobally,
  resetResolvedBinary,
  updateAlpCli,
} from "./alpCli/vscodeAdapter";
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
  SetupFlowPanel,
} from "./ideHub";
import { maybeOfferSetupPanel } from "./ideHub/setupOrchestrator";
import { registerLoaderCommands } from "./loader";
import { startLanguageServer, stopLanguageServer } from "./lsp/client";
import { registerLspCommands } from "./lsp/commands";
import { registerSelectSdkCommand } from "./sdk/activeSdk";
import { createStatusBar } from "./statusBar";
import { registerToolchainCommands } from "./toolchain";
import { log, showOutput } from "./util";
import { registerTreeViews } from "./views";
import { StateManager } from "./views/stateManager";
import { registerWestCommands } from "./west";
import {
  maybeOfferFirstRunWizard,
  registerProjectWizardCommand,
} from "./wizard";

export function activate(context: vscode.ExtensionContext): void {
  const version =
    (context.extension.packageJSON.version as string | undefined) ?? "unknown";
  log(`Alp SDK extension activating — v${version}`);
  startLanguageServer(context);

  // One shared state source for both the native trees and the status bar, so
  // the Build & Flash tree and the status-bar Build/Flash gating never disagree.
  const stateMgr = new StateManager(context);
  const refreshState = () =>
    void stateMgr.refresh(
      context.globalState.get<string>("alp.lastBootstrapAt") ?? null,
    );

  context.subscriptions.push(
    stateMgr,
    // Reactivity (no window reload): re-derive shared state on alpSdk config
    // edits (SDK activate/deactivate via alpSdk.path) and when the window
    // regains focus (e.g. after running bootstrap/install in a terminal). A
    // cliPath or preferGlobalCli edit also resets the cached CLI-binary
    // resolution (and re-arms the one-shot version check, see
    // resetResolvedBinary), so repointing config mid-session re-checks the
    // newly-resolved binary right away.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("alpSdk.cliPath") ||
        e.affectsConfiguration("alpSdk.preferGlobalCli")
      ) {
        resetResolvedBinary();
        // Re-run the one-shot version check against the newly-resolved binary:
        // resetResolvedBinary re-arms it, but nothing else re-invokes it, so
        // without this a mid-session cliPath/preferGlobalCli edit wouldn't
        // re-warn until a window reload.
        void checkCliVersion(context);
      }
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
    ...registerDebugCommands(context),
    ...registerTreeViews(context, stateMgr),
    ...registerWorkspaceCommands(),
    vscode.commands.registerCommand("alp.openSetupFlow", () =>
      SetupFlowPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.openHub", () =>
      OverviewPanel.open(context),
    ),
    // Deprecated alias — keeps old keybindings/links/muscle-memory working.
    vscode.commands.registerCommand("alp.openOverview", () =>
      OverviewPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.newProjectWizard", () =>
      NewProjectFlowPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.openExistingProject", () =>
      ExistingProjectFlowPanel.open(context),
    ),
    // SDK Manager is now a section of the Hub; open the Hub focused on it.
    vscode.commands.registerCommand("alp.openSdkManager", () =>
      OverviewPanel.open(context, "sdk"),
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
    vscode.commands.registerCommand("alp.updateCli", () =>
      updateAlpCli(context),
    ),
    vscode.commands.registerCommand("alp.installTanCli", () =>
      installTanCliGlobally(context),
    ),
  );

  void maybeOfferFirstRunWizard(context);
  void maybeOfferSetupPanel(context);
  // Provision the managed `tan` CLI up front so a fresh install fetches it once,
  // streamlined (progress notification), instead of stalling on the first
  // build/validate command. No-op when a binary already resolves. The version
  // check runs after so it sees the just-provisioned binary.
  void ensureTanCliProvisioned(context).finally(() => {
    // Warn once if the resolved tan CLI is older than this build expects (the
    // silent cause of missing features like project examples).
    void checkCliVersion(context);
  });
}

export async function deactivate(): Promise<void> {
  await stopLanguageServer();
}
