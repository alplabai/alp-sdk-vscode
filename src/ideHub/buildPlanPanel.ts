// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { runAlpCommand, runAlpStreamed } from "../alpCli/vscodeAdapter";
import {
  type BuildPlanData,
  type ExtToWebviewMessage,
  type SizeReport,
  type SystemManifest,
  type WebviewToExtMessage,
} from "./messages";
import { buildWebviewHtml } from "./webviewHtml";
import {
  BUILD_RUN_NAME,
  FLASH_RUN_NAME,
  isStreamedRunActive,
  releaseStreamedRun,
  reserveStreamedRun,
} from "../util";
import { planCliOutcome, planFailure, planSuccess } from "../notify/service";
import { notifyAsync } from "../notify/vscodeAdapter";

const PANEL_VIEW_TYPE = "alp-ide.buildPlan";
const PANEL_TITLE = "Alp Build Plan";

/**
 * Full-tab preview of the SDK-emitted build plan (`alp build --plan`, ADR 0014).
 *
 * A webview is justified here — the plan is a genuinely visual surface (per-core
 * slices, generated config artefacts, warnings). It is the live home for the
 * build-plan view; the actions (materialise / build) are delegated to the CLI.
 */
export class BuildPlanPanel {
  private static instance?: BuildPlanPanel;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      PANEL_TITLE,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(
            context.extensionUri,
            "packages",
            "alp-webview",
            "dist",
          ),
        ],
      },
    );

    this.panel.webview.html = buildWebviewHtml(
      this.panel.webview,
      context.extensionUri,
      "build-plan",
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    // Re-request the plan + manifest when board.yaml or the emitted manifest
    // changes under the active workspace (a build refreshes the manifest).
    const refresh = () => {
      void this.handleRequestBuildPlan();
      void this.handleRequestSystemManifest();
      void this.handleRequestSliceSizes();
    };
    for (const glob of ["**/board.yaml", "**/system-manifest.yaml"]) {
      const watcher = vscode.workspace.createFileSystemWatcher(glob);
      this.disposables.push(
        watcher,
        watcher.onDidChange(refresh),
        watcher.onDidCreate(refresh),
        watcher.onDidDelete(refresh),
      );
    }
  }

  /** Open (or reveal) the build-plan panel. */
  static open(context: vscode.ExtensionContext): void {
    if (BuildPlanPanel.instance) {
      BuildPlanPanel.instance.panel.reveal(vscode.ViewColumn.Active);
    } else {
      BuildPlanPanel.instance = new BuildPlanPanel(context);
    }
  }

  private handleMessage(msg: WebviewToExtMessage): void {
    switch (msg.type) {
      // The view auto-requests the plan on mount, so `ready` needs no push.
      case "ready":
        break;
      case "requestBuildPlan":
        void this.handleRequestBuildPlan();
        void this.handleRequestSystemManifest();
        void this.handleRequestSliceSizes();
        break;
      case "materialiseBuildPlan":
        void this.handleMaterialiseBuildPlan();
        break;
      case "runBuild":
        void this.handleRunBuild();
        break;
      case "flashSlice":
        this.handleSliceCommand(msg.coreId);
        break;
      case "openUrl":
        if (msg.url.startsWith("https://") || msg.url.startsWith("vscode://")) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
      case "closePanel":
        this.panel.dispose();
        break;
    }
  }

  private async handleRequestBuildPlan(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // Consume the SDK build plan via the CLI envelope (`alp build --plan`).
    const { outcome } = await runAlpCommand(
      this.context,
      ["build", "--plan"],
      cwd,
    );
    const envelope = outcome.envelope;
    let msg: ExtToWebviewMessage;
    if (envelope && envelope.ok) {
      msg = { type: "buildPlanData", plan: envelope.data as BuildPlanData };
    } else {
      // Surface the first issue (e.g. "no SDK / awaiting a tagged release")
      // or the runtime message so the view can explain the empty state.
      const error = envelope?.issues?.[0]?.message ?? outcome.message;
      msg = { type: "buildPlanData", plan: null, error };
    }
    void this.panel.webview.postMessage(msg);
  }

  /** Fetch the system manifest — the post-build IDE/tool contract. Prefers the
   *  populated `build/system-manifest.yaml` (`--manifest-from`) when a build has
   *  written one; otherwise asks the SDK for the pre-build projection
   *  (`--manifest`). Posts a `systemManifestData` message either way. */
  private async handleRequestSystemManifest(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const built = cwd
      ? path.join(cwd, "build", "system-manifest.yaml")
      : undefined;
    const postBuild = Boolean(built && fs.existsSync(built));
    const args = postBuild
      ? ["build", "--manifest-from", built as string]
      : ["build", "--manifest"];

    const { outcome } = await runAlpCommand(this.context, args, cwd);
    const envelope = outcome.envelope;
    let msg: ExtToWebviewMessage;
    if (envelope && envelope.ok) {
      msg = {
        type: "systemManifestData",
        manifest: envelope.data as SystemManifest,
        postBuild,
      };
    } else {
      const error = envelope?.issues?.[0]?.message ?? outcome.message;
      msg = { type: "systemManifestData", manifest: null, postBuild, error };
    }
    void this.panel.webview.postMessage(msg);
  }

  /** Fetch per-slice firmware footprint vs the SoM memory budget from
   *  `tan size --format json` (#359, the memory half of #331).
   *
   *  Post-build only. `tan size` measures the ELF each slice produced, so with
   *  no `build/system-manifest.yaml` every row would read `not-built` — a
   *  subprocess per refresh to render nothing. Posts `report: null` in that
   *  case so the view clears any stale numbers from a previous build.
   *
   *  Never passes `--fail-over-budget`: that flag makes `tan size` exit
   *  non-zero, and this panel reports a footprint, it does not fail anything.
   *  A missing size tool is not an error either — tan falls back to reading
   *  ELF section headers and still returns rows. */
  private async handleRequestSliceSizes(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const built = cwd
      ? path.join(cwd, "build", "system-manifest.yaml")
      : undefined;
    if (!built || !fs.existsSync(built)) {
      void this.panel.webview.postMessage({
        type: "sliceSizesData",
        report: null,
      } satisfies ExtToWebviewMessage);
      return;
    }

    const { outcome } = await runAlpCommand(this.context, ["size"], cwd);
    const envelope = outcome.envelope;
    const msg: ExtToWebviewMessage =
      envelope && envelope.ok
        ? { type: "sliceSizesData", report: envelope.data as SizeReport }
        : {
            type: "sliceSizesData",
            report: null,
            error: envelope?.issues?.[0]?.message ?? outcome.message,
          };
    void this.panel.webview.postMessage(msg);
  }

  private async handleMaterialiseBuildPlan(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // Envelope mode, but it WRITES into the build tree, so it takes the build
    // reservation like a build does — materialising underneath a running build
    // rewrites the very files that build is consuming.
    if (!reserveStreamedRun(BUILD_RUN_NAME)) {
      notifyAsync(
        planFailure({
          severity: "warning",
          operation: "Materialising the build plan",
          cause: `"${BUILD_RUN_NAME}" is still running.`,
          detail: "Wait for it to finish before materialising the plan.",
          actions: [
            isStreamedRunActive(BUILD_RUN_NAME)
              ? { id: "showOutput" }
              : { id: "showTerminal", arg: BUILD_RUN_NAME },
          ],
        }),
      );
      return;
    }
    try {
      const { outcome } = await runAlpCommand(
        this.context,
        ["build", "--materialise"],
        cwd,
      );
      const envelope = outcome.envelope;
      if (envelope && envelope.ok) {
        const written = (envelope.data as { written?: string[] }).written ?? [];
        // Status bar, not a toast: the very next line re-requests the plan, so
        // the panel the user is looking at already reports the new on-disk
        // state.
        notifyAsync(
          planSuccess(
            `Materialised ${written.length} file(s) under the build tree.`,
          ),
        );
        // The plan view reflects on-disk state — re-request so it isn't stale.
        await this.handleRequestBuildPlan();
      } else {
        // Severity comes from the outcome: the most common materialise failure
        // is a board.yaml validation error (exit 2 ⇒ warning), which must not
        // read like the write failure that exits 3.
        notifyAsync(
          planCliOutcome(outcome, {
            operation: "Materialising the build plan",
          }),
        );
      }
    } finally {
      releaseStreamedRun(BUILD_RUN_NAME);
    }
  }

  private async handleRunBuild(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // Stream to the "Alp SDK" channel (persistent), not a terminal that dies on
    // exit — same reason as the Build/Flash orchestrator commands (util.ts).
    await runAlpStreamed(this.context, ["build"], {
      name: BUILD_RUN_NAME,
      cwd,
    });
  }

  /** Flash a single manifest slice — `tan flash --core <id>`. The view only
   *  shows the button when the manifest says the slice supports it. Streams to
   *  the "Alp SDK" channel (persistent) instead of a terminal that dies on exit:
   *  a `tan flash --core` that fails (e.g. `west` not on PATH) otherwise left
   *  only "failed to launch (exit 1)" with the real reason gone.
   *  There is no per-slice build equivalent: `tan build` has no `--core`
   *  option (only `flash`/`run` do), so the Build button only runs the whole
   *  plan (`runBuild`). */
  private handleSliceCommand(coreId: string): void {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // FLASH_RUN_NAME, not a per-core name: a second core is a second write to
    // the same board, so per-core names would be two reservations and two
    // programmers at once. The core is in the logged command line.
    void runAlpStreamed(this.context, ["flash", "--core", coreId], {
      name: FLASH_RUN_NAME,
      cwd,
    });
  }

  private dispose(): void {
    BuildPlanPanel.instance = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
