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
import { maybeOfferSdkConnect, registerSdkConnectCommand } from "./sdkConnect";
import { registerSdkStatusCommands } from "./sdkStatus";
import { registerToolchainCommands } from "./toolchain";
import { registerOnboardingCommands } from "./onboarding";
import { registerGeneratedConfigCommands } from "./generatedConfig";

export function activate(context: vscode.ExtensionContext): void {
  startLanguageServer(context);

  context.subscriptions.push(
    ...registerLoaderCommands(),
    ...registerWestCommands(context),
    registerBootstrapCommand(),
    createStatusBar(context),
    registerConfiguratorCommand(context),
    registerProjectWizardCommand(),
    ...registerLspCommands(),
    ...registerDebugCommands(),
    ...registerProjectView(),
    registerHardwareExplorerCommand(context),
    registerSdkConnectCommand(),
    ...registerSdkStatusCommands(),
    ...registerToolchainCommands(context),
    ...registerOnboardingCommands(),
    ...registerGeneratedConfigCommands(),
  );

  // Only one first-run prompt at a time: offer the new-project wizard only when
  // the SDK-connect prompt did not fire. SDK connect takes priority -- you need
  // the SDK resolved before scaffolding a project.
  void maybeOfferSdkConnect(context).then((shown) => {
    if (!shown) {
      void maybeOfferFirstRunWizard(context);
    }
  });
}

export async function deactivate(): Promise<void> {
  await stopLanguageServer();
}
