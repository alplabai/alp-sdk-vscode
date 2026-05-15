// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import {
    type ExtToWebviewMessage,
    type WebviewToExtMessage,
    emptyAlpIdeState,
} from "./messages";
import { queryAlpIdeState } from "./vscodeAdapter";

const VIEW_ID = "alp-ide.panel";

export class AlpIdeHubProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  static readonly viewId = VIEW_ID;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(
          this.extensionUri,
          "packages",
          "alp-webview",
          "dist",
        ),
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    webviewView.onDidChangeVisibility(
      () => {
        if (webviewView.visible) {
          void this.refresh();
        }
      },
      undefined,
      this.disposables,
    );
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    const state = await queryAlpIdeState().catch(() => emptyAlpIdeState());
    const msg: ExtToWebviewMessage = { type: "stateUpdate", state };
    void this.view.webview.postMessage(msg);
  }

  private handleMessage(msg: WebviewToExtMessage): void {
    switch (msg.type) {
      case "ready":
        void this.refresh();
        break;
      case "runCommand":
        void vscode.commands.executeCommand(msg.command);
        break;
      case "installSdk":
        void vscode.commands.executeCommand(
          "alp.ideHub.installSdk",
          msg.version,
        );
        break;
      case "switchSdk":
        void vscode.commands.executeCommand(
          "alp.ideHub.switchSdk",
          msg.sdkPath,
        );
        break;
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = Array.from(
      { length: 16 },
      () => Math.random().toString(36)[2],
    ).join("");

    const distBase = vscode.Uri.joinPath(
      this.extensionUri,
      "packages",
      "alp-webview",
      "dist",
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distBase, "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distBase, "main.css"),
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'nonce-${nonce}';
             script-src 'nonce-${nonce}';
             font-src ${webview.cspSource};"/>
  <link rel="stylesheet" href="${styleUri}"/>
  <title>ALP IDE</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

export function registerIdeHubProvider(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  const provider = new AlpIdeHubProvider(context.extensionUri);

  const disposables: vscode.Disposable[] = [
    vscode.window.registerWebviewViewProvider(
      AlpIdeHubProvider.viewId,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand("alp.ideHub.refresh", () =>
      provider.refresh(),
    ),
    vscode.commands.registerCommand("alp.ideHub.focus", () =>
      vscode.commands.executeCommand("workbench.view.extension.alp-ide"),
    ),
  ];

  return disposables;
}
