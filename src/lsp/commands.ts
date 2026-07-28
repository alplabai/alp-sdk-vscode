// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as vscode from "vscode";
import { planFailure } from "../notify/service";
import { notifyAsync } from "../notify/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import { log } from "../util";
import { isBoardYamlPath } from "@alp-sdk/core/validation/service";
import { requestEffectiveConfigPreview } from "./client";

async function showJsonDocument(data: unknown): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: "json",
    content: JSON.stringify(data, null, 2),
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

function resolveBoardYamlUri(): vscode.Uri | null {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === "file" && isBoardYamlPath(active.fsPath)) {
    return active;
  }

  const project = collectProjectContext();
  if (!project.boardYamlPath) {
    return null;
  }

  return vscode.Uri.file(project.boardYamlPath);
}

const OPERATION = "Previewing the effective config";

async function previewEffectiveConfig(): Promise<void> {
  const boardYamlUri = resolveBoardYamlUri();
  if (!boardYamlUri) {
    notifyAsync(
      planFailure({
        operation: OPERATION,
        cause:
          "Alp: board.yaml path is unresolved. Open board.yaml or configure alpSdk.boardYamlPath.",
        severity: "warning",
        actions: [{ id: "openSettings", arg: "alpSdk.boardYamlPath" }],
      }),
    );
    return;
  }

  if (!fs.existsSync(boardYamlUri.fsPath)) {
    notifyAsync(
      planFailure({
        operation: OPERATION,
        cause: "Alp: board.yaml not found.",
        // The path is diagnostic, not a sentence — the channel gets it.
        detail: boardYamlUri.fsPath,
        severity: "warning",
        actions: [
          { id: "openSettings", arg: "alpSdk.boardYamlPath" },
          { id: "newProject" },
        ],
      }),
    );
    return;
  }

  // `requestEffectiveConfigPreview` throws when the language server isn't
  // started (client.ts), and this command — plus the configurator's button,
  // which routes through it — is the only caller. Uncaught, VS Code shows its
  // own unbranded "command failed" popup with the raw error, no channel entry
  // and no action; catch it once here where every caller passes.
  // @callers 1 requestEffectiveConfigPreview
  let preview: unknown;
  try {
    preview = await requestEffectiveConfigPreview(boardYamlUri);
  } catch (err) {
    notifyAsync(
      planFailure({
        operation: OPERATION,
        cause: "Alp: couldn't render the effective config.",
        detail: err instanceof Error ? err.message : String(err),
        actions: [{ id: "reloadWindow" }],
      }),
    );
    return;
  }
  await showJsonDocument(preview);
  log(
    `alp.previewEffectiveConfig: rendered effective config for ${boardYamlUri.fsPath}`,
  );
}

export function registerLspCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.previewEffectiveConfig", () =>
      previewEffectiveConfig(),
    ),
  ];
}
