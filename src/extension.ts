// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import {
  checkCliVersion,
  ensureTanCliProvisioned,
  installTanCliGlobally,
  resetResolvedBinary,
  updateAlpCli,
} from "./alpCli/vscodeAdapter";
import { registerBootstrapCommand } from "./bootstrap";
import { registerConfiguratorEditor } from "./configurator/customEditor";
import { registerDebugCommands } from "./debug";
import { DependencyPanel } from "./deps/panel";
import { showHardwareExplorerPanel } from "./hardwareExplorer/panel";
import {
  BuildPlanPanel,
  ExistingProjectFlowPanel,
  NewProjectFlowPanel,
  OverviewPanel,
  registerWorkspaceCommands,
  SetupFlowPanel,
} from "./ideHub";
import { BOOTSTRAP_RUN_NAME } from "./ideHub/messages";
import { maybeOfferSetupPanel } from "./ideHub/setupOrchestrator";
import { registerLoaderCommands } from "./loader";
import { startLanguageServer, stopLanguageServer } from "./lsp/client";
import { registerLspCommands } from "./lsp/commands";
import { planFailure, planSuccess } from "./notify/service";
import { notifyAsync, setExtensionId } from "./notify/vscodeAdapter";
import { registerSelectSdkCommand } from "./sdk/activeSdk";
import { createStatusBar } from "./statusBar";
import {
  disposeTaskTracking,
  log,
  onDidFinishTerminalCommand,
  showOutput,
} from "./util";
import { registerTreeViews } from "./views";
import { StateManager } from "./views/stateManager";
import { registerWestCommands } from "./west";
import {
  maybeOfferFirstRunWizard,
  registerProjectWizardCommand,
} from "./wizard";

/**
 * The version this machine last activated. DIFFERENT = the extension was
 * upgraded since, SAME = an ordinary activation. One key answers both questions
 * for the price of one, which is why there is no separate "has run before"
 * boolean.
 *
 * An ABSENT value is NOT proof of a fresh install — see `PRE_MARKER_STATE_KEYS`.
 */
const LAST_ACTIVATED_VERSION_KEY = "alp.lastActivatedVersion";

/**
 * Keys written by builds that predate `alp.lastActivatedVersion` (it landed in
 * 0.3.7). If the marker is absent but any of these exist, a previous build ran
 * on this machine and this activation is an UPGRADE, not a first install.
 *
 * Without this the whole existing customer base — everyone upgrading from 0.3.6
 * or earlier — is reported as a fresh install on the one activation where
 * knowing it was an upgrade matters most. Observed in a real old->new upgrade:
 * a 0.3.6 profile carrying a downloaded tan CLI logged
 * "v0.3.7 (first activation on this machine)".
 *
 * Only globalState keys belong here; workspaceState says nothing about whether
 * the extension has run on this MACHINE.
 */
const PRE_MARKER_STATE_KEYS = [
  "alp.tanSelfHealGaveUpPin",
  "alp.setupOrchestrator.lastShownFingerprint",
  "alp.lastBootstrapAt",
] as const;

export function activate(context: vscode.ExtensionContext): void {
  // The presenter has no `context` of its own but needs this extension's id for
  // the `openExtensions` default. Hand it over first, before anything can
  // notify — re-typing it there is what mis-cased it as `alplabai.` once.
  setExtensionId(context.extension.id);
  const version =
    (context.extension.packageJSON.version as string | undefined) ?? "unknown";
  // Read BEFORE the write, or every activation looks like an ordinary one.
  const lastActivated = context.globalState.get<string>(
    LAST_ACTIVATED_VERSION_KEY,
  );
  // An absent marker means EITHER a fresh install OR an upgrade from a build
  // that predates the marker; state left by that older build tells the two
  // apart. Getting this wrong misreports every existing customer's first
  // upgrade as a fresh install.
  const ranBefore =
    lastActivated !== undefined ||
    PRE_MARKER_STATE_KEYS.some(
      (key) => context.globalState.get(key) !== undefined,
    );
  const extensionUpgraded = ranBefore && lastActivated !== version;
  void context.globalState.update(LAST_ACTIVATED_VERSION_KEY, version);
  log(
    `Alp SDK extension activating — v${version}` +
      (!ranBefore
        ? " (first activation on this machine)"
        : lastActivated === undefined
          ? " (upgraded from a build older than v0.3.7)"
          : extensionUpgraded
            ? ` (upgraded from v${lastActivated})`
            : ""),
  );
  startLanguageServer(context);

  // One shared state source for both the native trees and the status bar, so
  // the Build & Flash tree and the status-bar Build/Flash gating never disagree.
  const stateMgr = new StateManager(context);
  const refreshState = () =>
    void stateMgr.refresh(
      context.globalState.get<string>("alp.lastBootstrapAt") ?? null,
    );

  context.subscriptions.push(
    stateMgr,
    // Reactivity (no window reload): re-derive shared state on alpSdk config
    // edits (SDK activate/deactivate via alpSdk.path) and when the window
    // regains focus (e.g. after running bootstrap/install in a terminal). A
    // cliPath or preferGlobalCli edit also resets the cached CLI-binary
    // resolution (and re-arms the one-shot version check, see
    // resetResolvedBinary), so repointing config mid-session re-checks the
    // newly-resolved binary right away.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("alpSdk.cliPath") ||
        e.affectsConfiguration("alpSdk.preferGlobalCli")
      ) {
        resetResolvedBinary();
        // Re-run the one-shot version check against the newly-resolved binary:
        // resetResolvedBinary re-arms it, but nothing else re-invokes it, so
        // without this a mid-session cliPath/preferGlobalCli edit wouldn't
        // re-warn until a window reload.
        void checkCliVersion(context);
      }
      if (e.affectsConfiguration("alpSdk")) refreshState();
    }),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) refreshState();
    }),
    // The verdict for EVERY `runInTerminal` run — bootstrap, `west build`,
    // `west flash`, "Install tan" — in one place (#332). It used to be raised
    // inside `util.ts`'s finish handler, where the failure toast said only
    // `<name> failed (exit 1)`: an exit number the customer can't act on and
    // no button but "Show Output". The exit code is detail now (channel only)
    // and the toast carries the two things that actually help — the terminal
    // that holds the real error, and the doctor.
    //
    // An undefined `code` stays SILENT: the task ended without its process
    // ever starting, so there is no verdict to report and claiming either
    // outcome would be a guess.
    // A bootstrap STARTING changes readiness as much as one finishing, and
    // nothing else notices: `tan bootstrap` writes no board.yaml and no
    // setting, so neither the file watcher nor the config listener fires.
    // Without this the snapshot carries `bootstrapRunning: false` for the
    // whole run and every gate that reads it — the status bar, the Build &
    // Flash items — stays open over a half-fetched module tree. Filtered to
    // the bootstrap run (`run` is the contributed `alpRun` task property, see
    // package.json) so a user's own tasks don't each trigger a probe sweep.
    vscode.tasks.onDidStartTask((e) => {
      const def = e.execution.task.definition as { run?: unknown };
      if (def.run === BOOTSTRAP_RUN_NAME) refreshState();
    }),
    onDidFinishTerminalCommand(({ name, code }) => {
      // Re-derive the shared state FIRST, whatever the verdict: a finished
      // bootstrap changed the workspace on disk and released the run's
      // reservation, and this event is the only signal of either. Repainting
      // the old snapshot instead is what made a SUCCESSFUL bootstrap flip the
      // bar to "$(warning) Alp: setup" — a warning at the moment of success.
      refreshState();
      if (code === 0) {
        notifyAsync(planSuccess(`${name} finished.`));
      } else if (code !== undefined) {
        notifyAsync(
          planFailure({
            operation: name,
            cause: `${name} failed.`,
            detail: `exit ${code}`,
            actions: [{ id: "showTerminal", arg: name }, { id: "runDoctor" }],
          }),
        );
      }
    }),
    ...registerLoaderCommands(context),
    ...registerWestCommands(context),
    ...registerBootstrapCommand(context),
    createStatusBar(stateMgr),
    registerSelectSdkCommand(),
    ...registerConfiguratorEditor(context),
    vscode.commands.registerCommand("alp.openDependencies", () =>
      DependencyPanel.open(context, stateMgr),
    ),
    // The Toolchain Doctor panel is gone — this id opens the dependency panel
    // that replaced it. Kept (not removed) because the notify seam's `runDoctor`
    // action, the walkthrough, the webview allowlist and every shipped
    // keybinding execute it by name; retiring the id would turn all of those
    // into dead buttons.
    //
    // The deleted registration's `noWorkspace` precondition did not go with
    // it: with no folder open `buildDependencyReport` refuses to spawn and the
    // panel says to open one (src/deps/vscodeAdapter.ts). The guard moved to
    // where the spawn is, so `alp.openDependencies` — reachable from the
    // Activity Bar on a fresh install — is covered by the same check (#371).
    vscode.commands.registerCommand("alp.toolchainDoctor", () =>
      DependencyPanel.open(context, stateMgr),
    ),
    registerProjectWizardCommand(),
    ...registerLspCommands(),
    ...registerDebugCommands(context),
    ...registerTreeViews(context, stateMgr),
    ...registerWorkspaceCommands(),
    vscode.commands.registerCommand("alp.openSetupFlow", () =>
      SetupFlowPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.openHub", () =>
      OverviewPanel.open(context),
    ),
    // Deprecated alias — keeps old keybindings/links/muscle-memory working.
    vscode.commands.registerCommand("alp.openOverview", () =>
      OverviewPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.newProjectWizard", () =>
      NewProjectFlowPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.openExistingProject", () =>
      ExistingProjectFlowPanel.open(context),
    ),
    // SDK Manager is now a section of the Hub; open the Hub focused on it.
    vscode.commands.registerCommand("alp.openSdkManager", () =>
      OverviewPanel.open(context, "sdk"),
    ),
    // `context.extension.id` is the authoritative `<publisher>.<name>` VS Code
    // itself registered this extension under, so the settings filter and the
    // walkthrough id below cannot drift from package.json's `"publisher":
    // "AlpLabAI"` — the hardcoded lower-case spellings they replace did not
    // match it, and the walkthrough one silently opened nothing.
    // `test/setupOrchestrator.service.test.js` fails if either is re-typed.
    vscode.commands.registerCommand("alp.openSettings", () =>
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        `@ext:${context.extension.id}`,
      ),
    ),
    vscode.commands.registerCommand("alp.openHardwareExplorer", () =>
      showHardwareExplorerPanel(context),
    ),
    vscode.commands.registerCommand("alp.showBuildPlan", () =>
      BuildPlanPanel.open(context),
    ),
    vscode.commands.registerCommand("alp.openGettingStarted", () =>
      vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        `${context.extension.id}#alpGettingStarted`,
        false,
      ),
    ),
    vscode.commands.registerCommand("alp.showOutput", () => showOutput()),
    vscode.commands.registerCommand("alp.updateCli", () =>
      updateAlpCli(context),
    ),
    vscode.commands.registerCommand("alp.installTanCli", () =>
      installTanCliGlobally(context),
    ),
  );

  void maybeOfferFirstRunWizard(context);
  // No upgrade flag: the drift check's stored tool-version fingerprint carries
  // its own format tag, so an incomparable stored value is recognised from the
  // value itself (see setupOrchestrator.planToolDrift). Passing the flag here
  // silenced a genuine tool move whenever VS Code auto-updated the extension in
  // the same activation — which is the common case, not the rare one.
  void maybeOfferSetupPanel(context);
  // Provision the managed `tan` CLI up front so a fresh install fetches it once,
  // streamlined (progress notification), instead of stalling on the first
  // build/validate command. No-op when a binary already resolves. The version
  // check runs after so it sees the just-provisioned binary.
  void ensureTanCliProvisioned(context).finally(() => {
    // Warn once if the resolved tan CLI is older than this build expects (the
    // silent cause of missing features like project examples).
    void checkCliVersion(context);
  });
}

export async function deactivate(): Promise<void> {
  disposeTaskTracking();
  await stopLanguageServer();
}
