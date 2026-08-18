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
  buildDebugDoctorSection,
  buildDebugPreflightReport,
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
  runDebugDoctor,
  writeSupportBundle,
} from "./debug/vscodeAdapter";
import { readSvdPath } from "./project/vscodeAdapter";
import {
  readLaunchJsonDocument,
  writeLaunchJsonDocument,
} from "./debug/launchJsonFile";
import {
  debugConfigArgs,
  findRescuablePairs,
  gradeWrittenLaunchConfig,
  planOrphanRescue,
} from "./debug/service";
import { ALL_EMIT_MODES, createLoaderPlan } from "@alp-sdk/core/loader/service";
import { runAlpCommand } from "./alpCli/vscodeAdapter";
import {
  DebugConfigData,
  SUPPORTED_CLI_VERSION,
  isDebugConfigData,
} from "./alpCli/service";
import { ensureNativeSimOverlay } from "./west";
import { log, showOutput } from "./util";
import { NotifyAction } from "./notify/models";
import {
  isCancellation,
  planCliOutcome,
  planFailure,
  planPrecondition,
  planSuccess,
} from "./notify/service";
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

/**
 * `tan doctor` — "can this machine and project build and debug at all",
 * target-agnostic (#376). No target/server QuickPicks: those pickers exist
 * for `alp.debugPreflight`'s per-target readiness, which this command no
 * longer drafts (`buildDoctorReport` and its `serverCompatibility` check are
 * gone — see docs/EXTENSION_CLI_INTEGRATION.md §4a).
 *
 * A missing workspace or an unresolvable `tan` both end in exactly ONE
 * message where the table used to render — never a second, in-process
 * doctor.
 */
async function debugDoctor(
  extensionContext: vscode.ExtensionContext,
): Promise<void> {
  const context = collectWorkspaceDebugContext();
  if (!context.workspaceRoot) {
    await notify(
      planPrecondition("noWorkspace", { operation: "run the debug doctor" }),
    );
    return;
  }

  const { data, outcome } = await runDebugDoctor(
    extensionContext,
    context.workspaceRoot,
    { interactive: true },
  );
  if (!data) {
    // `planCliOutcome`, like every other CLI consumer in this repo
    // (src/loader.ts, ideHub/sdkManagerMessages.ts, ideHub/buildPlanPanel.ts)
    // — never a bare sentence built off `outcome.message` alone. It is what
    // splits "tan was never installed" (an Install action) from "tan is
    // there but broken" (Settings/Doctor), and offers Retry; a plain
    // `planFailure` here was a buttonless dead end.
    if (
      (await notify(
        planCliOutcome(outcome, { operation: "Running the debug doctor" }),
      )) === "retry"
    ) {
      await debugDoctor(extensionContext);
    }
    return;
  }

  log("alp.debugDoctor: ran tan doctor");
  await showJsonDocument(data);
  if (data.summary.fail > 0 || data.summary.warn > 0) {
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

  // Same reason as the support bundle below: this command never reads the
  // written launch.json, so its verdict is about the host, not the file.
  log(
    `alp.debugPreflight: ran preflight for ${targetKind}/${server}, hostReady=${report.canLaunch}`,
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
  // Built by `debugConfigArgs` rather than here, so the argv is pinned by a
  // test instead of by reading (#397). A wrong flag exits 2 and says so; a
  // wrong VALUE — `--core m55_hp` against `--core m55_he` — is a valid command
  // that debugs the wrong core and reports nothing.
  const spec = { targetKind, server, coreId: slice?.core_id ?? null };
  // Read ONCE and passed to both calls below (#340) — `readSvdPath` is the
  // one `alpSdk.svdPath` reader (`./project/vscodeAdapter`), reused rather
  // than opened a second time, and the preview/write pair must see the same
  // value or the preview stops previewing the command that actually runs.
  const svdPath = readSvdPath();

  const preview = await runDebugConfig(
    extensionContext,
    context.workspaceRoot,
    debugConfigArgs(spec, { preview: true, svdPath }),
  );
  if (!preview) return null;

  // Shape accepted — now let the CLI write for real.
  const written = await runDebugConfig(
    extensionContext,
    context.workspaceRoot,
    debugConfigArgs(spec, { svdPath }),
  );
  if (!written) return null;

  // Read the file BACK and grade that, not tan's draft: tan merges, so a value
  // the customer hand-filled survives while `data.configuration` still carries
  // the placeholder (`gradeWrittenLaunchConfig`). Falls back to the draft when
  // the file cannot be read, and says which it did.
  const graded = gradeWrittenLaunchConfig(
    readLaunchJsonDocument(context.workspaceRoot),
    written.configuration,
  );
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
    // The in-process report answers "is the HOST ready" (adapters installed,
    // tool on PATH, artefact built) and NOTHING about the configuration's own
    // values — it no longer drafts any, so it no longer grades any (#339).
    // This fold is the whole configuration verdict, and it is taken against
    // the launch.json entry on disk: `tan debug-config` reports ok for a
    // partly-resolved draft by design, so a zero exit does not mean the file
    // can launch. Without this the user is told the profile is ready and the
    // session dies inside the adapter; with it, a config that IS fully
    // resolved — by tan, or by the customer's own hand before it — adds no
    // check at all and F5 goes straight through. Each unresolved key becomes a
    // check named after that key, so `checks`/`summary`/`nextSteps` name the
    // field — both consumers below build their message from `checks`.
    report: foldLaunchConfigPlaceholders(
      report,
      graded.placeholders,
      graded.source,
    ),
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
      // `interactive: true`: every caller of `runDebugConfig` is a debug
      // command (F5 / "Alp: Configure Debug Profile" / preflight) the user
      // just triggered, so ADR 0021's consent dialog is appropriate here.
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      const result = await runAlpCommand(extensionContext, args, cwd, {
        signal: controller.signal,
        interactive: true,
      });
      return result.outcome;
    },
  );

  if (!outcome.ok) {
    // An older tan exits 2 (validation) on an argument its clap definition
    // does not know, with a message about the FLAG rather than the project —
    // so a `debug-config` exit 2 whose argv carries a flag younger than the
    // customer's binary is version skew, not a bad board.yaml. Both flags this
    // argv can carry are that young: `--core` (the v0.3.1 field report) and
    // `--pre-launch-task`, added by tan-cli#85 and shipped in 0.4.0. Listing
    // only `--core` left the whole native-host/zephyr-mcu class — where
    // `--pre-launch-task` is present and `--core` may not be, because
    // `resolveManifestSlice` finds no slice before the first build — reporting
    // tan's raw complaint with no hint that the CLI is what needs updating.
    const skew =
      outcome.kind === "validation" &&
      (args.includes("--core") || args.includes("--pre-launch-task"))
        ? ` This extension requires tan ${SUPPORTED_CLI_VERSION} or newer; run "Alp: Update CLI" and retry.`
        : "";
    // `--svd` only ever appears when `alpSdk.svdPath` is actually set
    // (`debugConfigArgs` omits it on an empty/whitespace value), so this fires
    // only for someone who configured it. tan-cli#214: an `--svd` naming an
    // unreadable path is a HARD failure of the whole command — no
    // launch.json at all, not even one missing the SVD key — so without this
    // hint the symptom is indistinguishable from "debug is broken" (#340).
    //
    // Narrowed to `outcome.kind === "internal"` (exit 5) — driven against the
    // pinned tan (`internal_failure`/`ExitCode::InternalFailure` in
    // `crates/tan-cli/src/commands/debug_config.rs`), BOTH `--svd` failure
    // modes (empty-after-trim, unreadable file) land there, and it is
    // structurally disjoint from `skew`'s `"validation"` check above — so the
    // two hints can never both fire for the same failure. That disjointness
    // is what makes the wide "any failure while --svd is on the argv" version
    // wrong rather than merely imprecise: a customer on a stale tan with a
    // perfectly good `alpSdk.svdPath` who presses F5 gets exit 2 (`--svd`
    // unrecognised) — `skew` correctly fires ("update tan"), and the WIDE svd
    // hint fired too, offering an Open Settings button for a setting that was
    // never the problem, with the wrong remedy the more actionable-looking
    // one. Narrowing to `internal` suppresses it on that path.
    const svdHint =
      outcome.kind === "internal" && args.includes("--svd")
        ? " If alpSdk.svdPath is set, check that it names a file that exists and is readable — tan refuses to write launch.json at all otherwise."
        : "";
    await notify(
      planFailure({
        operation: "Alp: generating the debug configuration",
        cause: `Alp: the debug configuration could not be generated.${skew}${svdHint}`,
        detail: outcome.message,
        actions: [
          { id: "showOutput" },
          ...(svdHint
            ? [{ id: "openSettings" as const, arg: "alpSdk.svdPath" }]
            : []),
        ],
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
  } else {
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

  // The write above is what CREATES the duplicate on a launch.json older than
  // #387, so this is both the moment it exists and the moment the maintained
  // name is known for free — no `--preview` run needed. Not one-shot: the
  // customer ran this command, so an offer here is an answer, not a nag.
  // Offered after the status toast rather than before it, because the toast
  // describes the report taken BEFORE the repair; reordering them would need
  // the whole preflight recomputed to stay honest.
  await maybeRescueOrphanedLaunchConfig(context, {
    maintainedName: result.configName,
    oneShot: false,
  });
}

/** One offer per WORKSPACE, and only once the customer has said "stop asking".
 *  Not global: the stranded value lives in one project's launch.json, and
 *  declining for that project says nothing about the next one. */
const RESCUE_PROMPT_KEY_PREFIX = "alp.launchConfigRescueOffered";

/**
 * Offer to repair a `launch.json` that holds the same debug configuration
 * twice, once under each of `ALP:` / `Alp:` — see `./debug/service.ts` for what
 * that is, why it strands a customer's hand-filled value, and what bounds this.
 *
 * OFFERS, NEVER APPLIES. It is the customer's file; a silent rewrite of it is
 * not acceptable at any level of confidence, so the write is gated on an
 * `applyChanges` pick coming back from the seam.
 *
 * ACTIVATION, and the configure command as well. The affected customer's
 * symptom is "F5 fails", so they will conclude debugging is broken and will
 * never think to run Configure Debug Profile — waiting to be asked is waiting
 * forever. The counterweight is that activation work is intrusive and this
 * repo is strict about not nagging, so the trigger is deliberately narrow:
 * only when a pair really exists AND a concrete value is really at risk
 * (`findRescuablePairs`), decided offline. A launch.json with no pair never
 * says a word, and never spawns a process to find that out — but it is not one
 * read either: `collectWorkspaceDebugContext()` runs first, which is a
 * `readdirSync` of `~/.alp/sdk` plus a `statSync` per entry, the extension's
 * own settings, a handful of `existsSync`/`readFileSync` probes and three
 * `vscode.extensions.getExtension` calls, and then the launch.json
 * `readFileSync`. All synchronous, all cheap, none of it the CLI.
 *
 * ONCE, BUT ONLY AFTER AN ANSWER. `src/ideHub/setupOrchestrator.ts` already
 * ruled on this shape: an auto-dismissed toast returns undefined and stays
 * unrecorded, so it is retried on the next activation rather than lost for the
 * lifetime of the workspace. The same applies here and harder — an accidental
 * dismissal would strand the value permanently and hand the customer back a
 * broken F5 whose only remaining fix is a command they have never heard of,
 * which is the very argument for triggering on activation at all. So the
 * `Don't show again` button is the ONLY response that records the key.
 * Accepting does not need to: a successful repair removes the pair, and
 * `findRescuablePairs` is then silent on its own — while a repair that failed
 * to land is a state still worth offering.
 *
 * "Activation" means package.json's own `activationEvents`, and that is a real
 * limit, not an oversight: a folder holding nothing but a stranded
 * `.vscode/launch.json` — no `board.yaml`, no `prj*.conf`, no Alp view opened —
 * never activates this extension at all, so the offer never comes. Widening
 * the manifest to `workspaceContains:.vscode/launch.json` would activate the
 * whole extension in almost every VS Code window on the machine to cover a
 * folder that has no Alp project in it. The command path is the answer for
 * that case; alplabai/tan-cli#169 is the real one, since tan needs no
 * activation event.
 *
 * `maintainedName` is the configuration name the CURRENTLY PINNED tan writes —
 * the only thing that says which half of the pair is maintained and which is
 * the orphan, and something this extension cannot know statically. The
 * configure command already has one; otherwise a `--preview` run answers it,
 * and that runs ONLY after the customer has accepted. `--preview` is
 * documented not to touch launch.json, so asking costs them nothing.
 *
 * Never throws: it is `void`-ed from activation, and the toast plus the
 * `workspaceState` write are both pending main-thread RPCs that a closing
 * window rejects with a CancellationError — the same reason
 * `maybeOfferFirstRunWizard` catches.
 */
export async function maybeRescueOrphanedLaunchConfig(
  context: vscode.ExtensionContext,
  options: { maintainedName?: string; oneShot: boolean },
): Promise<void> {
  const workspaceRoot = collectWorkspaceDebugContext().workspaceRoot;
  if (!workspaceRoot) return;
  if (findRescuablePairs(readLaunchJsonDocument(workspaceRoot)).length === 0) {
    return;
  }

  const key = `${RESCUE_PROMPT_KEY_PREFIX}:${workspaceRoot}`;
  if (options.oneShot && context.workspaceState.get<boolean>(key, false)) {
    return;
  }

  try {
    // Spelled out rather than built by `planFailure`: nothing has failed, so
    // the operation-and-cause shape that builder is for would misdescribe it.
    // `applyChanges` is caller-handled (no `run` in the presenter's table) so
    // the pick comes back here and gates the write; `openLaunchJson` IS
    // presenter-run, so "let me look first" opens the file and correctly
    // repairs nothing.
    //
    // The sentence has to be true about the losing case too: where both entries
    // hold a different hand-filled value, one of them does NOT move — the
    // maintained entry's stands, and the success message below names what was
    // dropped.
    const actions: NotifyAction[] = [
      { id: "applyChanges" },
      { id: "openLaunchJson" },
    ];
    // Only the activation offer can nag, so only it needs a way to be told to
    // stop. From the configure command the customer asked the question, and an
    // answer there is an answer, not a nag.
    if (options.oneShot)
      actions.push({ id: "custom", title: "Don't show again" });
    const choice = await notify({
      severity: "warning",
      channel: "toast",
      message:
        "Alp: this project's launch.json holds the same debug configuration " +
        'twice — once as "Alp:" and once as "ALP:". Only one of them is kept ' +
        "up to date, and values you filled in by hand may be sitting on the " +
        "other. Move what is missing onto the maintained one and remove the " +
        "duplicate? Where both entries have a value, the maintained one is " +
        "kept and the other is discarded.",
      actions,
    });
    // The one-shot key is recorded HERE, on an explicit "stop asking", and
    // nowhere else — see the header. A dismissal must come back.
    if (choice === "custom") {
      await context.workspaceState.update(key, true);
      return;
    }
    if (choice !== "applyChanges") return;

    const maintainedName =
      options.maintainedName ??
      (await previewMaintainedConfigName(context, workspaceRoot));
    if (!maintainedName) return;

    // Re-read rather than reuse the document detection parsed. launch.json is
    // very likely OPEN in the editor while the offer sits on screen — the
    // configure command opens it — so the copy read a moment ago may already
    // be stale, and writing it back would revert whatever was typed.
    const rescue = planOrphanRescue(
      readLaunchJsonDocument(workspaceRoot),
      maintainedName,
    );
    if (!rescue) {
      log("alp debug: launch.json no longer has a duplicate to repair");
      return;
    }

    writeLaunchJsonDocument(workspaceRoot, rescue.document);
    for (const pair of rescue.pairs) {
      log(
        `alp debug: removed "${pair.removedName}" from launch.json, keeping ` +
          `"${pair.keptName}"` +
          (pair.movedKeys.length > 0
            ? `, moving across: ${pair.movedKeys.join(", ")}`
            : " (the removed entry held no concrete value of its own)") +
          // A deleted value is never left to be discovered later. The file was
          // overwritten in place with no backup, so the channel is the only
          // record of what the removed entry said.
          (pair.discardedKeys.length > 0
            ? `; the kept entry's own ${pair.discardedKeys.join(", ")} stood, ` +
              `so the removed entry's value for it was discarded, not moved`
            : ""),
      );
    }
    const discarded = [
      ...new Set(rescue.pairs.flatMap((p) => p.discardedKeys)),
    ];
    // A discarded value earns a toast, not the status bar: it is the one
    // outcome where the repair DELETED something the customer may have typed,
    // and a status-bar line that clears itself in five seconds is not a place
    // to report that. `openLaunchJson` so they can go and look.
    await notify(
      discarded.length > 0
        ? {
            severity: "warning",
            channel: "toast",
            message:
              "Alp: repaired the duplicate debug configuration. The removed " +
              `entry's ${discarded.join(", ")} was discarded — the kept entry ` +
              "already had a value of its own, and that is the one F5 uses.",
            actions: [{ id: "openLaunchJson" }],
          }
        : planSuccess("Alp: repaired the duplicate debug configuration."),
    );
  } catch (error) {
    if (isCancellation(error)) {
      log("[debug] launch.json repair abandoned, window closing", "info");
      return;
    }
    log(`[debug] launch.json repair failed: ${String(error)}`, "warn");
  }
}

/** The configuration name the currently pinned tan writes, LEARNED rather than
 *  guessed. The target/server pair asked for is arbitrary — every draft tan
 *  emits carries the same prefix and the prefix is the entire question — so it
 *  asks for the one target class every project has. */
async function previewMaintainedConfigName(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): Promise<string | null> {
  // Through `debugConfigArgs` like `writeLaunchProfile`, not spelled inline:
  // this was the second construction site, byte-identical but uncovered, so a
  // pin bump that renamed the subcommand or added a required flag would move
  // the tested function and leave this one behind. `runDebugConfig` returns
  // null on the resulting exit 2, which here means the rescue silently loses
  // the maintained config name mid-repair.
  //
  // No `svdPath` here on purpose (#340). This preview exists only to learn
  // WHICH prefix the pinned tan writes — an arbitrary target/server pair
  // stands in for the customer's real one — so coupling it to
  // `alpSdk.svdPath` would let an unrelated bad path fail the orphan-rescue
  // offer too, on a run that was never about the customer's own debug
  // session.
  const preview = await runDebugConfig(
    context,
    workspaceRoot,
    debugConfigArgs(
      { targetKind: "zephyr-mcu", server: "jlink", coreId: null },
      { preview: true },
    ),
  );
  return preview?.configuration.name ?? null;
}

/** Log everything behind a "not launchable yet" toast, and return the check
 *  names that toast lists. The toast has room for names only — which is why
 *  `foldLaunchConfigPlaceholders` names each folded check after the launch.json
 *  KEY that is still unresolved, so the sentence reads "resolve: device". The
 *  WHY has to reach the channel it sends the user to (`showOutput()`): each
 *  failing check's `detail`/`fix`. That is the ONLY place the unresolved values
 *  themselves survive — the folded check carries the `<resolved-…>` token in
 *  its detail, and the CLI's own notes only say placeholders exist in general,
 *  never which. */
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

async function exportSupportBundle(
  extensionContext: vscode.ExtensionContext,
): Promise<void> {
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

  // A customer exports this precisely when things are broken, i.e. exactly
  // when `tan` may be unresolvable — so the bundle is still WRITTEN either
  // way. `buildDebugDoctorSection` carries the resolver's own failure verbatim
  // — message AND the raw detail behind it — rather than leaving `doctor`
  // silently absent or reduced to a generic sentence (#376). This is a FILE,
  // not a toast, so the detail (errno / resolver text) belongs in it.
  const {
    data: doctorData,
    message: doctorMessage,
    detail: doctorDetail,
  } = await runDebugDoctor(extensionContext, context.workspaceRoot, {
    interactive: true,
  });
  const doctor = buildDebugDoctorSection(
    doctorData,
    doctorMessage,
    doctorDetail,
  );

  const inspect = createInspectReport(context);
  const bundle = createSupportBundlePayload({
    generatedAt,
    inspect,
    preflight,
    doctor,
    notes: [
      `targetKind=${targetKind}`,
      `server=${server}`,
      // NOT `canLaunch=`. This bundle is what a customer sends after a debug
      // session already died, and nothing here read their launch.json — the
      // report is host readiness only (#339). Labelling an unfolded verdict
      // `canLaunch` would tell the reader the file launches while the session
      // is dying on a placeholder inside it, i.e. send them to the wrong half.
      `hostReady=${preflight.canLaunch}`,
      `configurationGraded=${preflight.configurationGraded}`,
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
    doctor.kind === "unavailable" ||
    doctor.data.summary.fail > 0 ||
    doctor.data.summary.warn > 0
  ) {
    showOutput();
  }
}

async function openDebugTroubleshootingPanel(
  extensionContext: vscode.ExtensionContext,
): Promise<void> {
  const targetKind = await pickTargetKind();
  if (!targetKind) return;
  const server = await pickServer(targetKind);
  const context = collectWorkspaceDebugContext();
  if (!context.workspaceRoot) {
    await notify(
      planPrecondition("noWorkspace", {
        operation: "open the troubleshooting panel",
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

  // Channel-grade text, not a toast — the detail behind `doctorMessage`
  // belongs on this panel too (#376).
  const {
    data: doctorData,
    message: doctorMessage,
    detail: doctorDetail,
  } = await runDebugDoctor(extensionContext, context.workspaceRoot, {
    interactive: true,
  });
  const doctor = buildDebugDoctorSection(
    doctorData,
    doctorMessage,
    doctorDetail,
  );
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
    vscode.commands.registerCommand("alp.debugDoctor", () =>
      debugDoctor(context),
    ),
    vscode.commands.registerCommand("alp.debugPreflight", () =>
      debugPreflight(),
    ),
    vscode.commands.registerCommand("alp.configureDebugProfile", () =>
      configureDebugProfile(context),
    ),
    vscode.commands.registerCommand("alp.debug", () => startDebugging(context)),
    vscode.commands.registerCommand("alp.exportSupportBundle", () =>
      exportSupportBundle(context),
    ),
    vscode.commands.registerCommand("alp.openDebugTroubleshootingPanel", () =>
      openDebugTroubleshootingPanel(context),
    ),
  ];
}
