// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as vscode from "vscode";
import { buildStarterBoardConfig } from "@alp-sdk/core/board/starter";
import { serializeBoardConfig } from "@alp-sdk/core/board/serialize";
import { coreIdsForSom } from "@alp-sdk/core/sdkCatalogue/derive";
import { collectProjectContext } from "./project/vscodeAdapter";
import { loadSdkCatalogue } from "./sdkCatalogue/vscodeAdapter";
import { log } from "./util";

async function pickSku(sdkRoot: string | null): Promise<string | null> {
  const catalogue = loadSdkCatalogue(sdkRoot, log);
  if (catalogue.soms.length > 0) {
    const pick = await vscode.window.showQuickPick(
      catalogue.soms.map((s) => s.sku),
      { title: "Alp: New board.yaml — pick a SoM SKU", ignoreFocusOut: true },
    );
    return pick ?? null;
  }
  const typed = await vscode.window.showInputBox({
    title: "Alp: New board.yaml — SoM SKU",
    prompt: "No SDK catalogue found. Enter the SoM SKU.",
    value: "E1M-AEN701",
    ignoreFocusOut: true,
  });
  return typed ? typed.trim() || null : null;
}

async function newBoardFromSku(): Promise<void> {
  const project = collectProjectContext();
  if (!project.workspaceRoot) {
    await vscode.window.showErrorMessage("Alp: open a workspace folder before creating a board.yaml.");
    return;
  }

  const sku = await pickSku(project.sdkRoot ?? null);
  if (!sku) return;

  const catalogue = loadSdkCatalogue(project.sdkRoot ?? null, log);
  const coreIds = coreIdsForSom(catalogue, sku);
  const content = serializeBoardConfig(buildStarterBoardConfig(sku, coreIds));

  const target = vscode.Uri.joinPath(vscode.Uri.file(project.workspaceRoot), "board.yaml");
  if (fs.existsSync(target.fsPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      "Alp: board.yaml already exists. Overwrite it?",
      { modal: true },
      "Overwrite",
    );
    if (overwrite !== "Overwrite") return;
  }

  try {
    fs.writeFileSync(target.fsPath, content, "utf-8");
  } catch (error) {
    await vscode.window.showErrorMessage(`Alp: failed to write board.yaml: ${error}`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc, { preview: false });
  const action = await vscode.window.showInformationMessage(
    `Alp: created board.yaml for ${sku}.`,
    "Open configurator",
  );
  if (action === "Open configurator") {
    void vscode.commands.executeCommand("alp.openConfigurator");
  }
}

export function registerOnboardingCommands(): vscode.Disposable[] {
  return [vscode.commands.registerCommand("alp.newBoardFromSku", () => newBoardFromSku())];
}
