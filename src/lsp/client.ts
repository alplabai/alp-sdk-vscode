// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { fetchEnvelopeData } from "../alpCli/envelope";
import { collectProjectContext } from "../project/vscodeAdapter";
import { reportError } from "../notify/vscodeAdapter";
import { resolveSlice } from "./buildConfig";
import { isPrjConfPath } from "./kconfig";
import type { KconfigSymbol } from "./kconfig";
import { catalogFromPresets, fetchKconfigSymbolsForCore } from "./sdkCatalog";
import type { SdkCompletionCatalog } from "./sdkCatalog";

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

  // Re-push the completion catalog whenever the active SDK / CLI path changes,
  // or a new prj.conf opens — that prj.conf's core may not have a cached live
  // Kconfig fetch yet (see fetchOpenPrjConfKconfig).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("alpSdk")) {
        void pushSdkCatalog(context);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme === "file" && isPrjConfPath(doc.uri.fsPath)) {
        void pushSdkCatalog(context);
      }
    }),
  );
}

/**
 * Fetch the board.yaml completion catalog from `alp presets` (SKUs +
 * `boardLibraries`) plus, for every prj.conf currently open, the live
 * per-core Kconfig set from `tan kconfig --core <id>` (alp-sdk #894), and push
 * the merged catalog to the language server via the `alp/updateSdkCatalog`
 * notification. Both fetches are independently best-effort: `tan kconfig
 * --core` doesn't exist until tan-cli #35 ships, so a failure there degrades
 * that core to an empty `kconfigByCore` entry (completion/hover/lint then fall
 * back to the vendored/curated symbols — see kconfig.ts) WITHOUT blanking the
 * `presets`-sourced skus/libraries, and vice versa.
 */
async function pushSdkCatalog(context: vscode.ExtensionContext): Promise<void> {
  if (!client) {
    return;
  }
  const [presetsData, kconfigByCore] = await Promise.all([
    fetchEnvelopeData(context, ["presets"]),
    fetchOpenPrjConfKconfig(context),
  ]);
  const catalog: SdkCompletionCatalog = {
    ...catalogFromPresets(presetsData),
    kconfigByCore,
  };
  try {
    await client.sendNotification("alp/updateSdkCatalog", catalog);
  } catch {
    // Best-effort — the server keeps its current catalog.
  }
}

/**
 * Resolve every currently-open prj.conf to its build slice
 * (`buildConfig.ts:resolveSlice` — board.yaml + coreId), then fetch (cached,
 * see sdkCatalog.ts) each distinct core's live Kconfig symbols. A prj.conf
 * outside any `cores[].app` directory (resolveSlice returns null) is skipped
 * — there is no core to fetch for. Keyed `${boardYamlPath}::${coreId}`,
 * matching how server.ts looks a document's core catalog back up.
 */
async function fetchOpenPrjConfKconfig(
  context: vscode.ExtensionContext,
): Promise<Record<string, readonly KconfigSymbol[]>> {
  const sdkRoot = collectProjectContext().sdkRoot ?? "";
  const slices = new Map<string, { boardYamlPath: string; coreId: string }>();
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme !== "file" || !isPrjConfPath(doc.uri.fsPath)) {
      continue;
    }
    const slice = resolveSlice(doc.uri.fsPath);
    if (!slice) {
      continue;
    }
    slices.set(`${slice.boardYamlPath}::${slice.coreId}`, slice);
  }

  const entries = await Promise.all(
    [...slices.entries()].map(async ([key, slice]) => {
      const symbols = await fetchKconfigSymbolsForCore(
        sdkRoot,
        slice.boardYamlPath,
        slice.coreId,
        path.dirname(slice.boardYamlPath),
        (coreId, cwd) =>
          fetchEnvelopeData(context, ["kconfig", "--core", coreId], cwd),
      );
      return [key, symbols] as const;
    }),
  );
  return Object.fromEntries(entries);
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
