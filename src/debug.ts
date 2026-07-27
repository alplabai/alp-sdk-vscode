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
  DEBUG_ADAPTER_EXTENSION_ID,
  DEBUG_TARGET_ADAPTER,
  DEBUG_TARGET_CHOICES,
  isNativeHostTarget,
  serializeSupportBundlePayload,
  serverChoicesForTarget,
  unresolvedRequiredFields,
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
import { samePath } from "@alp-sdk/core/paths";
import { ensureNativeSimOverlay } from "./west";
import { NotifyAction } from "./notify/models";
import { planFailure, planPrecondition, planSuccess } from "./notify/service";
import { notify } from "./notify/vscodeAdapter";
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
  // Only a FAIL forces the channel open. The full report — every check, every
  // fix — is already open and focused in the editor above, so revealing the
  // channel is a second focus grab that adds one `log` line; it has to be
  // earned by something blocking. Same rule in `debugPreflight` and
  // `exportSupportBundle`.
  if (summary.summary.fail > 0) {
    showOutput();
  }
}

async function debugPreflight(): Promise<void> {
  const targetKind = await pickTargetKind();
  if (!targetKind) return;
  const server = await pickServer(targetKind);
  const context = collectWorkspaceDebugContext();

  let report;
  try {
    report = buildPreflight(context, targetKind, server).report;
  } catch (error) {
    await reportDebugFailure("Alp: the debug preflight", error);
    return;
  }

  log(
    `alp.debugPreflight: ran preflight for ${targetKind}/${server}, canLaunch=${report.canLaunch}`,
  );
  await showJsonDocument(report);
  // Not `|| summary.warn > 0`: on every MCU target `svdFile` warns permanently
  // — alp-sdk publishes no SVD and this thin extension must not vendor one —
  // so that clause yanked the channel open on every healthy run, over the one
  // item nobody can clear.
  if (!report.canLaunch) {
    showOutput();
  }
}

/** Profile + preflight for one target/server pair, off a caller-supplied
 *  workspace snapshot. Throws what `createDebugProfile` throws (unsupported
 *  target/backend); every caller that can hit that wraps it.
 *
 *  A report is a snapshot, never a cached fact: installing the adapter
 *  extension or writing the native_sim overlay changes the answer, so anything
 *  that mutates the environment has to re-run this rather than reuse an
 *  earlier report. */
function buildPreflight(
  context: ReturnType<typeof collectWorkspaceDebugContext>,
  targetKind: DebugTargetKind,
  server: DebugServerKind,
) {
  const profile = createDebugProfile(
    targetKind,
    server,
    resolveManifestSlice(context.workspaceRoot, targetKind),
  );
  return {
    profile,
    report: buildDebugPreflightReport(
      new Date().toISOString(),
      context,
      profile,
      collectRuntimeCapabilities(),
      { pathExists: fileExists },
    ),
  };
}

/** The outcome of generating (or refreshing) the launch profile, shared by the
 *  "configure profile" and "start debugging" commands. */
interface LaunchProfileResult {
  workspaceRoot: string;
  configName: string;
  launchPath: string;
  relPath: string;
  replaced: boolean;
  /** Preflight as of the write. A caller that then changes the environment —
   *  `startDebugging` installs the adapter extension — must re-run
   *  `buildPreflight` instead of gating on this. */
  report: ReturnType<typeof buildDebugPreflightReport>;
  notes: readonly string[];
  /** Customer-facing names of the required probe facts the written profile
   *  still carries as `<placeholder>` — "J-Link device name", never the
   *  internal PreflightCheck id `device`. Empty when nothing is missing.
   *  Non-empty implies `report.canLaunch === false`: every one of these is a
   *  failing check. */
  unresolved: readonly string[];
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
    await notify(
      planPrecondition("noWorkspace", { operation: "write launch.json" }),
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
    // launchJsonCore throws "Alp: .vscode/launch.json is not valid JSON or
    // JSONC." — an Open launch.json button is the remedy — but readLaunchJson
    // is inside this try too, and its errno carries the absolute path.
    await reportDebugFailure("Alp: updating .vscode/launch.json", error, [
      { id: "openLaunchJson" },
    ]);
    return null;
  }

  // The write is mkdirSync + writeFileSync. Uncaught, a read-only .vscode or a
  // locked file escapes the command handler and VS Code shows its own unbranded
  // "command failed" popup with the raw errno — no channel entry, no action.
  let launchPath: string;
  try {
    launchPath = writeLaunchJson(context.workspaceRoot, writePlan.content);
  } catch (error) {
    await reportDebugFailure("Alp: writing .vscode/launch.json", error);
    return null;
  }
  log(
    `alp debug: ${writePlan.replaced ? "updated" : "wrote"} launch profile for ${targetKind}/${server}`,
  );

  const { profile, report } = buildPreflight(context, targetKind, server);

  return {
    workspaceRoot: context.workspaceRoot,
    configName: String(configuration.name),
    launchPath,
    relPath: vscode.workspace.asRelativePath(launchPath),
    replaced: writePlan.replaced,
    report,
    notes: preview.notes,
    unresolved: unresolvedRequiredFields(profile),
  };
}

/**
 * Channel detail behind every "fill it in by hand" toast: WHY the extension
 * cannot supply these itself. alp-sdk metadata carries no J-Link device name,
 * no pyOCD target id and no OpenOCD board config, so there is nothing to
 * substitute — this is a gap in the published data, not a bug in the profile
 * writer, and the customer editing launch.json is the only path today.
 *
 * Probe facts only. It used to end by pointing at alp-sdk#948 (the SVD half of
 * the same metadata gap), but `svdFile` is deliberately excluded from
 * `unresolvedRequiredFields` — it is optional and only feeds the peripheral
 * view — so that clause could never be the reader's blocker and sent them
 * chasing a cross-repo issue instead of filling in the device name.
 */
const MISSING_PROBE_METADATA_DETAIL =
  "The Alp SDK does not publish probe metadata (J-Link device name, pyOCD target id, OpenOCD board config) for this board yet, so the extension has nothing to substitute.";

/**
 * The customer sentence for a profile whose required probe facts are still
 * `<placeholder>`. Takes the labels from `unresolvedRequiredFields` — a
 * customer can act on "the J-Link device name"; they cannot act on `device`.
 */
function unresolvedFieldsSentence(fields: readonly string[]): string {
  const list = fields.map((field) => `the ${field}`);
  const many = list.length > 1;
  const joined = many
    ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`
    : list.join("");
  return `${joined} ${many ? "aren't" : "isn't"} in the Alp SDK's board metadata yet, so ${many ? "they" : "it"} must be filled in by hand.`;
}

async function configureDebugProfile(): Promise<void> {
  const result = await writeLaunchProfile();
  if (!result) return;

  const doc = await vscode.workspace.openTextDocument(result.launchPath);
  await vscode.window.showTextDocument(doc, { preview: false });

  const verb = result.replaced ? "updated" : "wrote";
  if (result.report.canLaunch) {
    // The document this announces was just opened and focused above — a toast
    // would steal focus to restate what is already on screen.
    await notify(planSuccess(`Alp: ${verb} ${result.relPath}.`));
    return;
  }

  for (const note of result.notes) log(note);

  // The file WAS written and is worth keeping: an expert who knows their own
  // board fills the device name in and debugs today, where refusing would leave
  // them with nothing. What is NOT acceptable is writing `"device":
  // "<resolved-device>"` silently — that config looks finished and dies later
  // inside J-Link with a probe error that names nothing. So say which facts are
  // missing, in the customer's terms.
  //
  // This REPLACES the generic toast below rather than stacking on it: every
  // unresolved field is itself a failing check, so both branches would fire for
  // one cause, and the named one is strictly more useful.
  if (result.unresolved.length > 0) {
    await notify(
      planFailure({
        operation: "Alp: refreshing the launch profile",
        cause: `Alp: ${verb} ${result.relPath}, but ${unresolvedFieldsSentence(result.unresolved)}`,
        detail: `${MISSING_PROBE_METADATA_DETAIL} ${result.report.nextSteps.join(" ")}`,
        severity: "warning",
        // The document is open above, but the customer may have clicked away
        // by the time they read this; `arg` pins the file just written rather
        // than letting the presenter re-resolve a workspace root.
        actions: [{ id: "openLaunchJson", arg: result.launchPath }],
      }),
    );
    return;
  }

  // Everything else that blocks a launch — an unbuilt artefact, a probe tool
  // missing from PATH. `nextSteps` are the checks' own customer-facing fixes;
  // the failing check NAMES are internal PreflightCheck ids and deliberately do
  // not appear, here or in the channel. The Troubleshooting panel renders the
  // per-item state for anyone who wants it.
  await notify(
    planFailure({
      operation: "Alp: refreshing the launch profile",
      cause: `Alp: ${verb} ${result.relPath}, but the profile is not launchable yet.`,
      detail: result.report.nextSteps.join(" "),
      severity: "warning",
      actions: [{ id: "openTroubleshooting" }],
    }),
  );
}

/**
 * What the install prompt needs to SAY per target class — the extension id
 * itself is not here. `DEBUG_ADAPTER_EXTENSION_ID[DEBUG_TARGET_ADAPTER[kind]]`
 * in the core is the one copy in the repo, shared with preflight and doctor, so
 * this surface cannot prompt for one extension while preflight checks another.
 * (Hand-copying the ids here is how "native-host needs Cortex-Debug" once
 * survived a green suite: the old `/Yocto/i.test(configName)` heuristic named
 * Cortex-Debug for "Alp: Native Sim Debug", whose adapter is the `lldb` type
 * contributed by CodeLLDB, vadimcn.vscode-lldb.)
 *
 * `label` is the extension's marketplace NAME, for the sentence a human reads;
 * `dependency` = listed in package.json `extensionDependencies`, so VS Code
 * guarantees it is INSTALLED: a missing `getExtension` there means disabled,
 * and `workbench.extensions.installExtension` is a documented no-op on that
 * state. The extensionPack entries (cpptools, CodeLLDB) can genuinely be
 * uninstalled, so only those get an Install prompt. An exhaustive Record makes
 * a new target kind a compile error rather than a silent fall-through.
 */
const DEBUG_ADAPTER_EXTENSION: Record<
  DebugTargetKind,
  { label: string; dependency: boolean }
> = {
  "zephyr-mcu": { label: "Cortex-Debug", dependency: true },
  "baremetal-mcu": { label: "Cortex-Debug", dependency: true },
  "yocto-userspace": { label: "C/C++ (cpptools)", dependency: false },
  "native-host": { label: "CodeLLDB", dependency: false },
};

/** True when the adapter extension is usable. Prompts rather than letting the
 *  session fail with "unknown debug type", and owns BOTH refusal messages: the
 *  caller only has to stop, so a cancelled prompt is not re-toasted and a
 *  genuine install failure is not confused with it. */
async function ensureDebugExtension(
  targetKind: DebugTargetKind,
): Promise<boolean> {
  const { label, dependency } = DEBUG_ADAPTER_EXTENSION[targetKind];
  const id = DEBUG_ADAPTER_EXTENSION_ID[DEBUG_TARGET_ADAPTER[targetKind]];
  if (vscode.extensions.getExtension(id)) return true;

  if (dependency) {
    // Cannot be absent, only disabled — and enabling it needs a window reload,
    // so there is no "install and carry on" path to offer here.
    await notify(
      planFailure({
        operation: "Alp: starting the debug session",
        cause: `Alp: the ${label} extension is disabled, and this target cannot be debugged without it.`,
        detail: `${id} is an extension dependency of alp-sdk, so it is installed but not enabled.`,
        severity: "warning",
        actions: [{ id: "openExtensions", arg: id }],
      }),
    );
    return false;
  }

  // `custom` is the caller-handled id (no `run` in the presenter's table), so
  // the pick comes back here and gates the install below.
  const choice = await notify(
    planFailure({
      operation: "Alp: starting the debug session",
      cause: `Alp: the ${label} extension is required to debug this target but is not installed.`,
      detail: id,
      severity: "warning",
      actions: [{ id: "custom", title: "Install" }],
    }),
  );
  if (choice !== "custom") return false;

  await vscode.commands.executeCommand(
    "workbench.extensions.installExtension",
    id,
  );
  // installExtension resolves once installed; getExtension then sees it.
  if (vscode.extensions.getExtension(id)) return true;

  await notify(
    planFailure({
      operation: "Alp: installing the debug adapter extension",
      cause: `Alp: ${label} could not be installed, so the debug session was not started.`,
      detail: id,
      severity: "warning",
      actions: [{ id: "openExtensions", arg: id }],
    }),
  );
  return false;
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

  // The refusal is warned inside ensureDebugExtension (a cancelled prompt needs
  // no second toast; a failed install gets its own), so this only has to stop.
  if (!(await ensureDebugExtension(result.report.targetKind))) return;

  // Re-run the preflight: `result.report` predates both steps above, and both
  // change its answer. On a first-ever native-host run the customer accepts the
  // Install prompt, CodeLLDB lands, and gating on the stale report would answer
  // that with "not launchable yet" over the `adapterExtension` check they just
  // cleared. Cheap (one manifest read + PATH probes) next to starting a
  // session, and it also picks up an artefact built since the write.
  const { report } = buildPreflight(
    collectWorkspaceDebugContext(),
    result.report.targetKind,
    result.report.server,
  );

  if (!report.canLaunch) {
    for (const note of result.notes) log(note);
    // Placeholders in the file just written; unaffected by the recheck, which
    // reads the same profile inputs.
    const missing = result.unresolved.length > 0;
    const nextSteps = report.nextSteps.join(" ");
    // Same honesty as the write path: name the facts, not the check ids. On
    // this path "Open launch.json" is also the real remedy — Start Anyway hands
    // `<resolved-device>` to the probe — and it is presenter-handled, so
    // picking it opens the file and returns undefined, i.e. does not start.
    const choice = await notify(
      planFailure({
        operation: "Alp: starting the debug session",
        cause: missing
          ? `Alp: ${result.relPath} is not launchable — ${unresolvedFieldsSentence(result.unresolved)}`
          : `Alp: ${result.relPath} is not launchable yet.`,
        detail: missing
          ? `${MISSING_PROBE_METADATA_DETAIL} ${nextSteps}`
          : nextSteps,
        severity: "warning",
        actions: missing
          ? [
              { id: "openLaunchJson", arg: result.launchPath },
              { id: "startAnyway" },
            ]
          : [{ id: "startAnyway" }],
      }),
    );
    if (choice !== "startAnyway") return;
  }

  // `result.workspaceRoot` is toPosix'd by the project service while
  // `uri.fsPath` stays native, so this must not be a raw `===` (#303).
  const folder = vscode.workspace.workspaceFolders?.find((candidate) =>
    samePath(candidate.uri.fsPath, result.workspaceRoot),
  );
  const started = await vscode.debug.startDebugging(folder, result.configName);
  if (!started) {
    // The presenter logs this and appends "Show Output"; the message itself
    // points at the Debug Console / launch.json, so don't also force-open the
    // Alp SDK channel here.
    await notify(
      planFailure({
        operation: "Alp: starting the debug session",
        cause: `Alp: VS Code declined to start "${result.configName}" — check the Debug Console and launch.json.`,
      }),
    );
  }
}

async function exportSupportBundle(): Promise<void> {
  const targetKind = await pickTargetKind();
  if (!targetKind) return;
  const server = await pickServer(targetKind);
  const context = collectWorkspaceDebugContext();
  if (!context.workspaceRoot) {
    await notify(
      planPrecondition("noWorkspace", {
        operation: "export a support bundle",
      }),
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
    await reportDebugFailure("Alp: exporting the support bundle", error);
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

  // mkdirSync + writeFileSync, same unguarded-throw hazard as writeLaunchJson.
  let filePath: string;
  try {
    filePath = writeSupportBundle(
      context.workspaceRoot,
      `debug-support-bundle-${timestampForFile(generatedAt)}.json`,
      serializeSupportBundlePayload(bundle),
    );
  } catch (error) {
    await reportDebugFailure("Alp: writing the support bundle", error);
    return;
  }

  log(`alp.exportSupportBundle: wrote ${filePath}`);
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc, { preview: false });

  // The bundle is already open in an editor, and the block below may reveal the
  // channel — a toast here would be the second focus grab for one command.
  await notify(
    planSuccess(`Alp: exported ${vscode.workspace.asRelativePath(filePath)}.`),
  );

  // Fail-only, same rule as debugDoctor/debugPreflight: the bundle carrying
  // every check is open in the editor above, and a warn there is routinely the
  // permanent `svdFile` one.
  if (!preflight.canLaunch || doctor.summary.fail > 0) {
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
    await reportDebugFailure("Alp: opening the troubleshooting panel", error);
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

/**
 * The one exit for every thrown-error path in this file. The toast names what
 * the USER asked for and nothing else: the thrown message is internal jargon
 * ("Unsupported debug target '<kind>'.", "Unsupported debug backend '<server>'
 * for target '<targetKind>'.") or a raw errno carrying the absolute path
 * (`readLaunchJson`, `writeLaunchJson`, `writeSupportBundle`). Both belong in
 * `detail`, which the presenter logs to the "Alp SDK" channel and never
 * renders. The old `formatDebugError` interpolated all of it into the toast,
 * and called every one of these "debug configuration failed" — wrong noun on
 * the support-bundle and panel paths.
 *
 * `operation` is the customer-terms phrase the sentence is built from:
 * "Alp: exporting the support bundle" -> "Alp: exporting the support bundle
 * failed."
 */
async function reportDebugFailure(
  operation: string,
  error: unknown,
  actions?: NotifyAction[],
): Promise<void> {
  await notify(
    planFailure({
      operation,
      cause: `${operation} failed.`,
      detail: debugErrorDetail(error),
      actions,
    }),
  );
}

/** Full detail for the "Alp SDK" channel behind a `reportDebugFailure` toast:
 *  the stack trace when available (call-site context beyond the bare message),
 *  or the raw thrown value when it isn't an `Error` at all. */
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
