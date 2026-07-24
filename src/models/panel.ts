// SPDX-License-Identifier: Apache-2.0
//
// Models panel — full-tab preview of `tan model list` + `tan model doctor`,
// with a build action (`tan model build [--model <name>]`). Mirrors
// hardwareExplorer/panel.ts's singleton webview-panel shape. Every model op
// here is a runAlpCommand(["model", ...]) shell — no model/build logic lives
// in this file, only envelope shaping + progress plumbing.

import * as vscode from "vscode";
import { runAlpCommand } from "../alpCli/vscodeAdapter";
import {
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "../ideHub/messages";
import { buildWebviewHtml } from "../ideHub/webviewHtml";
import { log as logChannel, reportError } from "../util";
import { cliFailureMessage, toModelFitData, toModelsData } from "./service";

const PANEL_VIEW_TYPE = "alpModels";
const PANEL_TITLE = "Alp Models";

// A real NPU compile (vela/dxcom/drpai) can run well past the 60s default
// envelope timeout (spawnAlpAsync's ALP_SPAWN_TIMEOUT_MS) — killing it there
// would falsely report "Build failed" and orphan the in-progress compile.
const MODEL_BUILD_TIMEOUT_MS = 30 * 60 * 1000;

// Pure envelope shaping (`toModelsData`) lives in ./service.ts — no `vscode`
// there, so it's unit-testable directly (test/models.service.test.js) without
// this file's vscode dependency in the require chain.

class ModelsPanel {
  private static current: ModelsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext): ModelsPanel {
    if (ModelsPanel.current) {
      ModelsPanel.current.panel.reveal(vscode.ViewColumn.Active);
      void ModelsPanel.current.refresh();
      return ModelsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
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
    ModelsPanel.current = new ModelsPanel(panel, context);
    return ModelsPanel.current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel = panel;
    this.panel.webview.html = buildWebviewHtml(
      this.panel.webview,
      context.extensionUri,
      "models",
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.onMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private post(msg: ExtToWebviewMessage): void {
    void this.panel.webview.postMessage(msg);
  }

  private async refresh(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const [list, doctor] = await Promise.all([
      runAlpCommand(this.context, ["model", "list"], cwd),
      runAlpCommand(this.context, ["model", "doctor"], cwd),
    ]);
    this.post(toModelsData(list.outcome, doctor.outcome));
    void this.checkFit();
  }

  /** Run the static fit check on every board.yaml model
   *  (`tan model check --board board.yaml`) and post the per-model verdicts.
   *  Thin: all fit logic lives in `tan`/alp-sdk; this only shells + shapes. */
  private async checkFit(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const { outcome } = await runAlpCommand(
      this.context,
      ["model", "check", "--board", "board.yaml"],
      cwd,
    );
    this.post(toModelFitData(outcome));
  }

  private onMessage(msg: WebviewToExtMessage): void {
    switch (msg.type) {
      case "ready":
      case "requestModels":
        void this.refresh();
        break;
      case "buildModel":
        void this.buildModel(msg.name);
        break;
      case "checkModelFit":
        void this.checkFit();
        break;
      case "closePanel":
        this.panel.dispose();
        break;
      case "openUrl":
        if (msg.url.startsWith("https://") || msg.url.startsWith("vscode://")) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
    }
  }

  /** Build one model, or all models when `name` is omitted. Streams progress
   *  (mirrors sdkManagerMessages.ts's install-progress tee) then re-refreshes
   *  so the list/doctor state reflects the just-built artifact. */
  async buildModel(name?: string): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const args = name
      ? ["model", "build", "--model", name]
      : ["model", "build"];

    const sendProgress = (
      log: string,
      done: boolean,
      success?: boolean,
    ): void => {
      logChannel(`[model-build] ${log}`);
      this.post({ type: "modelBuildProgress", log, done, success });
    };

    sendProgress(
      name ? `Building model ${name}…` : "Building all models…",
      false,
    );

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: name ? `Alp: Building model ${name}` : "Alp: Building models",
        cancellable: false,
      },
      async () => {
        const { outcome } = await runAlpCommand(this.context, args, cwd, {
          timeoutMs: MODEL_BUILD_TIMEOUT_MS,
        });
        const envelope = outcome.envelope;
        if (envelope && envelope.ok) {
          sendProgress("Build complete.", true, true);
        } else {
          const error = cliFailureMessage(outcome);
          sendProgress(`Build failed: ${error}`, true, false);
          void reportError(`Alp: model build failed — ${error}`);
        }
        await this.refresh();
      },
    );
  }

  private dispose(): void {
    ModelsPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

/** Open (or reveal + refresh) the Models panel. */
export function showModelsPanel(context: vscode.ExtensionContext): void {
  ModelsPanel.show(context);
}

/** Open the Models panel, then immediately kick off a build-all — the
 *  `alp.buildModel` command palette entry (per-model builds happen from the
 *  panel's own build button, which posts `buildModel` with a `name`). */
export function triggerModelBuild(context: vscode.ExtensionContext): void {
  const panel = ModelsPanel.show(context);
  void panel.buildModel();
}
