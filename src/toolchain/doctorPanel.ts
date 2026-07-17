// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import {
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "../ideHub/messages";
import { buildWebviewHtml } from "../ideHub/webviewHtml";
import { buildToolchainReportViaCli, runToolchainFix } from "../toolchain";
import { showOutput } from "../util";

const PANEL_VIEW_TYPE = "alpToolchainDoctor";
const PANEL_TITLE = "Alp Toolchain Doctor";

class ToolchainDoctorPanel {
  private static current: ToolchainDoctorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext): void {
    if (ToolchainDoctorPanel.current) {
      ToolchainDoctorPanel.current.panel.reveal(vscode.ViewColumn.Active);
      void ToolchainDoctorPanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      PANEL_TITLE,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(
            context.extensionUri,
            "packages",
            "alp-webview",
            "dist",
          ),
        ],
      },
    );
    ToolchainDoctorPanel.current = new ToolchainDoctorPanel(panel, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
  ) {
    this.panel = panel;
    this.context = context;
    this.panel.webview.html = buildWebviewHtml(
      this.panel.webview,
      context.extensionUri,
      "toolchain-doctor",
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.onMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async refresh(): Promise<void> {
    const { report, fromCli, reason } = await buildToolchainReportViaCli(
      this.context,
    );
    const message: ExtToWebviewMessage = {
      type: "toolchainReport",
      report,
    };
    void this.panel.webview.postMessage(message);
    if (!fromCli) {
      void this.warnFallback(reason);
    }
  }

  /** The CLI build gate couldn't run, so this report comes from the weaker
   *  in-process probes — which can read "toolchain OK" without checking the
   *  build-critical items. The report looks identical, so surface the
   *  provenance (and reason) or the user trusts a gate that never ran. */
  private async warnFallback(reason: string | undefined): Promise<void> {
    const detail = reason ? `: ${reason}` : ".";
    const choice = await vscode.window.showWarningMessage(
      `Build gate did not run — showing local checks only${detail}`,
      "Show Output",
      "Update CLI",
    );
    if (choice === "Show Output") {
      showOutput();
    } else if (choice === "Update CLI") {
      await vscode.commands.executeCommand("alp.updateCli");
    }
  }

  private onMessage(msg: WebviewToExtMessage): void {
    switch (msg.type) {
      case "ready":
      case "reloadToolchain":
        void this.refresh();
        break;
      case "runToolchainFix":
        runToolchainFix(msg.fixId);
        break;
      case "closePanel":
        this.panel.dispose();
        break;
      case "openUrl":
        if (msg.url.startsWith("https://") || msg.url.startsWith("vscode://")) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
    }
  }

  private dispose(): void {
    ToolchainDoctorPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

export function showToolchainDoctorPanel(
  context: vscode.ExtensionContext,
): void {
  ToolchainDoctorPanel.show(context);
}
