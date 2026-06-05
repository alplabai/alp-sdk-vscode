// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { runAlpCommand, runAlpInTerminal } from "../alpCli/vscodeAdapter";
import {
  type BuildPlanData,
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "./messages";
import { buildWebviewHtml } from "./webviewHtml";

const PANEL_VIEW_TYPE = "alp-ide.buildPlan";
const PANEL_TITLE = "ALP Build Plan";

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

    // Re-request the plan when board.yaml changes under the active workspace.
    const watcher = vscode.workspace.createFileSystemWatcher("**/board.yaml");
    this.disposables.push(
      watcher,
      watcher.onDidChange(() => void this.handleRequestBuildPlan()),
      watcher.onDidCreate(() => void this.handleRequestBuildPlan()),
      watcher.onDidDelete(() => void this.handleRequestBuildPlan()),
    );
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
        break;
      case "materialiseBuildPlan":
        void this.handleMaterialiseBuildPlan();
        break;
      case "runBuild":
        void this.handleRunBuild();
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
    } else {
      const error = envelope?.issues?.[0]?.message ?? outcome.message;
      void vscode.window.showErrorMessage(`Alp: materialise failed — ${error}`);
    }
  }

  private async handleRunBuild(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // Live build in a terminal (streams output, like `alp build`).
    await runAlpInTerminal(this.context, ["build"], { name: "alp build", cwd });
  }

  private dispose(): void {
    BuildPlanPanel.instance = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
