// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import {
  emptyAlpIdeState,
  PROTOCOL_VERSION,
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "./messages";
import { createSdkMessageHandler } from "./sdkManagerMessages";
import { queryAlpIdeState } from "./vscodeAdapter";
import { buildWebviewHtml, runWebviewCommand } from "./webviewHtml";

const PANEL_VIEW_TYPE = "alp-ide.sdk-manager";
const PANEL_TITLE = "Alp IDE — SDK Manager";

export class SdkManagerPanel {
  private static instance?: SdkManagerPanel;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sdkHandler: (msg: WebviewToExtMessage) => boolean;

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
      "sdk-manager",
    );

    this.sdkHandler = createSdkMessageHandler({
      context,
      post: (m) => void this.panel.webview.postMessage(m),
      refresh: () => this.refresh(),
    });

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    // Reactivity (no reload): refresh on alpSdk config edits (activate/deactivate
    // sets alpSdk.path) and when this panel becomes the active tab, so the SDK
    // list reflects the current state without reopening.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("alpSdk")) void this.refresh();
      }),
      this.panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) void this.refresh();
      }),
    );
  }

  static open(context: vscode.ExtensionContext): void {
    if (SdkManagerPanel.instance) {
      SdkManagerPanel.instance.panel.reveal(vscode.ViewColumn.One);
    } else {
      SdkManagerPanel.instance = new SdkManagerPanel(context);
    }
  }

  private async refresh(): Promise<void> {
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
    void this.panel.webview.postMessage(msg);
  }

  private handleMessage(msg: WebviewToExtMessage): void {
    if (this.sdkHandler(msg)) return;
    switch (msg.type) {
      case "ready":
        void this.refresh();
        break;
      case "runCommand":
        runWebviewCommand(msg.command);
        break;
      case "openUrl":
        if (msg.url.startsWith("https://") || msg.url.startsWith("vscode://")) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
    }
  }

  private dispose(): void {
    SdkManagerPanel.instance = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }
}
