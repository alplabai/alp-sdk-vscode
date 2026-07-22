// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { runAlpCommand } from "../alpCli/vscodeAdapter";
import { reportError } from "../util";
import { catalogFromPresets } from "./sdkCatalog";

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
  void client
    .start()
    .then(() => pushSdkCatalog(context))
    .catch((err: unknown) => {
      // A failed LSP launch used to be a silent unhandled rejection — YAML /
      // prj.conf validation + completion just wouldn't work, with no signal.
      void reportError(
        "Alp: the language server failed to start — board.yaml / prj.conf validation and completion are unavailable.",
        String(err),
      );
    });

  // Re-push the completion catalog whenever the active SDK / CLI path changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("alpSdk")) {
        void pushSdkCatalog(context);
      }
    }),
  );
}

/**
 * Fetch the board.yaml completion catalog from `alp presets` (SKUs +
 * `boardLibraries`) and push it to the language server via the
 * `alp/updateSdkCatalog` notification. Best-effort: any CLI/SDK failure leaves
 * the server on its previous (or empty) catalog, so completion degrades to the
 * built-in defaults rather than erroring.
 */
async function pushSdkCatalog(context: vscode.ExtensionContext): Promise<void> {
  if (!client) {
    return;
  }
  try {
    const { outcome } = await runAlpCommand(context, ["presets"]);
    const catalog = catalogFromPresets(outcome.envelope?.data);
    await client.sendNotification("alp/updateSdkCatalog", catalog);
  } catch {
    // Best-effort — the server keeps its current catalog.
  }
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
