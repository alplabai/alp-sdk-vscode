// SPDX-License-Identifier: Apache-2.0

export interface HardwareExplorerHtmlInput {
  nonce: string;
  cspSource: string;
  cssUri: string;
  jsUri: string;
  logoUri: string;
}

/** Shell for the read-only Hardware & pin-route explorer webview. */
export function createHardwareExplorerHtml(input: HardwareExplorerHtmlInput): string {
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
  <title>Alp Hardware Explorer</title>
</head>
<body data-theme="brand">
  <header class="alp-hd">
    <img class="alp-logo" src="${input.logoUri}" alt="Alp Lab">
    <span class="alp-div"></span>
    <h1>Hardware Explorer</h1>
    <span class="alp-spacer"></span>
    <span id="hx-som" class="alp-saved"></span>
  </header>
  <main id="hx-main" class="alp-main"></main>
  <script nonce="${input.nonce}" src="${input.jsUri}"></script>
</body>
</html>`;
}
