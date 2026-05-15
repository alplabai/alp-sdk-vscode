// SPDX-License-Identifier: Apache-2.0

import type { SdkInstallAdapter } from "@alp-sdk/core/sdk/adapterCore";
import {
    installSdkRelease,
    listRemoteSdkReleases,
    switchActiveSdk,
} from "@alp-sdk/core/sdk/service";
import * as cp from "child_process";
import * as fs from "fs";
import * as vscode from "vscode";
import {
    emptyAlpIdeState,
    PROTOCOL_VERSION,
    type ExtToWebviewMessage,
    type WebviewToExtMessage,
} from "./messages";
import { queryAlpIdeState, sdkCacheRoot } from "./vscodeAdapter";

const VIEW_ID = "alp-ide.panel";

export class AlpIdeHubProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

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
          this.context.extensionUri,
          "packages",
          "alp-webview",
          "dist",
        ),
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
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

    // Auto-refresh when workspace folders change (project open/close).
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh();
      }),
    );

    // Auto-refresh when board.yaml is created, changed, or deleted.
    const boardYamlWatcher =
      vscode.workspace.createFileSystemWatcher("**/board.yaml");
    this.disposables.push(
      boardYamlWatcher,
      boardYamlWatcher.onDidCreate(() => void this.refresh()),
      boardYamlWatcher.onDidChange(() => void this.refresh()),
      boardYamlWatcher.onDidDelete(() => void this.refresh()),
    );
  }

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
        void vscode.commands.executeCommand(msg.command);
        if (msg.command === "alp.installDependencies") {
          void this.handleBootstrapTriggered();
        }
        break;
      case "selectSdkPath":
        void this.handleSelectSdkPath();
        break;
      case "requestSdkReleases":
        void this.handleRequestSdkReleases();
        break;
      case "requestSdkInstall":
        void this.handleRequestSdkInstall(msg.version);
        break;
      case "switchSdk":
        void this.handleSwitchSdk(msg.sdkPath);
        break;
      case "openUrl":
        void this.handleOpenUrl(msg.url);
        break;
    }
  }

  private async handleSelectSdkPath(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select ALP SDK root directory",
    });
    if (!uris || uris.length === 0) return;
    const sdkPath = uris[0].fsPath;
    await this.handleSwitchSdk(sdkPath);
  }

  private async handleSwitchSdk(sdkPath: string): Promise<void> {
    const workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    try {
      switchActiveSdk(
        workspaceRoot,
        sdkPath,
        (p, content) => fs.writeFileSync(p, content, "utf8"),
        (p) => fs.mkdirSync(p, { recursive: true }),
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Alp: failed to switch SDK — ${String(err)}`,
      );
    }
    await this.refresh();
  }

  private async handleRequestSdkReleases(): Promise<void> {
    if (!this.view) return;
    try {
      const releases = await listRemoteSdkReleases(async (url, headers) => {
        const { default: https } = await import("https");
        return new Promise((resolve, reject) => {
          const options = {
            headers: { "User-Agent": "alp-sdk-vscode", ...headers },
          };
          https
            .get(url, options, (res) => {
              let data = "";
              res.on("data", (chunk: string) => {
                data += chunk;
              });
              res.on("end", () => {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  reject(e);
                }
              });
            })
            .on("error", reject);
        });
      });
      const msg: ExtToWebviewMessage = { type: "sdkReleasesLoaded", releases };
      void this.view.webview.postMessage(msg);
    } catch {
      void vscode.window.showErrorMessage(
        "Alp: failed to fetch SDK releases. Check your network connection.",
      );
    }
  }

  private async handleRequestSdkInstall(version: string): Promise<void> {
    if (!this.view) return;

    const cacheRoot = sdkCacheRoot();
    fs.mkdirSync(cacheRoot, { recursive: true });

    const gitInstallAdapter: SdkInstallAdapter = (ver, destPath) =>
      new Promise<void>((resolve, reject) => {
        const repoUrl = "https://github.com/alplabai/alp-sdk.git";
        const proc = cp.spawn("git", [
          "clone",
          "--branch",
          ver,
          "--depth",
          "1",
          repoUrl,
          destPath,
        ]);
        proc.on("exit", (code) => {
          code === 0
            ? resolve()
            : reject(new Error(`git clone exited with code ${code}`));
        });
        proc.on("error", reject);
      });

    const sendProgress = (
      log: string,
      done: boolean,
      success?: boolean,
    ): void => {
      const msg: ExtToWebviewMessage = {
        type: "sdkInstallProgress",
        log,
        done,
        success,
      };
      void this.view?.webview.postMessage(msg);
    };

    sendProgress(`Installing SDK ${version}…`, false);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `ALP: Installing SDK ${version}`,
        cancellable: false,
      },
      async () => {
        try {
          await installSdkRelease(
            version,
            cacheRoot,
            gitInstallAdapter,
            (p) => fs.existsSync(p),
            (p) => {
              try {
                return fs.readFileSync(p, "utf8");
              } catch {
                return "";
              }
            },
          );
          sendProgress(`SDK ${version} installed successfully.`, true, true);
          await this.refresh();
        } catch (err) {
          sendProgress(`Install failed: ${String(err)}`, true, false);
          void vscode.window.showErrorMessage(
            `Alp: SDK install failed — ${String(err)}`,
          );
        }
      },
    );
  }

  private async handleBootstrapTriggered(): Promise<void> {
    const now = new Date().toISOString();
    await this.context.globalState.update("alp.lastBootstrapAt", now);
    // Bootstrap runs asynchronously in a terminal. Re-check after a delay
    // so the panel reflects newly installed tools without a manual reload.
    setTimeout(() => void this.refresh(), 8000);
  }

  private handleOpenUrl(url: string): void {
    if (!url.startsWith("https://") && !url.startsWith("vscode://")) return;
    void vscode.env.openExternal(vscode.Uri.parse(url));
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = Array.from(
      { length: 16 },
      () => Math.random().toString(36)[2],
    ).join("");

    const distBase = vscode.Uri.joinPath(
      this.context.extensionUri,
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
  const provider = new AlpIdeHubProvider(context);

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
