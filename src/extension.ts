// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { registerBootstrapCommand } from "./bootstrap";
import { registerConfiguratorCommand } from "./configuratorPanel";
import { registerDebugCommands } from "./debug";
import { registerLoaderCommands } from "./loader";
import { startLanguageServer, stopLanguageServer } from "./lsp/client";
import { registerLspCommands } from "./lsp/commands";
import { createStatusBar } from "./statusBar";
import { registerWestCommands } from "./west";
import {
    maybeOfferFirstRunWizard,
    registerProjectWizardCommand,
} from "./wizard";
import { registerProjectView } from "./projectView";
import { registerHardwareExplorerCommand } from "./hardwareExplorerPanel";
import { registerSdkStatusCommands } from "./sdkStatus";
import { registerSdkConnectCommand, maybeOfferSdkConnect } from "./sdkConnect";

export function activate(context: vscode.ExtensionContext): void {
  startLanguageServer(context);

  context.subscriptions.push(
    ...registerLoaderCommands(),
    ...registerWestCommands(),
    registerBootstrapCommand(),
    createStatusBar(context),
    registerConfiguratorCommand(context),
    registerProjectWizardCommand(),
    ...registerLspCommands(),
    ...registerDebugCommands(),
    ...registerProjectView(),
    registerHardwareExplorerCommand(context),
    ...registerSdkStatusCommands(),
    registerSdkConnectCommand(),
  );

  void maybeOfferFirstRunWizard(context);
  void maybeOfferSdkConnect(context);
}

export async function deactivate(): Promise<void> {
  await stopLanguageServer();
}
