// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { buildConfiguratorViewModel } from "@alp-sdk/core/configurator/viewModel";
import {
    ConfiguratorInboundMessage,
    ConfiguratorOutboundMessage,
} from "@alp-sdk/core/configurator/models";
import { createConfiguratorPanelHtml } from "@alp-sdk/core/configurator/panelHtml";
import { loadBoardConfigFromFile, saveBoardConfigToFile } from "./configurator/boardIo";
import { loadSdkCatalogue } from "./sdkCatalogue/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";
import { log } from "./util";
import { BoardConfig } from "@alp-sdk/core/board/models";

function panelHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = String(Math.random()).slice(2);
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "configurator.css"),
  );
  const jsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "configurator.js"),
  );
  const logoUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "alplab-logo-white.svg"),
  );
  return createConfiguratorPanelHtml({
    nonce,
    cspSource: webview.cspSource,
    cssUri: String(cssUri),
    jsUri: String(jsUri),
    logoUri: String(logoUri),
  });
}

class ConfiguratorPanel {
  private static current: ConfiguratorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private board: BoardConfig = { som: { sku: "" }, cores: {} };

  static show(context: vscode.ExtensionContext): void {
    if (ConfiguratorPanel.current) {
      ConfiguratorPanel.current.panel.reveal(vscode.ViewColumn.Active);
      ConfiguratorPanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "alpConfigurator",
      "Alp Board Configurator",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "media"),
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
    this.panel.webview.html = panelHtml(panel.webview, context.extensionUri);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      null,
      this.disposables,
    );

    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration("alpSdk.path")) this.refresh();
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.refresh();
  }

  private refresh(): void {
    const project = collectProjectContext();
    const boardPath = project.boardYamlPath;
    if (!boardPath) {
      vscode.window.showErrorMessage("Alp: open a workspace folder before launching the configurator.");
      return;
    }
    this.board = loadBoardConfigFromFile(boardPath);
    this.postRender(boardPath, project.sdkRoot ?? null);
  }

  private postRender(boardPath: string, sdkRoot: string | null): void {
    const catalogue = loadSdkCatalogue(sdkRoot, log);
    const theme = vscode.workspace.getConfiguration("alpSdk").get<string>("configuratorTheme", "brand") === "vscode" ? "vscode" : "brand";
    const message: ConfiguratorOutboundMessage = {
      type: "render",
      viewModel: buildConfiguratorViewModel(this.board, catalogue),
      board: this.board,
      boardPath,
      sdkConnected: catalogue.soms.length > 0,
      theme,
    };
    this.panel.webview.postMessage(message);
  }

  private onMessage(msg: ConfiguratorInboundMessage): void {
    const project = collectProjectContext();
    const boardPath = project.boardYamlPath;
    if (!boardPath) return;
    if (msg.type === "update") {
      this.board = msg.board;
      this.postRender(boardPath, project.sdkRoot ?? null);
    } else if (msg.type === "save") {
      try {
        saveBoardConfigToFile(boardPath, this.board);
        const saved: ConfiguratorOutboundMessage = { type: "saved", boardPath };
        this.panel.webview.postMessage(saved);
        vscode.window.setStatusBarMessage(`Alp: saved ${boardPath}`, 5000);
      } catch (e) {
        vscode.window.showErrorMessage(`Alp: save failed: ${e}`);
      }
    } else if (msg.type === "reload") {
      this.refresh();
    } else if (msg.type === "previewEffectiveConfig") {
      void vscode.commands.executeCommand("alp.previewEffectiveConfig");
    } else if (msg.type === "connectSdk") {
      void vscode.commands.executeCommand("alp.connectSdk");
    } else if (msg.type === "setTheme") {
      // The webview applies the theme instantly; here we only persist it.
      // No postRender: a re-render would re-read the not-yet-committed config
      // (one-selection-behind bug) and needlessly reload the SDK catalogue.
      void vscode.workspace
        .getConfiguration("alpSdk")
        .update(
          "configuratorTheme",
          msg.theme === "vscode" ? "vscode" : "brand",
          vscode.ConfigurationTarget.Workspace,
        );
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
