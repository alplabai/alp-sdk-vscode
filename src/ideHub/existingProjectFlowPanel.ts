// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import {
  emptyAlpIdeState,
  PROTOCOL_VERSION,
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "./messages";
import { openProjectFolder, queryAlpIdeState } from "./vscodeAdapter";
import { buildWebviewHtml } from "./webviewHtml";

const PANEL_VIEW_TYPE = "alp-ide.existing-project-flow";
const PANEL_TITLE = "Alp IDE — Open Project";

export class ExistingProjectFlowPanel {
  private static instance?: ExistingProjectFlowPanel;

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
      "existing-project-flow",
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => void this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    // Re-push state when the workspace changes (e.g. user opened a folder).
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
    );
  }

  static open(context: vscode.ExtensionContext): void {
    if (ExistingProjectFlowPanel.instance) {
      ExistingProjectFlowPanel.instance.panel.reveal(vscode.ViewColumn.One);
    } else {
      ExistingProjectFlowPanel.instance = new ExistingProjectFlowPanel(context);
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

  private async handleMessage(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.refresh();
        break;

      case "openExistingProject":
        await this.openProject();
        break;

      case "runCommand":
        void vscode.commands.executeCommand(msg.command);
        if (msg.command === "alp.bootstrap") {
          const now = new Date().toISOString();
          void this.context.globalState.update("alp.lastBootstrapAt", now);
          setTimeout(() => void this.refresh(), 8000);
        }
        break;

      case "closePanel":
        void vscode.commands.executeCommand("alp.ideHub.focus");
        this.panel.dispose();
        break;

      case "openUrl":
        if (msg.url.startsWith("https://") || msg.url.startsWith("vscode://")) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
    }
  }

  private async openProject(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select Alp project folder",
      openLabel: "Open Project",
    });

    if (!uris || uris.length === 0) {
      return;
    }

    // Open in a new window when a workspace is already open, so the user's
    // current session isn't replaced.
    await openProjectFolder(uris[0]);
  }

  private dispose(): void {
    ExistingProjectFlowPanel.instance = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
