// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from "node:crypto";
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

/**
 * Commands an Alp IDE webview is allowed to invoke via a `runCommand` message.
 * A webview is untrusted input, so anything outside this set is refused rather
 * than forwarded to `vscode.commands.executeCommand`.
 */
export const ALLOWED_WEBVIEW_COMMANDS: ReadonlySet<string> = new Set([
  "alp.bootstrap",
  "alp.debug",
  "alp.ideHub.focus",
  "alp.installDependencies",
  "alp.newProjectWizard",
  "alp.openConfigurator",
  "alp.openExistingProject",
  "alp.openHardwareExplorer",
  "alp.openHub",
  "alp.openOverview",
  "alp.openSdkManager",
  "alp.openSettings",
  "alp.openSetupFlow",
  "alp.previewEffectiveConfig",
  "alp.showBuildPlan",
  "alp.toolchainDoctor",
  "alp.validateBoardYaml",
  "alp.westAlpClean",
  "alp.westAlpFlash",
  "alp.westAlpImage",
  "alp.westAlpRenode",
  "alp.westBuild",
  "alp.westFlash",
  "alp.westRunNativeSim",
  "alp.westUpdate",
  "vscode.openFolder",
  "workbench.action.reloadWindow",
]);

/**
 * Run a webview-requested command, but only when it is allowlisted; a refused
 * command surfaces an error instead of executing silently.
 */
export function runWebviewCommand(command: string): void {
  if (!ALLOWED_WEBVIEW_COMMANDS.has(command)) {
    void vscode.window.showErrorMessage(
      `Alp IDE refused to run an unexpected command: ${command}`,
    );
    return;
  }
  void vscode.commands.executeCommand(command);
}
