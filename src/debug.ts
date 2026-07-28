// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  DebugGenerationTraceDecision,
  DebugServerKind,
  DebugTargetKind,
} from "@alp-sdk/core/debug/models";
import type { ManifestSlice } from "@alp-sdk/core/systemManifest/models";
import { parseSystemManifest } from "@alp-sdk/core/systemManifest/service";
import { samePath } from "@alp-sdk/core/paths";
import { createDebugTroubleshootingPanelHtml } from "@alp-sdk/core/debug/panelHtml";
import {
  buildDebugPreflightReport,
  buildDoctorReport,
  createDebugProfile,
  createGenerationTraceReport,
  createInspectReport,
  createSupportBundlePayload,
  DEBUG_TARGET_CHOICES,
  foldLaunchConfigPlaceholders,
  isNativeHostTarget,
  serializeSupportBundlePayload,
  serverChoicesForTarget,
} from "@alp-sdk/core/debug/service";
import {
  collectRuntimeCapabilities,
  collectWorkspaceDebugContext,
  fileExists,
  writeSupportBundle,
} from "./debug/vscodeAdapter";
import { ALL_EMIT_MODES, createLoaderPlan } from "@alp-sdk/core/loader/service";
import { runAlpCommand } from "./alpCli/vscodeAdapter";
import {
  DebugConfigData,
  SUPPORTED_CLI_VERSION,
  isDebugConfigData,
  launchConfigPlaceholders,
} from "./alpCli/service";
import { ensureNativeSimOverlay } from "./west";
import { log, showOutput } from "./util";
import { NotifyAction } from "./notify/models";
import { planFailure, planPrecondition, planSuccess } from "./notify/service";
import { notify } from "./notify/vscodeAdapter";

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
    await reportDebugFailure("Alp: the debug preflight", error);
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

/** Prompt for target/server, have `tan debug-config` write the launch profile,
 *  and return what a caller needs to report status or start a session. Null
 *  when the user cancelled, no workspace is open, or the CLI could not produce
 *  a usable configuration (a message is shown for the latter two).
 *
 *  The configuration comes from `tan debug-config`, which resolves the
 *  probe/tool values from the build's own `runners.yaml` (tan-cli#66). The
 *  extension deliberately keeps NO second draft: it had one, with the same
 *  unresolved `<resolved-device>` placeholders, and a fork of the same logic in
 *  two languages meant fixing one left the other handing out broken files
 *  (#339). What stays in-process is the readiness report below — it probes
 *  which debugger extensions are installed, host state a separate process
 *  cannot observe (EXTENSION_CLI_INTEGRATION.md §4a).
 *
 *  Two passes on purpose: `--preview` first, and only a real write once the
 *  envelope is accepted. Writing first and validating after means an older
 *  `tan` (no `data.configuration`) reports a failure the user cannot act on
 *  while their `launch.json` has already gained a config full of placeholders
 *  they never asked for. */
async function writeLaunchProfile(
  extensionContext: vscode.ExtensionContext,
): Promise<LaunchProfileResult | null> {
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
  const args = [
    "debug-config",
    "--target-kind",
    targetKind,
    "--server",
    server,
  ];
  // Pin the CLI to the same slice this command's readiness report describes.
  // `resolveManifestSlice` takes the first slice matching the target's OS —
  // the identical default the CLI documents — so this makes the two agree
  // rather than choosing between cores. A user wanting the SECOND Zephyr core
  // is still never asked; that is a separate gap.
  if (slice?.core_id) args.push("--core", slice.core_id);

  const preview = await runDebugConfig(
    extensionContext,
    context.workspaceRoot,
    [...args, "--preview"],
  );
  if (!preview) return null;

  // Shape accepted — now let the CLI write for real.
  const written = await runDebugConfig(
    extensionContext,
    context.workspaceRoot,
    args,
  );
  if (!written) return null;

  const placeholders = launchConfigPlaceholders(written.configuration);
  log(
    `alp debug: ${written.replaced ? "updated" : "wrote"} launch profile for ${targetKind}/${server}`,
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
    configName: written.configuration.name,
    launchPath: written.launchJsonPath,
    relPath: vscode.workspace.asRelativePath(written.launchJsonPath),
    replaced: written.replaced,
    // The in-process report answers "is the HOST ready" (adapters installed).
    // It cannot see that the CLI left `<resolved-device>` in the file it just
    // wrote — `tan debug-config` reports ok for a partly-resolved draft by
    // design. Without this the user is told the profile is ready and the
    // session dies inside the adapter. foldLaunchConfigPlaceholders adds a
    // real "launchConfig" check (rather than just flipping `canLaunch`), so
    // `report.checks`/`summary`/`nextSteps` name the failure too — both
    // consumers below build their message from `checks`.
    report: foldLaunchConfigPlaceholders(report, placeholders),
    // The placeholders are now named by the folded check's own detail/fix, so
    // no separate note is needed here — keep only the CLI's own notes.
    notes: written.notes,
  };
}

/** One `tan debug-config` invocation, with the two failure modes reported
 *  distinctly. `null` on either.
 *
 *  They are separate because they need different words. A non-zero exit is the
 *  CLI's own complaint (a bad flag, an unreadable `launch.json`). A zero exit
 *  whose payload has no `configuration` is version skew — `outcome.message` is
 *  literally "Command completed." there, so reporting it as the failure reason
 *  tells the user the command both failed and succeeded. */
async function runDebugConfig(
  extensionContext: vscode.ExtensionContext,
  cwd: string,
  args: string[],
): Promise<DebugConfigData | null> {
  const outcome = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Alp: generating the debug configuration",
      cancellable: true,
    },
    async (_progress, token) => {
      // A first-ever Debug may DOWNLOAD the tan binary inside this call; with
      // no progress UI the user stares at nothing after the two quick-picks.
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      const result = await runAlpCommand(extensionContext, args, cwd, {
        signal: controller.signal,
      });
      return result.outcome;
    },
  );

  if (!outcome.ok) {
    const skew =
      outcome.kind === "validation" && args.includes("--core")
        ? ` This extension requires tan ${SUPPORTED_CLI_VERSION} or newer; run "Alp: Update CLI" and retry.`
        : "";
    await notify(
      planFailure({
        operation: "Alp: generating the debug configuration",
        cause: `Alp: the debug configuration could not be generated.${skew}`,
        detail: outcome.message,
        actions: [{ id: "showOutput" }],
      }),
    );
    return null;
  }

  const data = outcome.envelope?.data;
  if (!isDebugConfigData(data)) {
    await notify(
      planFailure({
        operation: "Alp: generating the debug configuration",
        cause: `Alp: this tan CLI does not report the debug configuration — it predates the ${SUPPORTED_CLI_VERSION} this extension requires. Run "Alp: Update CLI" and retry.`,
        detail: outcome.envelope
          ? JSON.stringify(outcome.envelope, null, 2)
          : undefined,
        actions: [{ id: "showOutput" }],
      }),
    );
    return null;
  }
  return data;
}

/** Every debug-path failure toast goes through here so the sentence names the
 *  OPERATION that failed, not a generic "debug configuration failed" (#368).
 *  Ported with this rebase: #342 predates the notify layer entirely and still
 *  called `reportError`, which #368 removed from `./util`. */
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

async function configureDebugProfile(
  context: vscode.ExtensionContext,
): Promise<void> {
  const result = await writeLaunchProfile(context);
  if (!result) return;

  const doc = await vscode.workspace.openTextDocument(result.launchPath);
  await vscode.window.showTextDocument(doc, { preview: false });

  const verb = result.replaced ? "updated" : "wrote";
  if (result.report.canLaunch) {
    await notify(planSuccess(`Alp: ${verb} ${result.relPath}.`));
    return;
  }

  const unresolved = logUnlaunchableDetail(result);
  await notify(
    planFailure({
      operation: "Alp: refreshing the launch profile",
      cause: `Alp: ${verb} ${result.relPath}, but it is not launchable yet — resolve: ${unresolved}.`,
      detail: result.report.nextSteps.join(" "),
      severity: "warning",
      actions: [{ id: "openLaunchJson", arg: result.launchPath }],
    }),
  );
}

/** Log everything behind a "not launchable yet" toast, and return the check
 *  names that toast lists. The toast has room for names only, so the WHY has
 *  to reach the channel it sends the user to (`showOutput()`): each failing
 *  check's `detail`/`fix`. That is the ONLY place the unresolved values
 *  themselves survive — the folded `launchConfig` check
 *  (`foldLaunchConfigPlaceholders`) carries the `<resolved-…>` list in its
 *  detail, and the CLI's own notes only say placeholders exist in general,
 *  never which. Logging names alone would leave "resolve: launchConfig" with
 *  no way to find out which field. */
function logUnlaunchableDetail(result: LaunchProfileResult): string {
  for (const note of result.notes) log(note);
  const failures = result.report.checks.filter(
    (check) => check.status === "fail",
  );
  for (const check of failures) {
    log(`${check.name}: ${check.detail}${check.fix ? ` — ${check.fix}` : ""}`);
  }
  return failures.map((check) => check.name).join(", ");
}

/** Debug-adapter extension required per server. cortex-debug drives the on-chip
 *  servers (J-Link/OpenOCD/pyOCD); the Yocto remote path uses cppdbg (cpptools).
 *  cortex-debug is an `extensionDependency`, so it cannot be absent — only
 *  DISABLED, which `vscode.extensions.getExtension` reports the same way.
 *  cpptools ships in the extension pack and can genuinely be uninstalled.
 *  Either way, prompt rather than let the session fail with "unknown debug
 *  type". (The prompt's Install action is a no-op on a merely disabled
 *  extension — tracked separately.) */
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
  return vscode.extensions.getExtension(id) !== undefined;
}

/** First-class "Debug": generate/refresh the launch profile, make sure the
 *  debug-adapter extension is present, then start the session. */
async function startDebugging(context: vscode.ExtensionContext): Promise<void> {
  const result = await writeLaunchProfile(context);
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
    await notify(
      planFailure({
        operation: "Alp: starting the debug session",
        cause: `Alp: cannot start debugging without ${requiredDebugExtension(result.configName).label}.`,
        severity: "warning",
      }),
    );
    return;
  }

  if (!result.report.canLaunch) {
    const unresolved = logUnlaunchableDetail(result);
    // Both ids are caller-handled, so the pick comes back here. `showOutput`
    // IS presenter-run, so it opens the channel and returns undefined — which
    // correctly does NOT start the session.
    const choice = await notify(
      planFailure({
        operation: "Alp: starting the debug session",
        cause: `Alp: ${result.relPath} is not launchable yet — resolve: ${unresolved}.`,
        detail: result.report.nextSteps.join(" "),
        severity: "warning",
        actions: [{ id: "startAnyway" }, { id: "showOutput" }],
      }),
    );
    if (choice !== "startAnyway") return;
  }

  // `result.workspaceRoot` is toPosix'd by the project service while
  // `uri.fsPath` stays native, so this must not be a raw `===` (#303/#355).
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

  const filePath = writeSupportBundle(
    context.workspaceRoot,
    `debug-support-bundle-${timestampForFile(generatedAt)}.json`,
    serializeSupportBundlePayload(bundle),
  );

  log(`alp.exportSupportBundle: wrote ${filePath}`);
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc, { preview: false });

  await notify(
    planSuccess(`Alp: exported ${vscode.workspace.asRelativePath(filePath)}.`),
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
      configureDebugProfile(context),
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
