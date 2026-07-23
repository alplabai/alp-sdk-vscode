// SPDX-License-Identifier: Apache-2.0

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

const PANEL_VIEW_TYPE = "alp-ide.setup-flow";
const PANEL_TITLE = "Alp IDE Setup";

export class SetupFlowPanel {
  private static instance?: SetupFlowPanel;

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
      "setup-flow",
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    // Auto-refresh when workspace folders change, and when a terminal-backed
    // CTA (bootstrap) finishes — the real signal, not a blind delay. util.ts.
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
      onDidFinishTerminalCommand(() => void this.refresh()),
    );

    // Auto-refresh when board.yaml appears or changes.
    const watcher = vscode.workspace.createFileSystemWatcher("**/board.yaml");
    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => void this.refresh()),
      watcher.onDidChange(() => void this.refresh()),
      watcher.onDidDelete(() => void this.refresh()),
    );
  }

  /** Open (or reveal) the setup flow panel. */
  static open(context: vscode.ExtensionContext): void {
    if (SetupFlowPanel.instance) {
      SetupFlowPanel.instance.panel.reveal(vscode.ViewColumn.One);
    } else {
      SetupFlowPanel.instance = new SetupFlowPanel(context);
    }
  }

  async refresh(): Promise<void> {
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
    switch (msg.type) {
      case "ready":
        void this.refresh();
        break;
      case "runCommand":
        runWebviewCommand(msg.command);
        if (isBootstrapCommand(msg.command)) {
          // Bootstrap runs in a terminal; the standing
          // onDidFinishTerminalCommand subscription refreshes when it closes.
          // Stamp the time so that post-close refresh reads it.
          void this.context.globalState.update(
            "alp.lastBootstrapAt",
            new Date().toISOString(),
          );
        }
        break;
      case "closePanel":
        // Return the user to the main IDE hub after finishing setup.
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

  private dispose(): void {
    SetupFlowPanel.instance = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
