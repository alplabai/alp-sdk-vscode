// SPDX-License-Identifier: Apache-2.0
//
// Pure decision layer for webview -> host command requests. No vscode imports,
// so it is unit-testable in isolation (webviewHtml.ts owns the vscode side).

/**
 * Commands an Alp IDE webview is allowed to invoke via a `runCommand` message.
 * A webview is untrusted input, so anything outside this set is refused rather
 * than forwarded to `vscode.commands.executeCommand`.
 */
export const ALLOWED_WEBVIEW_COMMANDS: ReadonlySet<string> = new Set([
  "alp.bootstrap",
  "alp.ideHub.focus",
  "alp.installDependencies",
  "alp.newProjectWizard",
  "alp.openConfigurator",
  "alp.openExistingProject",
  "alp.openHardwareExplorer",
  "alp.openSdkManager",
  "alp.openSettings",
  "alp.openSetupFlow",
  "alp.toolchainDoctor",
  "alp.westBuild",
  "alp.westFlash",
  "vscode.openFolder",
  "workbench.action.reloadWindow",
]);

/**
 * Allowlisted commands that additionally require the project to be build-ready
 * (`derivePhase(state) === "ready"`). The webview only renders their CTAs when
 * ready, but the host re-checks anyway: the webview is untrusted, and a stale
 * webview could post a build request after the state fell out of "ready" (the
 * build would then fail loudly in the terminal for nothing). These are the
 * Quickstart ladder's step-④ actions.
 */
export const BUILD_GATED_WEBVIEW_COMMANDS: ReadonlySet<string> = new Set([
  "alp.westBuild",
  "alp.westFlash",
]);

export type WebviewCommandRefusal = "not-allowlisted" | "not-build-ready";

/**
 * Decide whether a webview-requested command may run. `buildReady` is the
 * host-side `derivePhase(state) === "ready"`; pass it from a provider that
 * surfaces build actions so a build request in a non-ready phase is refused
 * even if the webview offered it. When omitted (callers that never surface
 * build actions), the build gate is skipped and only the allowlist applies.
 */
export function classifyWebviewCommand(
  command: string,
  buildReady?: boolean,
): { ok: true } | { ok: false; reason: WebviewCommandRefusal } {
  if (!ALLOWED_WEBVIEW_COMMANDS.has(command)) {
    return { ok: false, reason: "not-allowlisted" };
  }
  if (BUILD_GATED_WEBVIEW_COMMANDS.has(command) && buildReady === false) {
    return { ok: false, reason: "not-build-ready" };
  }
  return { ok: true };
}
