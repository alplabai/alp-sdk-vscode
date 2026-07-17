// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { createLaunchJsonWritePlan } from "@alp-sdk/core/debug/launchJsonCore";
import {
  DebugGenerationTraceDecision,
  DebugServerKind,
  DebugTargetKind,
} from "@alp-sdk/core/debug/models";
import type { ManifestSlice } from "@alp-sdk/core/systemManifest/models";
import { parseSystemManifest } from "@alp-sdk/core/systemManifest/service";
import { createDebugTroubleshootingPanelHtml } from "@alp-sdk/core/debug/panelHtml";
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
} from "@alp-sdk/core/debug/service";
import {
  collectRuntimeCapabilities,
  collectWorkspaceDebugContext,
  fileExists,
  readLaunchJson,
  writeLaunchJson,
  writeSupportBundle,
} from "./debug/vscodeAdapter";
import { ALL_EMIT_MODES, createLoaderPlan } from "@alp-sdk/core/loader/service";
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

/** Debug target → the manifest slice `os` it builds for. native-host is a host
 *  sim with no per-core slice. */
const TARGET_OS: Partial<Record<DebugTargetKind, string>> = {
  "zephyr-mcu": "zephyr",
  "baremetal-mcu": "baremetal",
  "yocto-userspace": "yocto",
};

/** The system-manifest slice whose runtime matches the debug target, read from
 *  the post-build `build/system-manifest.yaml` when present, so createDebugProfile
 *  points at the per-core build dir / built artefact instead of the generic
 *  single-core default. Returns undefined pre-build (graceful fallback) or for
 *  native-host. For a multi-core runtime (e.g. two Zephyr cores) it picks the
 *  first slice — typically the app core, which leads the manifest. */
function resolveManifestSlice(
  workspaceRoot: string | null,
  targetKind: DebugTargetKind,
): ManifestSlice | undefined {
  const os = TARGET_OS[targetKind];
  if (!os || !workspaceRoot) return undefined;
  const manifestPath = path.join(
    workspaceRoot,
    "build",
    "system-manifest.yaml",
  );
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const manifest = parseSystemManifest(fs.readFileSync(manifestPath, "utf8"));
    return manifest.slices.find((slice) => slice.os === os);
  } catch {
    return undefined;
  }
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
    profile = createDebugProfile(
      targetKind,
      server,
      resolveManifestSlice(context.workspaceRoot, targetKind),
    );
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

  const slice = resolveManifestSlice(context.workspaceRoot, targetKind);
  const preview = createLaunchPreview(
    new Date().toISOString(),
    targetKind,
    server,
    slice,
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
  const report = buildDebugPreflightReport(
    new Date().toISOString(),
    context,
    createDebugProfile(targetKind, server, slice),
    collectRuntimeCapabilities(),
    { pathExists: fileExists },
  );
  const relPath = vscode.workspace.asRelativePath(launchPath);
  const verb = writePlan.replaced ? "updated" : "wrote";
  if (report.canLaunch) {
    await vscode.window.showInformationMessage(`Alp: ${verb} ${relPath}.`);
    return;
  }

  for (const note of preview.notes) log(note);
  const unresolved = report.checks
    .filter((check) => check.status === "fail")
    .map((check) => check.name)
    .join(", ");
  await vscode.window.showWarningMessage(
    `Alp: ${verb} ${relPath}, but it is not launchable yet — resolve: ${unresolved}. ${report.nextSteps.join(" ")}`,
  );
  showOutput();
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
    profile = createDebugProfile(
      targetKind,
      server,
      resolveManifestSlice(context.workspaceRoot, targetKind),
    );
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
    profile = createDebugProfile(
      targetKind,
      server,
      resolveManifestSlice(context.workspaceRoot, targetKind),
    );
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
    "Alp Troubleshooting",
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
