// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { runAlpCommand, runAlpStreamed } from "../alpCli/vscodeAdapter";
import {
  type BuildPlanData,
  type ExtToWebviewMessage,
  type SystemManifest,
  type WebviewToExtMessage,
} from "./messages";
import { buildWebviewHtml } from "./webviewHtml";
import { reportError } from "../util";

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

  private async handleMaterialiseBuildPlan(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const { outcome } = await runAlpCommand(
      this.context,
      ["build", "--materialise"],
      cwd,
    );
    const envelope = outcome.envelope;
    if (envelope && envelope.ok) {
      const written = (envelope.data as { written?: string[] }).written ?? [];
      void vscode.window.showInformationMessage(
        `Alp: materialised ${written.length} file(s) under the build tree.`,
      );
      // The plan view reflects on-disk state — re-request so it isn't stale.
      await this.handleRequestBuildPlan();
    } else {
      const error = envelope?.issues?.[0]?.message ?? outcome.message;
      void reportError(`Alp: materialise failed — ${error}`);
    }
  }

  private async handleRunBuild(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // Stream to the "Alp SDK" channel (persistent), not a terminal that dies on
    // exit — same reason as the Build/Flash orchestrator commands (util.ts).
    await runAlpStreamed(this.context, ["build"], { name: "Alp Build", cwd });
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
    void runAlpStreamed(this.context, ["flash", "--core", coreId], {
      name: `Alp Flash · ${coreId}`,
      cwd,
    });
  }

  private dispose(): void {
    BuildPlanPanel.instance = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
