// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createHardwareExplorerHtml } from "@alp-sdk/core/devtools/hardwareExplorerHtml";
import { loadBoardConfigFromFile } from "./configurator/boardIo";
import { loadSdkCatalogue } from "./sdkCatalogue/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";
import { log } from "./util";

function panelHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = String(Math.random()).slice(2);
  const uri = (...p: string[]) =>
    String(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...p)));
  return createHardwareExplorerHtml({
    nonce,
    cspSource: webview.cspSource,
    cssUri: uri("media", "configurator.css"),
    jsUri: uri("media", "hardwareExplorer.js"),
    logoUri: uri("media", "alplab-logo-white.svg"),
  });
}

class HardwareExplorerPanel {
  private static current: HardwareExplorerPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext): void {
    if (HardwareExplorerPanel.current) {
      HardwareExplorerPanel.current.panel.reveal(vscode.ViewColumn.Active);
      HardwareExplorerPanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "alpHardwareExplorer",
      "Alp Hardware Explorer",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")] },
    );
    HardwareExplorerPanel.current = new HardwareExplorerPanel(panel, context);
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.panel.webview.html = panelHtml(panel.webview, context.extensionUri);
    this.panel.webview.onDidReceiveMessage((m) => { if (m && m.type === "reload") this.refresh(); }, null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.refresh();
  }

  private refresh(): void {
    const project = collectProjectContext();
    const sku = project.boardYamlPath ? (loadBoardConfigFromFile(project.boardYamlPath).som?.sku ?? "") : "";
    const catalogue = loadSdkCatalogue(project.sdkRoot ?? null, log);
    const som = catalogue.soms.find((s) => s.sku === sku) ?? null;
    const cores = som ? (catalogue.socs.find((sp) => sp.ref === som.silicon)?.cores ?? []) : [];
    this.panel.webview.postMessage({
      type: "render",
      som,
      cores,
      sdkConnected: catalogue.soms.length > 0,
    });
  }

  private dispose(): void {
    HardwareExplorerPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

export function registerHardwareExplorerCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand("alp.openHardwareExplorer", () => HardwareExplorerPanel.show(context));
}
