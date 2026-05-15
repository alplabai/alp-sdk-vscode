// SPDX-License-Identifier: Apache-2.0

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { collectProjectContext } from "../project/vscodeAdapter";
import {
    boardYamlExistsWithDependencies,
    executeLoaderPlanWithSpawn,
    inspectGeneratedFileWithDependencies,
} from "@alp-sdk/core/loader/adapterCore";
import {
    LoaderBatchEntry,
    LoaderPlan,
    LoaderWorkspaceContext,
    ScriptExecutionResult,
} from "@alp-sdk/core/loader/models";

export function collectLoaderWorkspaceContext(): LoaderWorkspaceContext {
  return collectProjectContext();
}

export function boardYamlExists(boardPath: string | null): boolean {
  return boardYamlExistsWithDependencies(boardPath, fs.existsSync);
}

export function ensureLoaderOutputDirectory(plan: LoaderPlan): void {
  fs.mkdirSync(path.dirname(plan.outputPath), { recursive: true });
}

export function executeLoaderPlan(
  context: LoaderWorkspaceContext,
  plan: LoaderPlan,
): ScriptExecutionResult {
  return executeLoaderPlanWithSpawn(context.pythonBinary, plan, cp.spawnSync);
}

export async function previewGeneratedFile(outputPath: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(outputPath);
  await vscode.window.showTextDocument(doc, { preview: true });
}

export function inspectGeneratedFile(plan: LoaderPlan): LoaderBatchEntry {
  return inspectGeneratedFileWithDependencies(plan, {
    existsSync: fs.existsSync,
    statSync: fs.statSync,
  });
}
