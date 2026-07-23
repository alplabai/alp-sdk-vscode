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
import { catalogFromPresets, kconfigSymbolsFromEnvelope } from "./sdkCatalog";

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
  // Scope the failure handler to start() itself (2-arg .then) so it reports ONLY
  // a real LSP-launch rejection — a failed launch used to be a silent unhandled
  // rejection, with YAML / prj.conf validation + completion just not working.
  // pushSdkCatalog runs only on start success and swallows its own errors.
  void client.start().then(
    () => pushSdkCatalog(context),
    (err: unknown) => {
      void reportError(
        "Alp: the language server failed to start — board.yaml / prj.conf validation and completion are unavailable.",
        String(err),
      );
    },
  );

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
 * `boardLibraries`) plus the live Kconfig symbol set from `tan kconfig`, and
 * push the merged catalog to the language server via the
 * `alp/updateSdkCatalog` notification. Both fetches are independently
 * best-effort: `tan kconfig` doesn't exist in older/current CLI builds yet, so
 * an unknown-subcommand failure there must degrade to an empty
 * `kconfigSymbols` list (completion falls back to the vendored/curated
 * symbols) WITHOUT blanking the `presets`-sourced skus/libraries, and vice
 * versa.
 */
async function pushSdkCatalog(context: vscode.ExtensionContext): Promise<void> {
  if (!client) {
    return;
  }
  const [presetsData, kconfigSymbols] = await Promise.all([
    fetchEnvelopeData(context, ["presets"]),
    fetchKconfigSymbols(context),
  ]);
  const catalog = {
    ...catalogFromPresets(presetsData),
    kconfigSymbols,
  };
  try {
    await client.sendNotification("alp/updateSdkCatalog", catalog);
  } catch {
    // Best-effort — the server keeps its current catalog.
  }
}

/** Run a CLI envelope command and return its `data`, or `undefined` on any
 *  failure (unresolvable binary, unknown subcommand, non-zero exit, …). */
async function fetchEnvelopeData(
  context: vscode.ExtensionContext,
  args: string[],
): Promise<unknown> {
  try {
    const { outcome } = await runAlpCommand(context, args);
    return outcome.envelope?.data;
  } catch {
    return undefined;
  }
}

/** `tan kconfig` doesn't exist in the shipped CLI yet — any failure (missing
 *  subcommand included) degrades to an empty list, same as `alp presets`
 *  degrading to the built-in defaults. */
async function fetchKconfigSymbols(
  context: vscode.ExtensionContext,
): Promise<string[]> {
  const data = await fetchEnvelopeData(context, ["kconfig"]);
  return kconfigSymbolsFromEnvelope(data);
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
