// SPDX-License-Identifier: Apache-2.0

export interface DoctorPanelHtmlInput {
  nonce: string;
  cspSource: string;
  cssUri: string;
  jsUri: string;
}

export function createDoctorPanelHtml(input: DoctorPanelHtmlInput): string {
  const { nonce, cspSource, cssUri, jsUri } = input;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${cssUri}" rel="stylesheet" />
  <title>Alp Toolchain Doctor</title>
</head>
<body>
  <header class="alp-doc-header">
    <span class="alp-doc-title">Toolchain Doctor</span>
    <span id="alp-doc-summary" class="alp-doc-summary"></span>
  </header>
  <main id="alp-doc-rows"></main>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
