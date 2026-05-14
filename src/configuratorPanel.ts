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
  <div class="page">
    <header class="hero">
      <h1>ALP Board Configurator</h1>
      <p class="subtitle">Guided editing for <code>board.yaml</code>. The YAML editor stays first-class; this view writes the same file.</p>
      <div class="topbar">
        <label class="mode-select">Mode
          <select id="view-mode">
            <option value="basic">Basic</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <nav class="section-nav" aria-label="Configurator sections">
          <button type="button" class="section-tab" data-section="project">Project</button>
          <button type="button" class="section-tab" data-section="features">Features</button>
          <button type="button" class="section-tab" data-section="diagnostics">Diagnostics</button>
          <button type="button" class="section-tab" data-section="review">Review</button>
          <button type="button" class="section-tab" data-section="advanced">Advanced</button>
        </nav>
      </div>
      <div class="meta-row">
        <span id="board-path" class="meta-chip"></span>
        <span id="dirty-indicator" class="meta-chip"></span>
      </div>
    </header>

    <section id="section-project" class="config-section" data-level="basic">
      <h2>Project and Hardware</h2>
      <p class="help">Start with identity fields. These values drive preset inheritance and generation defaults.</p>
      <label>SoM SKU
        <select id="som-sku"></select>
      </label>
      <label>Carrier name
        <select id="carrier-name"></select>
      </label>
      <label>OS target
        <select id="os-choice"></select>
      </label>
    </section>

    <section id="section-features" class="config-section" data-level="basic" hidden>
      <h2>Features</h2>
      <p class="help">Choose optional runtime capabilities. Keep fields empty to use inherited preset behavior.</p>
      <h3>Inference</h3>
      <label>Backend
        <select id="inference-backend">
          <option value="">(use SoM preset's preferred_backend)</option>
        </select>
      </label>
      <label>Tensor arena (KiB)
        <input type="number" id="inference-arena" min="16" placeholder="128">
      </label>

      <h3>IoT</h3>
      <label><input type="checkbox" id="iot-wifi"> Wi-Fi station path</label>
      <label><input type="checkbox" id="iot-mqtt"> MQTT client</label>
      <label><input type="checkbox" id="iot-ble"> BLE host stack</label>
      <label><input type="checkbox" id="iot-tls"> TLS (MbedTLS-backed &lt;alp/security.h&gt;)</label>

      <h3>Libraries</h3>
      <div id="libraries"></div>
    </section>

    <section id="section-diagnostics" class="config-section" data-level="advanced" hidden>
      <h2>Diagnostics</h2>
      <p class="help">Tune runtime observability and error-reporting behavior.</p>
      <label><input type="checkbox" id="diag-last-error" checked> <code>alp_last_error()</code> thread-local slot</label>
      <label>Log level
        <select id="diag-log-level"></select>
      </label>
    </section>

    <section id="section-review" class="config-section" data-level="basic" hidden>
      <h2>Review and Validation</h2>
      <p class="help">A lightweight summary runs before save so obvious issues are visible before writing files.</p>
      <p id="validation-counts" class="validation-counts"></p>
      <ul id="validation-items" class="validation-items"></ul>
    </section>

    <section id="section-advanced" class="config-section" data-level="advanced" hidden>
      <h2>Advanced Carrier Overrides</h2>
      <p class="help">Override per-chip <code>carrier.populated</code> flags. Preset-matching values are omitted when saved.</p>
      <div id="carrier-populated"></div>
    </section>

    <div class="actions">
      <button id="save">Save board.yaml</button>
      <button id="reload">Reload from disk</button>
      <button id="preview-effective">Preview effective config</button>
      <span id="status"></span>
    </div>
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
