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
import {
  buildWebviewHtml,
  isBootstrapCommand,
  runWebviewCommand,
} from "./webviewHtml";
import { onDidFinishTerminalCommand } from "../util";

export class HubViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "alp-ide.hub";

  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {
    // board.yaml + workspace-folder changes are driven in via `registerTreeViews`
    // (views/index.ts doRefresh -> hub.refresh()), so the hub only subscribes to
    // the signals that path does NOT cover: an alpSdk config edit (SDK
    // activate/install) and regaining window focus (e.g. back from a bootstrap
    // terminal). This avoids a double refresh per board.yaml change.
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("alpSdk")) void this.refresh();
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused && this.view?.visible) void this.refresh();
      }),
      // The real completion signal for a terminal-backed CTA (bootstrap, a west
      // build/flash): refresh when that terminal closes. See util.ts.
      onDidFinishTerminalCommand(() => void this.refresh()),
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
    const state = await queryAlpIdeState(lastBootstrapAt, this.context).catch(
      () => emptyAlpIdeState(),
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
        // A CTA that changes status runs in a terminal; the standing
        // onDidFinishTerminalCommand subscription refreshes when it closes.
        // Only stamp the bootstrap time here so that post-close refresh reads it.
        if (isBootstrapCommand(msg.command)) {
          void this.context.globalState.update(
            "alp.lastBootstrapAt",
            new Date().toISOString(),
          );
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
