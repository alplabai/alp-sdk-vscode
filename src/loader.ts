// SPDX-License-Identifier: Apache-2.0
//
// Generate + validate commands. Both delegate to the native CLI:
// `alp generate [--target <emit> | --all]` and `alp validate`. The SDK's Python
// loader/validator run inside the CLI; this file just maps the JSON envelope
// back onto the same toasts / previews. The cheap board.yaml-exists pre-check
// stays in-process for a precise "not found" message; per-edit board.yaml
// diagnostics remain the LSP's job (src/diagnostics.ts), untouched.

import * as path from "path";
import * as vscode from "vscode";

import { EmitMode } from "@alp-sdk/core/loader/models";
import { getGenerationTargetSupport } from "@alp-sdk/core/loader/service";
import { runAlpCommand } from "./alpCli/vscodeAdapter";
import {
  boardYamlExists,
  collectLoaderWorkspaceContext,
  previewGeneratedFile,
} from "./loader/vscodeAdapter";
import { log, showOutput } from "./util";

interface GenerateData {
  targets: string[];
  written: string[];
  failed: string[];
}

function boardYamlMissing(): boolean {
  const project = collectLoaderWorkspaceContext();
  if (!boardYamlExists(project.boardYamlPath)) {
    void vscode.window.showErrorMessage(
      `Alp: board.yaml not found at ${project.boardYamlPath ?? "<unset>"}.`,
    );
    return true;
  }
  return false;
}

function logIssues(
  prefix: string,
  issues: { severity: string; message: string }[],
): void {
  if (issues.length === 0) return;
  showOutput();
  for (const issue of issues) {
    log(`[${prefix}] ${issue.severity}: ${issue.message}`);
  }
}

async function runLoader(
  context: vscode.ExtensionContext,
  emit: EmitMode,
): Promise<void> {
  if (boardYamlMissing()) return;
  const target = getGenerationTargetSupport(emit);

  const { outcome } = await runAlpCommand(context, [
    "generate",
    "--target",
    emit,
  ]);
  const envelope = outcome.envelope;
  if (!envelope) {
    await vscode.window.showErrorMessage(`Alp: ${outcome.message}`);
    return;
  }
  logIssues("generate", envelope.issues);

  const data = envelope.data as GenerateData;
  if (!envelope.ok || data.failed.includes(emit)) {
    showOutput();
    await vscode.window.showErrorMessage(
      `Alp: ${target.displayName} generation failed.  See the ALP SDK output channel.`,
    );
    return;
  }

  const written = data.written[0];
  if (written && envelope.project.root) {
    await previewGeneratedFile(path.resolve(envelope.project.root, written));
    vscode.window.setStatusBarMessage(
      `Alp: wrote ${target.displayName} (${written})`,
      5000,
    );
  }
}

async function runLoaderAll(context: vscode.ExtensionContext): Promise<void> {
  if (boardYamlMissing()) return;

  const { outcome } = await runAlpCommand(context, ["generate", "--all"]);
  const envelope = outcome.envelope;
  if (!envelope) {
    await vscode.window.showErrorMessage(`Alp: ${outcome.message}`);
    return;
  }
  logIssues("generate", envelope.issues);

  const data = envelope.data as GenerateData;
  if (data.failed.length === 0) {
    vscode.window.setStatusBarMessage(
      `Alp: regenerated all ${data.targets.length} formats (${data.written.join(", ")})`,
      7000,
    );
  } else {
    showOutput();
    const failedDisplayNames = data.failed.map(
      (emit) => getGenerationTargetSupport(emit as EmitMode).displayName,
    );
    await vscode.window.showWarningMessage(
      `Alp: regenerated ${data.written.length}/${data.targets.length} -- failed: ${failedDisplayNames.join(", ")}`,
    );
  }
}

async function runValidator(context: vscode.ExtensionContext): Promise<void> {
  if (boardYamlMissing()) return;

  // Delegate to the native CLI (which spawns the SDK's Python validator) and
  // map the envelope back onto the same toasts.
  const { outcome } = await runAlpCommand(context, ["validate"]);
  const envelope = outcome.envelope;

  if (envelope) {
    logIssues("validate", envelope.issues);
  } else {
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

export function registerLoaderCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.generateZephyrConf", () =>
      runLoader(context, "zephyr-conf"),
    ),
    vscode.commands.registerCommand("alp.generateDtsOverlay", () =>
      runLoader(context, "dts-overlay"),
    ),
    vscode.commands.registerCommand("alp.generateCmakeArgs", () =>
      runLoader(context, "cmake-args"),
    ),
    vscode.commands.registerCommand("alp.generateYoctoConf", () =>
      runLoader(context, "yocto-conf"),
    ),
    vscode.commands.registerCommand("alp.generateAll", () =>
      runLoaderAll(context),
    ),
    vscode.commands.registerCommand("alp.validateBoardYaml", () =>
      runValidator(context),
    ),
  ];
}
