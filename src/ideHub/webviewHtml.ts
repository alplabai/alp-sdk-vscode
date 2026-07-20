// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { classifyWebviewCommand } from "./webviewCommandGate";

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

  // Per-render CSP nonce: only scripts carrying it may run, so 'unsafe-inline'
  // stays out of script-src and injected inline handlers cannot execute.
  const nonce = randomBytes(16).toString("base64");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:;"/>
  <title>Alp IDE</title>
  <link rel="stylesheet" href="${styleUri}"/>
</head>
<body data-alp-mode="${mode}" style="margin:0;padding:0">
  <div id="root">
    <p style="padding:8px;color:var(--vscode-foreground,#fff);background:var(--vscode-sideBar-background,transparent)">
      ⏳ Loading Alp IDE…
    </p>
  </div>
  <script nonce="${nonce}">
    window.onerror = function(msg, src, line, col, err) {
      console.error('[Alp IDE] error:', msg, src, line);
      var r = document.getElementById('root');
      if (r) {
        var pre = document.createElement('pre');
        pre.style.cssText = 'padding:8px;color:red;font-size:11px;white-space:pre-wrap';
        pre.textContent = 'Alp IDE Error:\\n' + msg + '\\n' + (src||'') + ':' + line + '\\n' + (err ? err.stack : '');
        r.textContent = '';
        r.appendChild(pre);
      }
    };
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

// The allowlist + build gate live in a pure module (unit-testable, no vscode);
// re-exported here so existing importers (e.g. the e2e suite) keep working.
export { ALLOWED_WEBVIEW_COMMANDS } from "./webviewCommandGate";

/**
 * Run a webview-requested command, but only when it passes the gate: it must be
 * allowlisted, and a build action (Build/Flash) is refused unless `buildReady`
 * is true. `buildReady` is the host-side `derivePhase(state) === "ready"` —
 * providers that surface build CTAs pass it so a stale/untrusted webview cannot
 * fire a build in a non-ready phase; providers that never surface build actions
 * omit it. A refused command surfaces a message instead of executing silently.
 */
export function runWebviewCommand(command: string, buildReady?: boolean): void {
  const verdict = classifyWebviewCommand(command, buildReady);
  if (!verdict.ok) {
    if (verdict.reason === "not-build-ready") {
      void vscode.window.showWarningMessage(
        "Alp: not ready to build yet — finish the Quickstart steps (set up the environment and a valid board.yaml) first.",
      );
    } else {
      void vscode.window.showErrorMessage(
        `Alp IDE refused to run an unexpected command: ${command}`,
      );
    }
    return;
  }
  void vscode.commands.executeCommand(command);
}
