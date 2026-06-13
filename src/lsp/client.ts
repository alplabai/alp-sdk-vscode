// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;
const PREVIEW_EFFECTIVE_CONFIG_COMMAND = "alp.lsp.previewEffectiveConfig";

export function startLanguageServer(context: vscode.ExtensionContext): void {
  if (client) {
    return;
  }

  const serverModule = context.asAbsolutePath(
    path.join("out", "lsp", "server.js"),
  );
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        execArgv: ["--nolazy", "--inspect=6010"],
      },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "yaml" },
      // Zephyr Kconfig fragments (prj.conf, prj_debug.conf, …) — matched by
      // pattern, independent of the language id VS Code assigns them.
      { scheme: "file", pattern: "**/prj*.conf" },
    ],
    synchronize: {
      fileEvents: [
        vscode.workspace.createFileSystemWatcher("**/board.yaml"),
        vscode.workspace.createFileSystemWatcher("**/prj*.conf"),
      ],
    },
  };

  client = new LanguageClient(
    "alpSdkLsp",
    "Alp SDK Language Server",
    serverOptions,
    clientOptions,
  );
  context.subscriptions.push(client);
  void client.start();
}

export async function stopLanguageServer(): Promise<void> {
  if (!client) {
    return;
  }

  const current = client;
  client = undefined;
  await current.stop();
}

export async function requestEffectiveConfigPreview(
  boardYamlUri: vscode.Uri,
): Promise<unknown> {
  if (!client) {
    throw new Error("Alp SDK language server is not started.");
  }

  return client.sendRequest("workspace/executeCommand", {
    command: PREVIEW_EFFECTIVE_CONFIG_COMMAND,
    arguments: [boardYamlUri.toString()],
  });
}
