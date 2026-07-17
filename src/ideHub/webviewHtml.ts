// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";

/**
 * Build the HTML shell for any Alp IDE webview (sidebar or panel).
 *
 * @param mode  Written to `<body data-alp-mode>` so the React app can route
 *              to the correct shell without a separate bundle.
 */
export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  mode = "sidebar",
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(
      extensionUri,
      "packages",
      "alp-webview",
      "dist",
      "main.js",
    ),
  );

  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(
      extensionUri,
      "packages",
      "alp-webview",
      "dist",
      "main.css",
    ),
  );

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:;"/>
  <title>Alp IDE</title>
  <link rel="stylesheet" href="${styleUri}"/>
</head>
<body data-alp-mode="${mode}" style="margin:0;padding:0">
  <div id="root">
    <p style="padding:8px;color:var(--vscode-foreground,#fff);background:var(--vscode-sideBar-background,transparent)">
      ⏳ Loading Alp IDE…
    </p>
  </div>
  <script>
    window.onerror = function(msg, src, line, col, err) {
      console.error('[Alp IDE] error:', msg, src, line);
      var r = document.getElementById('root');
      if (r) r.innerHTML = '<pre style="padding:8px;color:red;font-size:11px;white-space:pre-wrap"><b>Alp IDE Error:</b>\\n' + msg + '\\n' + (src||'') + ':' + line + '\\n' + (err ? err.stack : '') + '</pre>';
    };
  </script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}
