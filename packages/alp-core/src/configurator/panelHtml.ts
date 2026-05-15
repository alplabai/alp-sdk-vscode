// SPDX-License-Identifier: Apache-2.0

export interface ConfiguratorPanelHtmlInput {
  nonce: string;
  cspSource: string;
  cssUri: string;
  jsUri: string;
}

export function createConfiguratorPanelHtml(
  input: ConfiguratorPanelHtmlInput,
): string {
  const csp =
    `default-src 'none'; ` +
    `style-src ${input.cspSource}; ` +
    `script-src 'nonce-${input.nonce}'; ` +
    `font-src ${input.cspSource};`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link rel="stylesheet" href="${input.cssUri}">
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
      <div id="os-choice-row">
        <label>OS target
          <select id="os-choice"></select>
        </label>
      </div>
      <div id="cores-block" hidden>
        <h3>Core configuration (schema v2)</h3>
        <p class="help">Each row corresponds to a core in the SoM topology. Set <code>off</code> to exclude a core from the build.</p>
        <div id="cores-rows"></div>
      </div>
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

    <script nonce="${input.nonce}" src="${input.jsUri}"></script>
</body>
</html>`;
}
