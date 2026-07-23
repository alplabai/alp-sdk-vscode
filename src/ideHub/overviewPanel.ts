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
import { onDidFinishTerminalCommand } from "../util";
import {
  buildWebviewHtml,
  isBootstrapCommand,
  runWebviewCommand,
} from "./webviewHtml";

const PANEL_VIEW_TYPE = "alp-ide.overview";
const PANEL_TITLE = "Alp IDE — Hub";

export class OverviewPanel {
  private static instance?: OverviewPanel;

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
      "overview",
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

    // Reactivity (no reload): refresh on alpSdk config edits (SDK activate /
    // install sets alpSdk.path), when this panel becomes the active tab, and
    // when the window regains focus while visible (e.g. back from a bootstrap
    // terminal) — so the status cards adapt to the new state in place.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("alpSdk")) void this.refresh();
      }),
      this.panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) void this.refresh();
      }),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused && this.panel.visible) void this.refresh();
      }),
      // Refresh on the real completion signal: a CTA that runs in a terminal
      // (bootstrap, a west build/flash) closes it when done. See util.ts.
      onDidFinishTerminalCommand(() => void this.refresh()),
    );
  }

  /** Open (or reveal) the Hub panel. `focus: "sdk"` scrolls to the SDK Manager
   *  section (the standalone SDK Manager panel is now folded in here). */
  static open(context: vscode.ExtensionContext, focus?: "sdk"): void {
    if (OverviewPanel.instance) {
      OverviewPanel.instance.panel.reveal(vscode.ViewColumn.One);
    } else {
      OverviewPanel.instance = new OverviewPanel(context);
    }
    if (focus === "sdk") {
      void OverviewPanel.instance.panel.webview.postMessage({
        type: "focusSection",
        section: "sdk",
      });
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
    if (this.sdkHandler(msg)) return;
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
