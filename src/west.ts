// SPDX-License-Identifier: Apache-2.0

import { summarizeLoaderBatch } from "@alp-sdk/core/loader/service";
import { analyzeValidationResult } from "@alp-sdk/core/validation/service";
import {
    createWestAlpCleanPlan,
    createWestAlpFlashPlan,
    createWestAlpImagePlan,
    createWestAlpRenodePlan,
    createWestBuildPreparation,
    createWestFlashPlan,
    createWestNativeRunPlan,
} from "@alp-sdk/core/west/service";
import * as vscode from "vscode";
import {
    ensureLoaderOutputDirectory,
    executeLoaderPlan,
    inspectGeneratedFile,
} from "./loader/vscodeAdapter";
import { log, showOutput } from "./util";
import { executeValidatorPlan } from "./validation/vscodeAdapter";
import {
    collectWestWorkspaceContext,
    executeWestPlan,
} from "./west/vscodeAdapter";

async function pickBoardAndExamplePath(): Promise<{
  board: string;
  example: string;
} | null> {
  const board = await vscode.window.showInputBox({
    prompt: "Zephyr board target (e.g. native_sim/native/64, alp_e1m_evk_aen)",
    value: "native_sim/native/64",
  });
  if (!board) return null;
  const example = await vscode.window.showInputBox({
    prompt: "Path to the application (relative to the west cwd)",
    value: "examples/gpio-button-led",
  });
  if (!example) return null;
  return { board, example };
}

async function westBuild(): Promise<void> {
  const sel = await pickBoardAndExamplePath();
  if (!sel) return;

  const context = collectWestWorkspaceContext();
  let preparation;
  try {
    preparation = createWestBuildPreparation(context, sel);
  } catch (error) {
    await vscode.window.showErrorMessage(formatWestError(error));
    return;
  }

  const validationExecution = executeValidatorPlan(
    context,
    preparation.validatorPlan,
  );
  if (validationExecution.stdout) log(validationExecution.stdout);
  if (validationExecution.stderr) log(validationExecution.stderr);

  const validation = analyzeValidationResult(validationExecution);
  if (validation.outcome !== "clean") {
    showOutput();
    await showValidationFailure(validation.outcome);
    return;
  }

  const entries = [];
  for (const loaderPlan of preparation.loaderPlans) {
    ensureLoaderOutputDirectory(loaderPlan);
    const execution = executeLoaderPlan(context, loaderPlan);
    if (execution.stdout) log(execution.stdout);
    if (execution.stderr) log(execution.stderr);
    entries.push(inspectGeneratedFile(loaderPlan));
  }

  const workspaceRoot = context.workspaceRoot;
  if (!workspaceRoot) {
    await vscode.window.showErrorMessage("Alp: workspace root is unresolved.");
    return;
  }

  const summary = summarizeLoaderBatch(workspaceRoot, entries);
  if (summary.failed.length > 0) {
    showOutput();
    await vscode.window.showErrorMessage(
      `Alp: generation failed before build for ${summary.failed.join(", ")}. See the ALP SDK output channel.`,
    );
    return;
  }

  executeWestPlan(preparation.westPlan);
}

async function westFlash(): Promise<void> {
  executeWestPlan(createWestFlashPlan(collectWestWorkspaceContext()));
}

async function westRunNativeSim(): Promise<void> {
  executeWestPlan(createWestNativeRunPlan(collectWestWorkspaceContext()));
}

async function pickAppPath(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: "Path to the application (relative to the west cwd)",
    value: "examples/rpmsg-v2n",
  });
}

async function westAlpImage(): Promise<void> {
  const appPath = await pickAppPath();
  if (!appPath) return;
  executeWestPlan(
    createWestAlpImagePlan(collectWestWorkspaceContext(), appPath),
  );
}

async function westAlpFlash(): Promise<void> {
  const appPath = await pickAppPath();
  if (!appPath) return;
  executeWestPlan(
    createWestAlpFlashPlan(collectWestWorkspaceContext(), appPath),
  );
}

async function westAlpClean(): Promise<void> {
  const appPath = await pickAppPath();
  if (!appPath) return;
  executeWestPlan(
    createWestAlpCleanPlan(collectWestWorkspaceContext(), appPath),
  );
}

async function westAlpRenode(): Promise<void> {
  const appPath = await pickAppPath();
  if (!appPath) return;
  executeWestPlan(
    createWestAlpRenodePlan(collectWestWorkspaceContext(), appPath),
  );
}

async function showValidationFailure(
  outcome:
    | "clean"
    | "missing-preset"
    | "schema-violation"
    | "hardware-revision"
    | "failed",
): Promise<void> {
  switch (outcome) {
    case "missing-preset":
      await vscode.window.showWarningMessage(
        "Alp: build blocked by missing preset validation issues.",
      );
      return;
    case "schema-violation":
      await vscode.window.showErrorMessage(
        "Alp: build blocked by board.yaml schema violations.",
      );
      return;
    case "hardware-revision":
      await vscode.window.showErrorMessage(
        "Alp: build blocked by hardware revision compatibility failures.",
      );
      return;
    case "failed":
      await vscode.window.showErrorMessage(
        "Alp: build blocked because validation failed unexpectedly.",
      );
      return;
    case "clean":
      return;
  }
}

function formatWestError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Alp: an unexpected west workflow error occurred.";
}

export function registerWestCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.westBuild", () => westBuild()),
    vscode.commands.registerCommand("alp.westFlash", () => westFlash()),
    vscode.commands.registerCommand("alp.westRunNativeSim", () =>
      westRunNativeSim(),
    ),
    vscode.commands.registerCommand("alp.westAlpImage", () => westAlpImage()),
    vscode.commands.registerCommand("alp.westAlpFlash", () => westAlpFlash()),
    vscode.commands.registerCommand("alp.westAlpClean", () => westAlpClean()),
    vscode.commands.registerCommand("alp.westAlpRenode", () => westAlpRenode()),
  ];
}
