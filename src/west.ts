// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { summarizeLoaderBatch } from "@alp-sdk/core/loader/service";
import {
    ensureLoaderOutputDirectory,
    executeLoaderPlan,
    inspectGeneratedFile,
} from "./loader/vscodeAdapter";
import { log, showOutput } from "./util";
import { analyzeValidationResult } from "@alp-sdk/core/validation/service";
import { executeValidatorPlan } from "./validation/vscodeAdapter";
import {
    createWestBuildPreparation,
    createWestFlashPlan,
    createWestNativeRunPlan,
} from "@alp-sdk/core/west/service";
import {
    collectWestWorkspaceContext,
    executeWestPlan,
} from "./west/vscodeAdapter";
import { normalizeBuildTarget, BuildTarget } from "@alp-sdk/core/west/buildTarget";

const BUILD_TARGET_KEY = "alp.buildTarget";

async function promptBuildTarget(
  initial?: BuildTarget | null,
): Promise<BuildTarget | null> {
  const board = await vscode.window.showInputBox({
    prompt: "Zephyr board target (e.g. native_sim/native/64, alp_e1m_evk_aen)",
    value: initial?.board ?? "native_sim/native/64",
  });
  if (board === undefined) return null;
  const example = await vscode.window.showInputBox({
    prompt: "Path to the application (relative to the west cwd)",
    value: initial?.example ?? "examples/gpio-button-led",
  });
  if (example === undefined) return null;
  return normalizeBuildTarget({ board, example });
}

async function resolveBuildTarget(
  context: vscode.ExtensionContext,
): Promise<BuildTarget | null> {
  const remembered = normalizeBuildTarget(
    context.workspaceState.get<BuildTarget>(BUILD_TARGET_KEY) ?? null,
  );
  if (remembered) return remembered;
  const picked = await promptBuildTarget();
  if (picked) await context.workspaceState.update(BUILD_TARGET_KEY, picked);
  return picked;
}

async function setBuildTarget(context: vscode.ExtensionContext): Promise<void> {
  const current = normalizeBuildTarget(
    context.workspaceState.get<BuildTarget>(BUILD_TARGET_KEY) ?? null,
  );
  const picked = await promptBuildTarget(current);
  if (!picked) return;
  await context.workspaceState.update(BUILD_TARGET_KEY, picked);
  vscode.window.setStatusBarMessage(
    `Alp: build target set to ${picked.board} · ${picked.example}`,
    5000,
  );
}

async function westBuild(context: vscode.ExtensionContext): Promise<void> {
  const sel = await resolveBuildTarget(context);
  if (!sel) return;

  const wsContext = collectWestWorkspaceContext();
  let preparation;
  try {
    preparation = createWestBuildPreparation(wsContext, sel);
  } catch (error) {
    await vscode.window.showErrorMessage(formatWestError(error));
    return;
  }

  const validationExecution = executeValidatorPlan(
    wsContext,
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
    const execution = executeLoaderPlan(wsContext, loaderPlan);
    if (execution.stdout) log(execution.stdout);
    if (execution.stderr) log(execution.stderr);
    entries.push(inspectGeneratedFile(loaderPlan));
  }

  const workspaceRoot = wsContext.workspaceRoot;
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

export function registerWestCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.westBuild", () => westBuild(context)),
    vscode.commands.registerCommand("alp.westFlash", () => westFlash()),
    vscode.commands.registerCommand("alp.westRunNativeSim", () =>
      westRunNativeSim(),
    ),
    vscode.commands.registerCommand("alp.setBuildTarget", () =>
      setBuildTarget(context),
    ),
  ];
}
