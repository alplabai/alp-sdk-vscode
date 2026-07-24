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
  isNativeHostTarget,
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
import { ensureNativeSimOverlay } from "./west";
import { log, reportError, showOutput } from "./util";

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
    await reportError(formatDebugError(error), debugErrorDetail(error));
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

/** The outcome of generating (or refreshing) the launch profile, shared by the
 *  "configure profile" and "start debugging" commands. */
interface LaunchProfileResult {
  workspaceRoot: string;
  configName: string;
  launchPath: string;
  relPath: string;
  replaced: boolean;
  report: ReturnType<typeof buildDebugPreflightReport>;
  notes: readonly string[];
}

/** Prompt for target/server, write the launch.json profile, and return what a
 *  caller needs to report status or start a session. Null when the user
 *  cancelled or no workspace is open (a message is shown for the latter). */
async function writeLaunchProfile(): Promise<LaunchProfileResult | null> {
  const targetKind = await pickTargetKind();
  if (!targetKind) return null;
  const server = await pickServer(targetKind);
  const context = collectWorkspaceDebugContext();
  if (!context.workspaceRoot) {
    await vscode.window.showErrorMessage(
      "Alp: no workspace folder is open, cannot write launch.json.",
    );
    return null;
  }

  const slice = resolveManifestSlice(context.workspaceRoot, targetKind);
  const preview = createLaunchPreview(
    new Date().toISOString(),
    targetKind,
    server,
    slice,
  );
  const configuration = preview.launch.configurations[0]!;

  let writePlan;
  try {
    writePlan = createLaunchJsonWritePlan(
      readLaunchJson(context.workspaceRoot),
      configuration,
    );
  } catch (error) {
    await reportError(formatDebugError(error), debugErrorDetail(error));
    return null;
  }

  const launchPath = writeLaunchJson(context.workspaceRoot, writePlan.content);
  log(
    `alp debug: ${writePlan.replaced ? "updated" : "wrote"} launch profile for ${targetKind}/${server}`,
  );

  const report = buildDebugPreflightReport(
    new Date().toISOString(),
    context,
    createDebugProfile(targetKind, server, slice),
    collectRuntimeCapabilities(),
    { pathExists: fileExists },
  );

  return {
    workspaceRoot: context.workspaceRoot,
    configName: String(configuration.name),
    launchPath,
    relPath: vscode.workspace.asRelativePath(launchPath),
    replaced: writePlan.replaced,
    report,
    notes: preview.notes,
  };
}

async function configureDebugProfile(): Promise<void> {
  const result = await writeLaunchProfile();
  if (!result) return;

  const doc = await vscode.workspace.openTextDocument(result.launchPath);
  await vscode.window.showTextDocument(doc, { preview: false });

  const verb = result.replaced ? "updated" : "wrote";
  if (result.report.canLaunch) {
    await vscode.window.showInformationMessage(
      `Alp: ${verb} ${result.relPath}.`,
    );
    return;
  }

  for (const note of result.notes) log(note);
  const unresolved = result.report.checks
    .filter((check) => check.status === "fail")
    .map((check) => check.name)
    .join(", ");
  await vscode.window.showWarningMessage(
    `Alp: ${verb} ${result.relPath}, but it is not launchable yet — resolve: ${unresolved}. ${result.report.nextSteps.join(" ")}`,
  );
  showOutput();
}

/** Debug-adapter extension required per server. cortex-debug drives the on-chip
 *  servers (J-Link/OpenOCD/pyOCD); the Yocto remote path uses cppdbg (cpptools).
 *  These ship in the extension pack, but a user can disable one — offer to
 *  (re)install rather than let the session fail with "unknown debug type". */
function requiredDebugExtension(configName: string): {
  id: string;
  label: string;
} {
  return /Yocto/i.test(configName)
    ? { id: "ms-vscode.cpptools", label: "C/C++ (cpptools)" }
    : { id: "marus25.cortex-debug", label: "Cortex-Debug" };
}

async function ensureDebugExtension(configName: string): Promise<boolean> {
  const { id, label } = requiredDebugExtension(configName);
  if (vscode.extensions.getExtension(id)) return true;
  const choice = await vscode.window.showWarningMessage(
    `Alp: the ${label} extension (${id}) is required to debug this target but is not installed.`,
    "Install",
    "Cancel",
  );
  if (choice !== "Install") return false;
  await vscode.commands.executeCommand(
    "workbench.extensions.installExtension",
    id,
  );
  // installExtension resolves once installed; getExtension then sees it.
  return vscode.extensions.getExtension(id) !== undefined;
}

/** First-class "Debug": generate/refresh the launch profile, make sure the
 *  debug-adapter extension is present, then start the session. */
async function startDebugging(context: vscode.ExtensionContext): Promise<void> {
  const result = await writeLaunchProfile();
  if (!result) return;

  // native_sim/native-host is the only debug class that runs a host binary
  // under CodeLLDB with no on-chip probe — the same class the native_sim GPIO
  // overlay generation targets (issue #86, mirrors westRunNativeSim's
  // pre-run hook). On-target (cortex-debug/cppdbg) profiles never match, so
  // this never fires for an SWD/J-Link/OpenOCD/pyOCD/gdbserver session.
  if (isNativeHostTarget(result.report.targetKind)) {
    await ensureNativeSimOverlay(context);
  }

  if (!(await ensureDebugExtension(result.configName))) {
    await vscode.window.showWarningMessage(
      `Alp: cannot start debugging without ${requiredDebugExtension(result.configName).label}.`,
    );
    return;
  }

  if (!result.report.canLaunch) {
    for (const note of result.notes) log(note);
    const unresolved = result.report.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.name)
      .join(", ");
    const choice = await vscode.window.showWarningMessage(
      `Alp: ${result.relPath} is not launchable yet — resolve: ${unresolved}. ${result.report.nextSteps.join(" ")}`,
      "Start Anyway",
      "Show Details",
    );
    if (choice === "Show Details") {
      showOutput();
      return;
    }
    if (choice !== "Start Anyway") return;
  }

  const folder = vscode.workspace.workspaceFolders?.find(
    (candidate) => candidate.uri.fsPath === result.workspaceRoot,
  );
  const started = await vscode.debug.startDebugging(folder, result.configName);
  if (!started) {
    // reportError already logs this and offers a "Show Output" action; the
    // message itself points at the Debug Console / launch.json, so don't also
    // force-open the Alp SDK channel here.
    await reportError(
      `Alp: VS Code declined to start "${result.configName}" — check the Debug Console and launch.json.`,
    );
  }
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
    await reportError(formatDebugError(error), debugErrorDetail(error));
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
    await reportError(formatDebugError(error), debugErrorDetail(error));
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
  // Keep the `Alp:` brand prefix + a debug context on EVERY path — the
  // Error branch used to return the raw `error.message` with neither, so a
  // failure surfaced as a bare, unattributed toast.
  const detail =
    error instanceof Error ? error.message : "an unexpected error occurred.";
  return `Alp: debug configuration failed — ${detail}`;
}

/** Full detail for the "Alp SDK" channel behind a `formatDebugError` toast: the
 *  stack trace when available (call-site context beyond the bare message baked
 *  into the toast), or the raw thrown value when it isn't an `Error` at all
 *  (which the toast genericizes to "an unexpected error occurred."). */
function debugErrorDetail(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

function timestampForFile(isoTimestamp: string): string {
  return isoTimestamp.replace(/[:.]/g, "-");
}

export function registerDebugCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
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
    vscode.commands.registerCommand("alp.debug", () => startDebugging(context)),
    vscode.commands.registerCommand("alp.exportSupportBundle", () =>
      exportSupportBundle(),
    ),
    vscode.commands.registerCommand("alp.openDebugTroubleshootingPanel", () =>
      openDebugTroubleshootingPanel(),
    ),
  ];
}
