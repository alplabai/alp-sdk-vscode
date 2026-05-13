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
    documentSelector: [{ scheme: "file", language: "yaml" }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/board.yaml"),
    },
  };

  client = new LanguageClient(
    "alpSdkLsp",
    "ALP SDK Language Server",
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
