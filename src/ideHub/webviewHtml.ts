// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

import { planFailure } from "../notify/service";
import { notifyAsync } from "../notify/vscodeAdapter";

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

  // Per-render CSP nonce: only scripts and styles carrying it may run, so
  // 'unsafe-inline' stays out of BOTH script-src and style-src — injected
  // inline handlers cannot execute and injected style attributes are dropped.
  //
  // Nothing here needs `style-src 'unsafe-inline'`: the components' CSS ships as
  // an external dist/main.css (covered by cspSource), React applies `style={{}}`
  // props through the CSSOM (`style.setProperty` / `style[name] =`), which CSP
  // does not govern, and the two rules the shell needs for itself live in the
  // nonce'd <style> below rather than in style="" attributes.
  const nonce = randomBytes(16).toString("base64");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:;"/>
  <title>Alp IDE</title>
  <link rel="stylesheet" href="${styleUri}"/>
  <style nonce="${nonce}">
    /* The shell's own two rules. Kept here rather than in dist/main.css so the
       loading state still renders correctly if that stylesheet fails to load —
       which is one of the failures this state exists to show. */
    body { margin: 0; padding: 0; }
    .alp-shell-loading {
      padding: 8px;
      color: var(--vscode-foreground, #fff);
      background: var(--vscode-sideBar-background, transparent);
    }
  </style>
</head>
<body data-alp-mode="${mode}">
  <div id="root">
    <p class="alp-shell-loading">
      Loading Alp IDE…
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
  "alp.openDependencies",
  "alp.openExistingProject",
  "alp.openHardwareExplorer",
  "alp.openHub",
  "alp.openModelsPanel",
  "alp.openOverview",
  "alp.openSdkManager",
  "alp.openSettings",
  "alp.openSetupFlow",
  "alp.previewEffectiveConfig",
  "alp.showBuildPlan",
  // `alp.toolchainDoctor` is deliberately NOT here. The id still exists (the
  // notify seam's `runDoctor` action and shipped keybindings execute it, and it
  // opens the dependency panel), but no webview posts it any more — the Hub
  // tile and the Environment card both dispatch `alp.openDependencies`. A stale
  // bundle that still posts the old id gets the "reload the window" notice,
  // which is exactly the situation it describes.
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
 * Both ids run the same bootstrap flow (see src/bootstrap.ts): `alp.installDependencies`
 * (palette / Setup view) and `alp.bootstrap` (the id some webview buttons post).
 * Panels use this so the `lastBootstrapAt` stamp + delayed refresh fire for
 * EITHER id — otherwise a button posting one id into a panel that only watched
 * the other would run bootstrap but never refresh the status.
 */
export function isBootstrapCommand(command: string): boolean {
  return command === "alp.installDependencies" || command === "alp.bootstrap";
}

/**
 * Run a webview-requested command, but only when it is allowlisted; a refused
 * command surfaces an error instead of executing silently.
 */
export function runWebviewCommand(command: string): void {
  if (!ALLOWED_WEBVIEW_COMMANDS.has(command)) {
    // The real cause is a stale webview bundle or an allowlist gap, so the
    // remedy is a reload; the VS Code command id is an internal identifier and
    // goes to the channel, not into the sentence.
    notifyAsync(
      planFailure({
        operation: "Running an Alp IDE action",
        cause: "This Alp IDE action isn't available in this version.",
        detail: `refused webview command: ${command}`,
        actions: [{ id: "reloadWindow" }],
        dedupeKey: "webview-command-refused",
      }),
    );
    return;
  }
  void vscode.commands.executeCommand(command);
}
