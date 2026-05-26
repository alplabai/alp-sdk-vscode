// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { listGenerationTargetSupport } from "@alp-sdk/core/loader/service";
import {
  analyzeGenerationStaleness,
  GenerationStalenessInput,
} from "@alp-sdk/core/loader/staleness";
import { collectProjectContext } from "./project/vscodeAdapter";
import { log, showOutput } from "./util";

function mtimeMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function statusGlyph(status: string): string {
  return status === "current" ? "OK " : status === "stale" ? "~~ " : "!! ";
}

async function checkGeneratedConfig(): Promise<void> {
  const project = collectProjectContext();
  if (!project.workspaceRoot || !project.boardYamlPath) {
    await vscode.window.showErrorMessage("Alp: open a workspace folder with a board.yaml first.");
    return;
  }

  const boardMtimeMs = mtimeMs(project.boardYamlPath);
  const files: GenerationStalenessInput[] = listGenerationTargetSupport().map((target) => ({
    emit: target.emit,
    displayName: target.displayName,
    generatedMtimeMs: mtimeMs(path.join(project.workspaceRoot as string, target.outputRelativePath)),
  }));

  const report = analyzeGenerationStaleness(boardMtimeMs, files);

  log("── Alp generated-config check ──");
  for (const e of report.entries) log(`  ${statusGlyph(e.status)}${e.displayName}: ${e.status}`);

  if (report.ok) {
    void vscode.window.showInformationMessage("Alp: generated config is up to date.");
    return;
  }

  const pick = await vscode.window.showWarningMessage(
    `Alp: generated config — ${report.stale} stale, ${report.missing} missing.`,
    "Generate all",
    "Show report",
  );
  if (pick === "Generate all") void vscode.commands.executeCommand("alp.generateAll");
  else if (pick === "Show report") showOutput();
}

export function registerGeneratedConfigCommands(): vscode.Disposable[] {
  return [vscode.commands.registerCommand("alp.checkGeneratedConfig", () => checkGeneratedConfig())];
}
