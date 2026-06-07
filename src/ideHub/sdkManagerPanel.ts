// SPDX-License-Identifier: Apache-2.0

import type { SdkInstallAdapter } from "@alp-sdk/core/sdk/adapterCore";
import type { SdkRelease } from "@alp-sdk/core/sdk/models";
import { installSdkRelease } from "@alp-sdk/core/sdk/service";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { runAlpCommand } from "../alpCli/vscodeAdapter";
import {
  emptyAlpIdeState,
  PROTOCOL_VERSION,
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "./messages";
import { queryAlpIdeState, sdkCacheRoot } from "./vscodeAdapter";
import { buildWebviewHtml } from "./webviewHtml";

const PANEL_VIEW_TYPE = "alp-ide.sdk-manager";
const PANEL_TITLE = "Alp IDE — SDK Manager";

export class SdkManagerPanel {
  private static instance?: SdkManagerPanel;

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
      "sdk-manager",
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
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
    }
  }

  private async handleSelectSdkPath(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select Alp SDK root directory",
    });
    if (!uris || uris.length === 0) return;
    await this.handleSwitchSdk(uris[0].fsPath);
  }

  private async handleSwitchSdk(sdkPath: string): Promise<void> {
    // The active SDK is the `alpSdk.path` setting, which project resolution
    // already reads. Scope it to the Workspace when a folder is open (per-project
    // override) and Global otherwise (the default for windows without one) —
    // VS Code merges Workspace over Global automatically.
    const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    const target = hasWorkspace
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    try {
      await vscode.workspace
        .getConfiguration("alpSdk")
        .update("path", sdkPath, target);
      void vscode.window.showInformationMessage(
        hasWorkspace
          ? `Alp: active SDK for this project → ${sdkPath}`
          : `Alp: default SDK → ${sdkPath} (open a project folder to override per-project)`,
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Alp: failed to set active SDK — ${String(err)}`,
      );
    }
    await this.refresh();
  }

  private async handleRequestSdkReleases(): Promise<void> {
    // Delegate the GitHub releases fetch to `alp sdk list --format json`.
    const { outcome } = await runAlpCommand(this.context, ["sdk", "list"]);
    const envelope = outcome.envelope;
    if (!envelope || !envelope.ok) {
      void vscode.window.showErrorMessage(
        envelope
          ? "Alp: failed to fetch SDK releases. Check your network connection."
          : `Alp: ${outcome.message}`,
      );
      return;
    }
    const releases =
      (envelope.data as { releases?: SdkRelease[] }).releases ?? [];
    const msg: ExtToWebviewMessage = { type: "sdkReleasesLoaded", releases };
    void this.panel.webview.postMessage(msg);
  }

  private async handleRequestSdkInstall(version: string): Promise<void> {
    const cacheRoot = sdkCacheRoot();
    fs.mkdirSync(cacheRoot, { recursive: true });

    // Already installed → say so instead of a silent, instant no-op. Installs
    // are side-by-side under ~/.alp/sdk/<version>, so this never overwrites.
    if (fs.existsSync(path.join(cacheRoot, version))) {
      void vscode.window.showInformationMessage(
        `Alp: SDK ${version} is already installed — activate it from the Local tab.`,
      );
      await this.refresh();
      return;
    }

    const gitInstallAdapter: SdkInstallAdapter = (ver, destPath) =>
      new Promise<void>((resolve, reject) => {
        const proc = cp.spawn("git", [
          "clone",
          "--branch",
          ver,
          "--depth",
          "1",
          "https://github.com/alplabai/alp-sdk.git",
          destPath,
        ]);
        proc.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`git clone exited with code ${code}`)),
        );
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
      void this.panel.webview.postMessage(msg);
    };

    sendProgress(`Installing SDK ${version}…`, false);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Alp: Installing SDK ${version}`,
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

  private dispose(): void {
    SdkManagerPanel.instance = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }
}
