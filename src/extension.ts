// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { registerBootstrapCommand } from "./bootstrap";
import { registerConfiguratorCommand } from "./configuratorPanel";
import { registerDebugCommands } from "./debug";
import { registerLoaderCommands } from "./loader";
import { startLanguageServer, stopLanguageServer } from "./lsp/client";
import { registerLspCommands } from "./lsp/commands";
import { createStatusBar } from "./statusBar";
import {
  maybeOfferFirstRunWizard,
  registerProjectWizardCommand,
} from "./wizard";
import { registerWestCommands } from "./west";

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
  );

  void maybeOfferFirstRunWizard(context);
}

export async function deactivate(): Promise<void> {
  await stopLanguageServer();
}
