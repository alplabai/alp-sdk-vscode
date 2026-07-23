// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { loadBoardConfigFromFile } from "../configurator/boardIo";
import {
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "../ideHub/messages";
import { buildWebviewHtml } from "../ideHub/webviewHtml";
import { collectProjectContext } from "../project/vscodeAdapter";
import { loadSdkCatalogue } from "../sdkCatalogue/vscodeAdapter";
import { log } from "../util";

const PANEL_VIEW_TYPE = "alpHardwareExplorer";
const PANEL_TITLE = "Alp Hardware Explorer";

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
    HardwareExplorerPanel.current = new HardwareExplorerPanel(panel, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
  ) {
    this.panel = panel;
    this.panel.webview.html = buildWebviewHtml(
      this.panel.webview,
      context.extensionUri,
      "hardware-explorer",
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
    const catalogue = loadSdkCatalogue(project.sdkRoot, (msg) => log(msg));

    const boardPath = project.boardYamlPath;
    // A malformed board.yaml (yaml.load throws) must not strand the panel on its
    // loading skeleton forever — the skeleton has no reload button. The
    // Configurator guards the identical parse; mirror it here: on a parse error,
    // treat it as no-sku and still post hardwareExplorerData so the view recovers.
    let sku = "";
    if (boardPath) {
      try {
        sku = loadBoardConfigFromFile(boardPath).som.sku;
      } catch (err) {
        log(`[hardware-explorer] board.yaml parse failed: ${String(err)}`);
      }
    }

    const som = sku
      ? (catalogue.soms.find((s) => s.sku === sku) ?? null)
      : null;

    let cores: import("@alp-sdk/core/sdkCatalogue/models").SocCore[] = [];
    if (som) {
      const soc = catalogue.socs.find((s) => s.ref === som.silicon);
      if (soc) cores = soc.cores;
    }

    const message: ExtToWebviewMessage = {
      type: "hardwareExplorerData",
      som,
      cores,
      sdkConnected: project.sdkRoot !== null,
    };
    void this.panel.webview.postMessage(message);
  }

  private onMessage(msg: WebviewToExtMessage): void {
    switch (msg.type) {
      case "ready":
      case "reloadHardwareExplorer":
        this.refresh();
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
    HardwareExplorerPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

export function showHardwareExplorerPanel(
  context: vscode.ExtensionContext,
): void {
  HardwareExplorerPanel.show(context);
}
