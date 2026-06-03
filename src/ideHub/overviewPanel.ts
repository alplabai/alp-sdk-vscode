// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import {
  emptyAlpIdeState,
  PROTOCOL_VERSION,
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "./messages";
import { queryAlpIdeState } from "./vscodeAdapter";
import { buildWebviewHtml } from "./webviewHtml";

const PANEL_VIEW_TYPE = "alp-ide.overview";
const PANEL_TITLE = "ALP IDE Overview";

export class OverviewPanel {
  private static instance?: OverviewPanel;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      PANEL_TITLE,
      vscode.ViewColumn.One,
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
      "overview",
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    // Refresh on workspace changes.
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
    );

    // Refresh when board.yaml appears or changes.
    const watcher = vscode.workspace.createFileSystemWatcher("**/board.yaml");
    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => void this.refresh()),
      watcher.onDidChange(() => void this.refresh()),
      watcher.onDidDelete(() => void this.refresh()),
    );
  }

  /** Open (or reveal) the overview panel. */
  static open(context: vscode.ExtensionContext): void {
    if (OverviewPanel.instance) {
      OverviewPanel.instance.panel.reveal(vscode.ViewColumn.One);
    } else {
      OverviewPanel.instance = new OverviewPanel(context);
    }
  }

  async refresh(): Promise<void> {
    const lastBootstrapAt =
      this.context.globalState.get<string>("alp.lastBootstrapAt") ?? null;
    const state = await queryAlpIdeState(lastBootstrapAt).catch(() =>
      emptyAlpIdeState(),
    );
    const msg: ExtToWebviewMessage = {
      type: "stateUpdate",
      _v: PROTOCOL_VERSION,
      state,
    };
    void this.panel.webview.postMessage(msg);
  }

  private handleMessage(msg: WebviewToExtMessage): void {
    switch (msg.type) {
      case "ready":
        void this.refresh();
        break;
      case "runCommand":
        void vscode.commands.executeCommand(msg.command);
        if (msg.command === "alp.installDependencies") {
          const now = new Date().toISOString();
          void this.context.globalState.update("alp.lastBootstrapAt", now);
          setTimeout(() => void this.refresh(), 8000);
        } else {
          setTimeout(() => void this.refresh(), 1200);
        }
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

  private dispose(): void {
    OverviewPanel.instance = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
