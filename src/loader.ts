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

export type CliResult = Awaited<ReturnType<typeof runAlpCommand>>;
export const CANCELLED = Symbol("cancelled");

/**
 * Run an envelope command inside a cancellable progress notification. The
 * CancellationToken is bridged to an AbortSignal so pressing Cancel kills the
 * `tan` child (and its Python validator/loader, or -- for `bootstrap.ts`'s
 * win32 pre-flight -- the `tan bootstrap --no-pip --no-west` probe) instead
 * of leaving it running. Returns CANCELLED when the user cancels so the
 * caller skips its error toast. Exported: `bootstrap.ts` reuses this exact
 * `withProgress` + CancellationToken->AbortController bridge for its win32
 * pre-flight rather than duplicating it.
 */
export async function runAlpWithProgress(
  context: vscode.ExtensionContext,
  args: string[],
  title: string,
  cwd?: string,
): Promise<CliResult | typeof CANCELLED> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => controller.abort());
      try {
        const result = await runAlpCommand(context, args, cwd, {
          signal: controller.signal,
        });
        return token.isCancellationRequested ? CANCELLED : result;
      } finally {
        sub.dispose();
      }
    },
  );
}

async function runLoader(
  context: vscode.ExtensionContext,
  emit: EmitMode,
): Promise<void> {
  if (boardYamlMissing()) return;
  const target = getGenerationTargetSupport(emit);

  const res = await runAlpWithProgress(
    context,
    ["generate", "--target", emit],
    `Generating ${target.displayName}…`,
  );
  if (res === CANCELLED) {
    vscode.window.setStatusBarMessage("Alp: generation cancelled.", 3000);
    return;
  }
  const { outcome } = res;
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
      `Alp: ${target.displayName} generation failed.  See the Alp SDK output channel.`,
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

  const res = await runAlpWithProgress(
    context,
    ["generate", "--all"],
    "Regenerating all formats…",
  );
  if (res === CANCELLED) {
    vscode.window.setStatusBarMessage("Alp: generation cancelled.", 3000);
    return;
  }
  const { outcome } = res;
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
  const res = await runAlpWithProgress(
    context,
    ["validate"],
    "Validating board.yaml…",
  );
  if (res === CANCELLED) {
    vscode.window.setStatusBarMessage("Alp: validation cancelled.", 3000);
    return;
  }
  const { outcome } = res;
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
    case "schema-violation":
      await vscode.window.showErrorMessage(
        "Alp: board.yaml schema violation.  See the Alp SDK output channel.",
      );
      return;
    default:
      await vscode.window.showErrorMessage(
        "Alp: board.yaml validation failed unexpectedly.  See the Alp SDK output channel.",
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
    vscode.commands.registerCommand("alp.generateNativeSimOverlay", () =>
      runLoader(context, "native-sim-overlay"),
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
