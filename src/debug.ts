// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createLaunchJsonWritePlan } from "./debug/launchJsonCore";
import { DebugServerKind, DebugTargetKind } from "./debug/models";
import {
    buildDoctorReport,
    createInspectReport,
    createLaunchPreview,
    DEBUG_TARGET_CHOICES,
    serverChoicesForTarget,
} from "./debug/service";
import {
    collectRuntimeCapabilities,
    collectWorkspaceDebugContext,
    readLaunchJson,
    writeLaunchJson,
} from "./debug/vscodeAdapter";
import { log, showOutput } from "./util";

async function showJsonDocument(data: unknown): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: "json",
    content: JSON.stringify(data, null, 2),
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function pickTargetKind(): Promise<DebugTargetKind | null> {
  const pick = await vscode.window.showQuickPick(DEBUG_TARGET_CHOICES, {
    title: "Alp: Choose the debug target class",
    placeHolder: "Select the target class to inspect or draft a profile for.",
  });
  return pick?.targetKind ?? null;
}

async function pickServer(
  targetKind: DebugTargetKind,
): Promise<DebugServerKind> {
  const items = serverChoicesForTarget(targetKind);
  if (items.length === 1) return items[0]!.server;

  const pick = await vscode.window.showQuickPick(items, {
    title: "Alp: Choose the debug server / probe backend",
    placeHolder: "Select the backend for the draft profile.",
  });
  return pick?.server ?? "jlink";
}

async function inspectProjectState(): Promise<void> {
  const snapshot = createInspectReport(collectWorkspaceDebugContext());
  log("alp.inspectProjectState: generated project-state snapshot");
  await showJsonDocument(snapshot);
}

async function debugDoctor(): Promise<void> {
  const targetKind = await pickTargetKind();
  if (!targetKind) return;
  const server = await pickServer(targetKind);
  const context = collectWorkspaceDebugContext();
  const summary = buildDoctorReport(
    context,
    { targetKind, server },
    collectRuntimeCapabilities(),
  );
  log(`alp.debugDoctor: ran doctor for ${targetKind}/${server}`);
  await showJsonDocument(summary);
  if (summary.summary.fail > 0 || summary.summary.warn > 0) {
    showOutput();
  }
}

async function configureDebugProfile(): Promise<void> {
  const targetKind = await pickTargetKind();
  if (!targetKind) return;
  const server = await pickServer(targetKind);
  const context = collectWorkspaceDebugContext();
  if (!context.workspaceRoot) {
    await vscode.window.showErrorMessage(
      "Alp: no workspace folder is open, cannot write launch.json.",
    );
    return;
  }

  const preview = createLaunchPreview(
    new Date().toISOString(),
    targetKind,
    server,
  );

  let writePlan;
  try {
    writePlan = createLaunchJsonWritePlan(
      readLaunchJson(context.workspaceRoot),
      preview.launch.configurations[0]!,
    );
  } catch (error) {
    await vscode.window.showErrorMessage(formatDebugError(error));
    return;
  }

  const launchPath = writeLaunchJson(context.workspaceRoot, writePlan.content);
  log(
    `alp.configureDebugProfile: ${writePlan.replaced ? "updated" : "wrote"} launch profile for ${targetKind}/${server}`,
  );

  const doc = await vscode.workspace.openTextDocument(launchPath);
  await vscode.window.showTextDocument(doc, { preview: false });
  await vscode.window.showInformationMessage(
    `Alp: ${writePlan.replaced ? "updated" : "wrote"} ${vscode.workspace.asRelativePath(launchPath)}.`,
  );
}

function formatDebugError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Alp: an unexpected debug configuration error occurred.";
}

export function registerDebugCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.inspectProjectState", () =>
      inspectProjectState(),
    ),
    vscode.commands.registerCommand("alp.debugDoctor", () => debugDoctor()),
    vscode.commands.registerCommand("alp.configureDebugProfile", () =>
      configureDebugProfile(),
    ),
  ];
}
