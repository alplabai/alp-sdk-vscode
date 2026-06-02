// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import {
  createGenerationTraceReport,
  serializeGenerationTraceReport,
} from "@alp-sdk/core/debug/service";
import {
  EmitMode,
  GenerationTargetSupport,
  LoaderBatchEntry,
  LoaderPlan,
} from "@alp-sdk/core/loader/models";
import {
  ALL_EMIT_MODES,
  createLoaderPlan,
  getGenerationTargetSupport,
  summarizeLoaderBatch,
} from "@alp-sdk/core/loader/service";
import { runAlpCommand } from "./alpCli/vscodeAdapter";
import {
  boardYamlExists,
  collectLoaderWorkspaceContext,
  ensureLoaderOutputDirectory,
  executeLoaderPlan,
  inspectGeneratedFile,
  previewGeneratedFile,
} from "./loader/vscodeAdapter";
import { log, showOutput } from "./util";

async function runLoader(emit: EmitMode): Promise<void> {
  const context = collectLoaderWorkspaceContext();
  if (!boardYamlExists(context.boardYamlPath)) {
    await vscode.window.showErrorMessage(
      `Alp: board.yaml not found at ${context.boardYamlPath ?? "<unset>"}.`,
    );
    return;
  }

  let plan: LoaderPlan;
  let target: GenerationTargetSupport;
  try {
    target = getGenerationTargetSupport(emit);
    plan = createLoaderPlan(context, emit);
  } catch (error) {
    await vscode.window.showErrorMessage(formatLoaderError(error));
    return;
  }

  ensureLoaderOutputDirectory(plan);
  log(`$ ${plan.commandLine}`);

  const result = executeLoaderPlan(context, plan);
  if (result.stdout) log(result.stdout);
  if (result.stderr) log(result.stderr);

  if (result.status !== 0) {
    showOutput();
    await vscode.window.showErrorMessage(
      `Alp: ${target.displayName} generation failed (rv=${result.status}).  See the ALP SDK output channel.`,
    );
    return;
  }
  await previewGeneratedFile(plan.outputPath);
  vscode.window.setStatusBarMessage(
    `Alp: wrote ${target.displayName} (${vscode.workspace.asRelativePath(plan.outputPath)})`,
    5000,
  );
}

async function runValidator(context: vscode.ExtensionContext): Promise<void> {
  const project = collectLoaderWorkspaceContext();
  if (!project.boardYamlPath || !boardYamlExists(project.boardYamlPath)) {
    await vscode.window.showErrorMessage(
      `Alp: board.yaml not found at ${project.boardYamlPath ?? "<unset>"}.`,
    );
    return;
  }

  // Delegate to the native CLI (which spawns the SDK's Python validator) and
  // map the envelope back onto the same toasts.
  const { outcome } = await runAlpCommand(context, ["validate"]);
  const envelope = outcome.envelope;

  if (envelope && envelope.issues.length > 0) {
    showOutput();
    for (const issue of envelope.issues) {
      log(`[validate] ${issue.severity}: ${issue.message}`);
    }
  }

  if (!envelope) {
    // Binary could not be resolved or produced no envelope.
    await vscode.window.showErrorMessage(`Alp: ${outcome.message}`);
    return;
  }

  const granular = (envelope.data as { outcome?: string } | undefined)?.outcome;
  switch (granular) {
    case "clean":
      await vscode.window.showInformationMessage("Alp: board.yaml is clean.");
      return;
    case "missing-preset":
      await vscode.window.showWarningMessage(
        "Alp: board.yaml has missing-preset failures.  See the ALP SDK output channel.",
      );
      return;
    case "hardware-revision":
      await vscode.window.showErrorMessage(
        "Alp: board.yaml hardware revision is incompatible with the current SDK.  See the ALP SDK output channel.",
      );
      return;
    case "schema-violation":
      await vscode.window.showErrorMessage(
        "Alp: board.yaml schema violation.  See the ALP SDK output channel.",
      );
      return;
    default:
      await vscode.window.showErrorMessage(
        "Alp: board.yaml validation failed unexpectedly.  See the ALP SDK output channel.",
      );
      return;
  }
}

async function runLoaderAll(): Promise<void> {
  const context = collectLoaderWorkspaceContext();
  if (!boardYamlExists(context.boardYamlPath)) {
    await vscode.window.showErrorMessage(
      `Alp: board.yaml not found at ${context.boardYamlPath ?? "<unset>"}.`,
    );
    return;
  }

  const entries: LoaderBatchEntry[] = [];

  for (const emit of ALL_EMIT_MODES) {
    let plan: LoaderPlan;
    try {
      plan = createLoaderPlan(context, emit);
    } catch (error) {
      await vscode.window.showErrorMessage(formatLoaderError(error));
      return;
    }

    ensureLoaderOutputDirectory(plan);
    log(`$ ${plan.commandLine}`);
    const result = executeLoaderPlan(context, plan);
    if (result.stdout) log(result.stdout);
    if (result.stderr) log(result.stderr);
    entries.push(inspectGeneratedFile(plan));
  }

  const workspaceRoot = context.workspaceRoot;
  if (!workspaceRoot) {
    await vscode.window.showErrorMessage("Alp: workspace root is unresolved.");
    return;
  }

  const summary = summarizeLoaderBatch(workspaceRoot, entries);
  const failedDisplayNames = summary.failed.map(
    (emit) => getGenerationTargetSupport(emit).displayName,
  );
  const failedEmits = new Set(summary.failed);
  const trace = createGenerationTraceReport(
    new Date().toISOString(),
    "loader.generateAll",
    entries.map((entry) => ({
      key: entry.emit,
      outputPath: entry.outputPath,
      outcome: failedEmits.has(entry.emit) ? "failed" : "written",
      detail: failedEmits.has(entry.emit)
        ? "Generated artifact missing or empty."
        : "Generated artifact exists with non-zero size.",
    })),
  );
  log(`alp.generateAll.trace:\n${serializeGenerationTraceReport(trace)}`);

  if (summary.failed.length === 0) {
    vscode.window.setStatusBarMessage(
      `Alp: regenerated all ${ALL_EMIT_MODES.length} formats (${summary.written.join(", ")})`,
      7000,
    );
  } else {
    showOutput();
    await vscode.window.showWarningMessage(
      `Alp: regenerated ${summary.written.length}/${ALL_EMIT_MODES.length} -- failed: ${failedDisplayNames.join(", ")}`,
    );
  }
}

function formatLoaderError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Alp: an unexpected loader error occurred.";
}

export function registerLoaderCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.generateZephyrConf", () =>
      runLoader("zephyr-conf"),
    ),
    vscode.commands.registerCommand("alp.generateDtsOverlay", () =>
      runLoader("dts-overlay"),
    ),
    vscode.commands.registerCommand("alp.generateCmakeArgs", () =>
      runLoader("cmake-args"),
    ),
    vscode.commands.registerCommand("alp.generateYoctoConf", () =>
      runLoader("yocto-conf"),
    ),
    vscode.commands.registerCommand("alp.generateAll", () => runLoaderAll()),
    vscode.commands.registerCommand("alp.validateBoardYaml", () =>
      runValidator(context),
    ),
  ];
}
