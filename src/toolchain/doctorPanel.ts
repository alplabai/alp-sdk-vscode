// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createDoctorPanelHtml } from "@alp-sdk/core/toolchain/doctorHtml";
import { ToolchainFixId } from "@alp-sdk/core/toolchain/bootstrapPlan";
import { buildToolchainReport, runToolchainFix } from "../toolchain";

let current: vscode.WebviewPanel | undefined;

function html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = String(Math.random()).slice(2);
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "toolchainDoctor.css"));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "toolchainDoctor.js"));
  return createDoctorPanelHtml({ nonce, cspSource: webview.cspSource, cssUri: String(cssUri), jsUri: String(jsUri) });
}

function postReport(panel: vscode.WebviewPanel): void {
  panel.webview.postMessage({ type: "report", report: buildToolchainReport() });
}

export function showToolchainDoctorPanel(context: vscode.ExtensionContext): void {
  if (current) {
    current.reveal(vscode.ViewColumn.Active);
    postReport(current);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    "alpToolchainDoctor",
    "Alp Toolchain Doctor",
    vscode.ViewColumn.Active,
    { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")] },
  );
  panel.webview.html = html(panel.webview, context.extensionUri);
  panel.webview.onDidReceiveMessage((msg) => {
    if (msg?.type === "fix" && typeof msg.fixId === "string") {
      runToolchainFix(msg.fixId as ToolchainFixId);
    } else if (msg?.type === "reload") {
      postReport(panel);
    }
  });
  panel.onDidDispose(() => {
    current = undefined;
  });
  current = panel;
  postReport(panel);
}
