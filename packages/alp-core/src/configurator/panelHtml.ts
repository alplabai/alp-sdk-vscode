// SPDX-License-Identifier: Apache-2.0

export interface ConfiguratorPanelHtmlInput {
  nonce: string;
  cspSource: string;
  cssUri: string;
  jsUri: string;
  logoUri: string;
}

export function createConfiguratorPanelHtml(input: ConfiguratorPanelHtmlInput): string {
  const csp =
    `default-src 'none'; ` +
    `style-src ${input.cspSource}; ` +
    `img-src ${input.cspSource}; ` +
    `font-src ${input.cspSource}; ` +
    `script-src 'nonce-${input.nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${input.cssUri}">
  <title>Alp Board Configurator</title>
</head>
<body>
  <header class="alp-hd">
    <img class="alp-logo" src="${input.logoUri}" alt="Alp Lab">
    <span class="alp-div"></span>
    <h1>Board Configurator</h1>
    <span class="alp-spacer"></span>
    <span id="alp-saved" class="alp-saved"></span>
  </header>
  <div class="alp-grid">
    <aside id="alp-sidebar" class="alp-side">
      <input id="alp-search" class="alp-search" placeholder="Search settings…">
      <nav class="alp-nav">
        <a class="active" data-section="project" href="#">Project &amp; Hardware</a>
        <a data-section="cores" href="#">Cores</a>
      </nav>
    </aside>
    <main id="alp-main" class="alp-main"></main>
  </div>
  <footer class="alp-ft">
    <span id="alp-validation" class="alp-valid"></span>
    <span class="alp-spacer"></span>
    <button id="alp-preview" class="alp-btn">Preview effective config</button>
    <button id="alp-reload" class="alp-btn">Reload</button>
    <button id="alp-save" class="alp-btn primary">Save board.yaml</button>
  </footer>
  <script nonce="${input.nonce}" src="${input.jsUri}"></script>
</body>
</html>`;
}
