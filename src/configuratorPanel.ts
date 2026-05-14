// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import {
    ConfiguratorInboundMessage,
    ConfiguratorOutboundMessage,
} from "./configurator/models";
import { createConfiguratorPanelHtml } from "./configurator/panelHtml";
import {
    loadBoardModel,
    loadPresetCatalogue,
    saveBoardModel,
} from "./configurator/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";

function panelHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = String(Math.random()).slice(2);
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "configurator.css"),
  );
  const jsUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "configurator.js"),
  );
  return createConfiguratorPanelHtml({
    nonce,
    cspSource: webview.cspSource,
    cssUri: String(cssUri),
    jsUri: String(jsUri),
  });
}

class ConfiguratorPanel {
  private static current: ConfiguratorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext): void {
    if (ConfiguratorPanel.current) {
      ConfiguratorPanel.current.panel.reveal(vscode.ViewColumn.Active);
      ConfiguratorPanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "alpConfigurator",
      "ALP Board Configurator",
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

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.refresh();
  }

  private refresh(): void {
    const project = collectProjectContext();
    const boardPath = project.boardYamlPath;
    if (!boardPath) {
      vscode.window.showErrorMessage(
        "Alp: open a workspace folder before launching the configurator.",
      );
      return;
    }
    const message: ConfiguratorOutboundMessage = {
      type: "init",
      model: loadBoardModel(boardPath),
      catalogue: loadPresetCatalogue(project),
      boardPath,
    };
    this.panel.webview.postMessage(message);
  }

  private onMessage(msg: ConfiguratorInboundMessage): void {
    if (msg.type === "save" && msg.payload) {
      const boardPath = collectProjectContext().boardYamlPath;
      if (!boardPath) return;
      try {
        saveBoardModel(boardPath, msg.payload);
        const message: ConfiguratorOutboundMessage = {
          type: "saved",
          boardPath,
        };
        this.panel.webview.postMessage(message);
        vscode.window.setStatusBarMessage(`Alp: saved ${boardPath}`, 5000);
      } catch (e) {
        vscode.window.showErrorMessage(`Alp: save failed: ${e}`);
      }
    } else if (msg.type === "reload") {
      this.refresh();
    } else if (msg.type === "previewEffectiveConfig") {
      void vscode.commands.executeCommand("alp.previewEffectiveConfig");
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
