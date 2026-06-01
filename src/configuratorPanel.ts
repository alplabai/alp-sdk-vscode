// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { buildConfiguratorViewModel } from "@alp-sdk/core/configurator/viewModel";
import type { BoardConfig } from "@alp-sdk/core/board/models";
import {
    loadBoardConfigFromFile,
    saveBoardConfigToFile,
} from "./configurator/boardIo";
import {
    type ExtToWebviewMessage,
    type WebviewToExtMessage,
} from "./ideHub/messages";
import { buildWebviewHtml } from "./ideHub/webviewHtml";
import { collectProjectContext } from "./project/vscodeAdapter";
import { loadSdkCatalogue } from "./sdkCatalogue/vscodeAdapter";
import { log } from "./util";

const PANEL_VIEW_TYPE = "alpConfigurator";
const PANEL_TITLE = "ALP Board Configurator";

class ConfiguratorPanel {
  private static current: ConfiguratorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private board: BoardConfig = { som: { sku: "" }, cores: {} };

  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext): void {
    if (ConfiguratorPanel.current) {
      ConfiguratorPanel.current.panel.reveal(vscode.ViewColumn.Active);
      ConfiguratorPanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      PANEL_TITLE,
      vscode.ViewColumn.Active,
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
    ConfiguratorPanel.current = new ConfiguratorPanel(panel, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
  ) {
    this.panel = panel;
    this.panel.webview.html = buildWebviewHtml(
      this.panel.webview,
      context.extensionUri,
      "configurator",
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.onMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private refresh(): void {
    const project = collectProjectContext();
    const boardPath = project.boardYamlPath;
    if (!boardPath) {
      void vscode.window.showErrorMessage(
        "Alp: open a workspace folder before launching the configurator.",
      );
      return;
    }
    this.board = loadBoardConfigFromFile(boardPath);
    this.postRender(boardPath, project.sdkRoot ?? null);
  }

  private postRender(boardPath: string, sdkRoot: string | null): void {
    const catalogue = loadSdkCatalogue(sdkRoot, (m) => log(m));
    const message: ExtToWebviewMessage = {
      type: "configuratorRender",
      viewModel: buildConfiguratorViewModel(this.board, catalogue),
      board: this.board,
      boardPath,
      sdkConnected: catalogue.soms.length > 0,
    };
    void this.panel.webview.postMessage(message);
  }

  private onMessage(msg: WebviewToExtMessage): void {
    const project = collectProjectContext();
    const boardPath = project.boardYamlPath;
    switch (msg.type) {
      case "ready":
        this.refresh();
        break;
      case "configuratorUpdate":
        if (!boardPath) return;
        this.board = msg.board;
        this.postRender(boardPath, project.sdkRoot ?? null);
        break;
      case "saveBoardConfig": {
        if (!boardPath) return;
        try {
          saveBoardConfigToFile(boardPath, this.board);
          const saved: ExtToWebviewMessage = {
            type: "configuratorSaved",
            boardPath,
          };
          void this.panel.webview.postMessage(saved);
          vscode.window.setStatusBarMessage(`Alp: saved ${boardPath}`, 5000);
        } catch (e) {
          void vscode.window.showErrorMessage(`Alp: save failed: ${e}`);
        }
        break;
      }
      case "reloadConfigurator":
        this.refresh();
        break;
      case "previewEffectiveConfig":
        void vscode.commands.executeCommand("alp.previewEffectiveConfig");
        break;
      case "closePanel":
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
    ConfiguratorPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

export function registerConfiguratorCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand("alp.openConfigurator", () =>
    ConfiguratorPanel.show(context),
  );
}
