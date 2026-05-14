// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as vscode from "vscode";
import { collectProjectContext } from "../project/vscodeAdapter";
import { log } from "../util";
import { isBoardYamlPath } from "../validation/service";
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

async function previewEffectiveConfig(): Promise<void> {
  const boardYamlUri = resolveBoardYamlUri();
  if (!boardYamlUri) {
    void vscode.window.showWarningMessage(
      "Alp: board.yaml path is unresolved. Open board.yaml or configure alpSdk.boardYamlPath.",
    );
    return;
  }

  if (!fs.existsSync(boardYamlUri.fsPath)) {
    void vscode.window.showWarningMessage(
      `Alp: board.yaml not found at ${boardYamlUri.fsPath}`,
    );
    return;
  }

  const preview = await requestEffectiveConfigPreview(boardYamlUri);
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
