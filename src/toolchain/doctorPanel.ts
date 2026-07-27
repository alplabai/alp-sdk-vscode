// SPDX-License-Identifier: Apache-2.0

import { ToolchainReport } from "@alp-sdk/core/toolchain/doctor";
import * as vscode from "vscode";
import {
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "../ideHub/messages";
import { buildWebviewHtml } from "../ideHub/webviewHtml";
import { buildToolchainReportViaCli, runToolchainFix } from "../toolchain";

const PANEL_VIEW_TYPE = "alpToolchainDoctor";
const PANEL_TITLE = "Alp Toolchain Doctor";

/**
 * The CLI build gate couldn't run, so this report comes from the weaker
 * in-process probes — which can read "toolchain OK" without checking the
 * build-critical items. Surface that provenance as the report's first check
 * row, not as a toast: it is per-report state the panel it rides on already
 * renders, and as a toast it duplicated its own sentence and could stack with
 * `offerBootstrapFix`'s warning. `buildToolchainReportViaCli` has already
 * logged the same reason to the output channel.
 *
 * `ok` / `missingRequired` are deliberately untouched — a gate that did not
 * run is not a missing tool, and inflating the count would make the summary
 * line lie.
 */
function withBuildGateRow(
  report: ToolchainReport,
  reason: string | undefined,
): ToolchainReport {
  return {
    ...report,
    checks: [
      {
        id: "buildGate",
        label: "Build gate",
        status: "warn",
        detail:
          reason ??
          "Did not run — showing local in-process checks only, which can read OK without checking the build-critical items.",
        required: true,
      },
      ...report.checks,
    ],
  };
}

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
      report: fromCli ? report : withBuildGateRow(report, reason),
    };
    void this.panel.webview.postMessage(message);
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
