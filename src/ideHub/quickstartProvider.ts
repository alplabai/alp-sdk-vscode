// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import type { StateManager } from "../views/stateManager";
import {
  PROTOCOL_VERSION,
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "./messages";
import { derivePhase } from "./phase";
import { buildWebviewHtml, runWebviewCommand } from "./webviewHtml";

const VIEW_TYPE = "alp-ide.quickstart";

/**
 * Docked sidebar webview for the Quickstart ladder (Environment / Project /
 * Board / Build & Flash). Thin orchestration only — state comes from the
 * shared `StateManager`, CTAs route through the allowlisted
 * `runWebviewCommand`; no domain logic lives here.
 */
export class QuickstartViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = VIEW_TYPE;

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly stateMgr: StateManager,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
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

    webviewView.webview.html = buildWebviewHtml(
      webviewView.webview,
      this.context.extensionUri,
      "quickstart",
    );

    const disposables: vscode.Disposable[] = [];

    webviewView.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.handleMessage(msg),
      undefined,
      disposables,
    );

    disposables.push(
      this.stateMgr.onStateChange(() => void this.postState()),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) void this.postState();
      }),
    );

    webviewView.onDidDispose(() => {
      for (const d of disposables) d.dispose();
      if (this.view === webviewView) this.view = undefined;
    });
  }

  private async postState(): Promise<void> {
    if (!this.view) return;
    const msg: ExtToWebviewMessage = {
      type: "stateUpdate",
      _v: PROTOCOL_VERSION,
      state: this.stateMgr.state,
    };
    void this.view.webview.postMessage(msg);
  }

  private handleMessage(msg: WebviewToExtMessage): void {
    switch (msg.type) {
      case "ready":
        void this.postState();
        break;
      case "runCommand":
        // Re-check readiness host-side: the ladder only shows Build/Flash CTAs
        // when the phase is "ready", but the webview is untrusted, so the host
        // is the authority on whether a build action may actually fire.
        runWebviewCommand(
          msg.command,
          derivePhase(this.stateMgr.state) === "ready",
        );
        if (msg.command === "alp.installDependencies") {
          const now = new Date().toISOString();
          void this.context.globalState.update("alp.lastBootstrapAt", now);
          setTimeout(() => void this.stateMgr.refresh(now), 8000);
        } else {
          const lastBootstrapAt =
            this.context.globalState.get<string>("alp.lastBootstrapAt") ?? null;
          setTimeout(() => void this.stateMgr.refresh(lastBootstrapAt), 1200);
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

/** Register the Quickstart sidebar view; returns disposable(s) for
 *  `context.subscriptions`. */
export function registerQuickstart(
  context: vscode.ExtensionContext,
  stateMgr: StateManager,
): vscode.Disposable[] {
  const provider = new QuickstartViewProvider(context, stateMgr);
  return [
    vscode.window.registerWebviewViewProvider(
      QuickstartViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  ];
}
