// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createLaunchJsonWritePlan } from "./debug/launchJsonCore";
import {
    DebugGenerationTraceDecision,
    DebugServerKind,
    DebugTargetKind,
} from "./debug/models";
import { createDebugTroubleshootingPanelHtml } from "./debug/panelHtml";
import {
    buildDebugPreflightReport,
    buildDoctorReport,
    createDebugProfile,
    createGenerationTraceReport,
    createInspectReport,
    createLaunchPreview,
    createSupportBundlePayload,
    DEBUG_TARGET_CHOICES,
    serializeSupportBundlePayload,
    serverChoicesForTarget,
} from "./debug/service";
import {
    collectRuntimeCapabilities,
    collectWorkspaceDebugContext,
    fileExists,
    readLaunchJson,
    writeLaunchJson,
    writeSupportBundle,
} from "./debug/vscodeAdapter";
import { ALL_EMIT_MODES, createLoaderPlan } from "./loader/service";
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

async function debugPreflight(): Promise<void> {
  const targetKind = await pickTargetKind();
  if (!targetKind) return;
  const server = await pickServer(targetKind);
  const context = collectWorkspaceDebugContext();
  const runtime = collectRuntimeCapabilities();

  let profile;
  try {
    profile = createDebugProfile(targetKind, server);
  } catch (error) {
    await vscode.window.showErrorMessage(formatDebugError(error));
    return;
  }

  const report = buildDebugPreflightReport(
    new Date().toISOString(),
    context,
    profile,
    runtime,
    {
      pathExists: fileExists,
    },
  );

  log(
    `alp.debugPreflight: ran preflight for ${targetKind}/${server}, canLaunch=${report.canLaunch}`,
  );
  await showJsonDocument(report);
  if (!report.canLaunch || report.summary.warn > 0) {
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

async function exportSupportBundle(): Promise<void> {
  const targetKind = await pickTargetKind();
  if (!targetKind) return;
  const server = await pickServer(targetKind);
  const context = collectWorkspaceDebugContext();
  if (!context.workspaceRoot) {
    await vscode.window.showErrorMessage(
      "Alp: no workspace folder is open, cannot export a support bundle.",
    );
    return;
  }

  const runtime = collectRuntimeCapabilities();
  const generatedAt = new Date().toISOString();

  let profile;
  try {
    profile = createDebugProfile(targetKind, server);
  } catch (error) {
    await vscode.window.showErrorMessage(formatDebugError(error));
    return;
  }

  const preflight = buildDebugPreflightReport(
    generatedAt,
    context,
    profile,
    runtime,
    {
      pathExists: fileExists,
    },
  );

  const doctor = buildDoctorReport(context, { targetKind, server }, runtime);
  const inspect = createInspectReport(context);
  const bundle = createSupportBundlePayload({
    generatedAt,
    inspect,
    preflight,
    doctor,
    notes: [
      `targetKind=${targetKind}`,
      `server=${server}`,
      `canLaunch=${preflight.canLaunch}`,
    ],
  });

  const filePath = writeSupportBundle(
    context.workspaceRoot,
    `debug-support-bundle-${timestampForFile(generatedAt)}.json`,
    serializeSupportBundlePayload(bundle),
  );

  log(`alp.exportSupportBundle: wrote ${filePath}`);
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc, { preview: false });

  await vscode.window.showInformationMessage(
    `Alp: exported ${vscode.workspace.asRelativePath(filePath)}.`,
  );

  if (
    !preflight.canLaunch ||
    doctor.summary.fail > 0 ||
    doctor.summary.warn > 0
  ) {
    showOutput();
  }
}

async function openDebugTroubleshootingPanel(): Promise<void> {
  const targetKind = await pickTargetKind();
  if (!targetKind) return;
  const server = await pickServer(targetKind);
  const context = collectWorkspaceDebugContext();
  const runtime = collectRuntimeCapabilities();
  const generatedAt = new Date().toISOString();

  let profile;
  try {
    profile = createDebugProfile(targetKind, server);
  } catch (error) {
    await vscode.window.showErrorMessage(formatDebugError(error));
    return;
  }

  const preflight = buildDebugPreflightReport(
    generatedAt,
    context,
    profile,
    runtime,
    {
      pathExists: fileExists,
    },
  );

  const doctor = buildDoctorReport(context, { targetKind, server }, runtime);
  const inspect = createInspectReport(context);
  const trace = createGenerationTraceReport(
    generatedAt,
    "vscode.debugPanel",
    createPanelTraceDecisions(context),
  );

  const panel = vscode.window.createWebviewPanel(
    "alpTroubleshootingPanel",
    "ALP Troubleshooting",
    vscode.ViewColumn.Active,
    {
      enableCommandUris: true,
    },
  );

  panel.webview.html = createDebugTroubleshootingPanelHtml({
    cspSource: panel.webview.cspSource,
    generatedAt,
    targetKind,
    server,
    inspect,
    trace,
    doctor,
    preflight,
  });

  log(
    `alp.openDebugTroubleshootingPanel: opened panel for ${targetKind}/${server}`,
  );
}

function createPanelTraceDecisions(
  context: ReturnType<typeof collectWorkspaceDebugContext>,
): DebugGenerationTraceDecision[] {
  if (!context.workspaceRoot || !context.sdkRoot || !context.boardYamlPath) {
    return [
      {
        key: "generation.context",
        outcome: "failed",
        detail:
          "Trace preview is unavailable because workspaceRoot, sdkRoot, or boardYamlPath is unresolved.",
      },
    ];
  }

  if (!context.boardYamlExists) {
    return [
      {
        key: "generation.context.boardYaml",
        outcome: "failed",
        detail:
          "Trace preview is unavailable because board.yaml does not exist in the resolved project context.",
      },
    ];
  }

  const decisions: DebugGenerationTraceDecision[] = [];
  for (const emit of ALL_EMIT_MODES) {
    try {
      const plan = createLoaderPlan(context, emit);
      decisions.push({
        key: `generation.target.${emit}`,
        outcome: "planned",
        outputPath: plan.outputPath,
        detail: `Would run: ${plan.commandLine}`,
      });
    } catch (error) {
      decisions.push({
        key: `generation.target.${emit}`,
        outcome: "failed",
        detail:
          error instanceof Error
            ? error.message
            : "Unexpected trace planning failure.",
      });
    }
  }

  return decisions;
}

function formatDebugError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Alp: an unexpected debug configuration error occurred.";
}

function timestampForFile(isoTimestamp: string): string {
  return isoTimestamp.replace(/[:.]/g, "-");
}

export function registerDebugCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.inspectProjectState", () =>
      inspectProjectState(),
    ),
    vscode.commands.registerCommand("alp.debugDoctor", () => debugDoctor()),
    vscode.commands.registerCommand("alp.debugPreflight", () =>
      debugPreflight(),
    ),
    vscode.commands.registerCommand("alp.configureDebugProfile", () =>
      configureDebugProfile(),
    ),
    vscode.commands.registerCommand("alp.exportSupportBundle", () =>
      exportSupportBundle(),
    ),
    vscode.commands.registerCommand("alp.openDebugTroubleshootingPanel", () =>
      openDebugTroubleshootingPanel(),
    ),
  ];
}
