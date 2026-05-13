// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import {
    ConfiguratorInboundMessage,
    ConfiguratorOutboundMessage,
} from "./configurator/models";
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
  const csp =
    `default-src 'none'; ` +
    `style-src ${webview.cspSource}; ` +
    `script-src 'nonce-${nonce}'; ` +
    `font-src ${webview.cspSource};`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link rel="stylesheet" href="${cssUri}">
    <title>ALP Board Configurator</title>
</head>
<body>
    <h1>ALP Board Configurator</h1>
    <p class="subtitle">Pick your SoM, carrier, OS, and feature flags.  The YAML editor stays available; this view edits the same <code>board.yaml</code>.</p>

    <section>
        <h2>SoM</h2>
        <label>SKU
            <select id="som-sku"></select>
        </label>
    </section>

    <section>
        <h2>Carrier</h2>
        <label>Name
            <select id="carrier-name"></select>
        </label>
        <details>
            <summary>Per-chip overrides (carrier <code>populated</code> block)</summary>
            <div id="carrier-populated"></div>
        </details>
    </section>

    <section>
        <h2>OS</h2>
        <label>Target backend
            <select id="os-choice"></select>
        </label>
    </section>

    <section>
        <h2>Inference</h2>
        <label>Backend
            <select id="inference-backend">
                <option value="">(use SoM preset's preferred_backend)</option>
            </select>
        </label>
        <label>Tensor arena (KiB)
            <input type="number" id="inference-arena" min="16" placeholder="128">
        </label>
    </section>

    <section>
        <h2>IoT</h2>
        <label><input type="checkbox" id="iot-wifi"> Wi-Fi station path</label>
        <label><input type="checkbox" id="iot-mqtt"> MQTT client</label>
        <label><input type="checkbox" id="iot-ble"> BLE host stack</label>
        <label><input type="checkbox" id="iot-tls"> TLS (MbedTLS-backed &lt;alp/security.h&gt;)</label>
    </section>

    <section>
        <h2>Libraries</h2>
        <div id="libraries"></div>
    </section>

    <section>
        <h2>Diagnostics</h2>
        <label><input type="checkbox" id="diag-last-error" checked> <code>alp_last_error()</code> thread-local slot</label>
        <label>Log level
            <select id="diag-log-level"></select>
        </label>
    </section>

    <div class="actions">
        <button id="save">Save board.yaml</button>
        <button id="reload">Reload from disk</button>
        <span id="status"></span>
    </div>

    <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
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
