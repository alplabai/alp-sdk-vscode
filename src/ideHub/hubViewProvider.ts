// SPDX-License-Identifier: Apache-2.0
//
// The Alp IDE side panel as a single webview (mode "sidebar-hub"): the same
// Setup / Workspace / Project / SDK / Build & Flash information the native trees
// showed, rendered with the Alp design system. Self-refreshing — it pulls state
// via `queryAlpIdeState` on the same signals OverviewPanel watches (board.yaml,
// workspace/config changes, window focus after a bootstrap terminal). CTAs route
// through the allowlisted `runWebviewCommand`; no domain logic lives here.

import * as vscode from "vscode";
import {
  emptyAlpIdeState,
  PROTOCOL_VERSION,
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "./messages";
import { queryAlpIdeState } from "./vscodeAdapter";
import { buildWebviewHtml, runWebviewCommand } from "./webviewHtml";

export class HubViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "alp-ide.hub";

  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/board.yaml");
    this.context.subscriptions.push(
      watcher,
      watcher.onDidCreate(() => void this.refresh()),
      watcher.onDidChange(() => void this.refresh()),
      watcher.onDidDelete(() => void this.refresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("alpSdk")) void this.refresh();
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused && this.view?.visible) void this.refresh();
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(
          this.context.extensionUri,
          "packages",
          "alp-webview",
          "dist",
        ),
      ],
    };
    view.webview.html = buildWebviewHtml(
      view.webview,
      this.context.extensionUri,
      "sidebar-hub",
    );
    view.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.handleMessage(msg),
      undefined,
      this.context.subscriptions,
    );
    view.onDidChangeVisibility(
      () => {
        if (view.visible) void this.refresh();
      },
      undefined,
      this.context.subscriptions,
    );
  }

  /** Re-query state and push it to the hub, if the view is live. */
  async refresh(): Promise<void> {
    if (!this.view) return;
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
    void this.view.webview.postMessage(msg);
  }

  private handleMessage(msg: WebviewToExtMessage): void {
    switch (msg.type) {
      case "ready":
        void this.refresh();
        break;
      case "runCommand":
        runWebviewCommand(msg.command);
        // Bootstrap runs in a terminal we can't await; stamp the time and give
        // it a beat before re-querying so the status flips once it lands.
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
      default:
        break;
    }
  }
}
