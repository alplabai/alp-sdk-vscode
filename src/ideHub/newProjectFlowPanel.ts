// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { runAlpCommand } from "../alpCli/vscodeAdapter";
import {
  emptyAlpIdeState,
  PROTOCOL_VERSION,
  type ExtToWebviewMessage,
  type ProjectTemplate,
  type WebviewToExtMessage,
} from "./messages";
import { E1M_MODULES } from "./projectScaffold";
import { openProjectFolder, queryAlpIdeState } from "./vscodeAdapter";
import { buildWebviewHtml } from "./webviewHtml";

const PANEL_VIEW_TYPE = "alp-ide.new-project-flow";
const PANEL_TITLE = "ALP IDE — New Project";

export class NewProjectFlowPanel {
  private static instance?: NewProjectFlowPanel;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      PANEL_TITLE,
      vscode.ViewColumn.One,
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

    this.panel.webview.html = buildWebviewHtml(
      this.panel.webview,
      context.extensionUri,
      "new-project-flow",
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => void this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static open(context: vscode.ExtensionContext): void {
    if (NewProjectFlowPanel.instance) {
      NewProjectFlowPanel.instance.panel.reveal(vscode.ViewColumn.One);
    } else {
      NewProjectFlowPanel.instance = new NewProjectFlowPanel(context);
    }
  }

  private async sendState(): Promise<void> {
    const lastBootstrapAt =
      this.context.globalState.get<string>("alp.lastBootstrapAt") ?? null;
    const state = await queryAlpIdeState(lastBootstrapAt).catch(() =>
      emptyAlpIdeState(),
    );

    const stateMsg: ExtToWebviewMessage = {
      type: "stateUpdate",
      _v: PROTOCOL_VERSION,
      state,
    };
    void this.panel.webview.postMessage(stateMsg);

    const catalogMsg: ExtToWebviewMessage = {
      type: "projectTemplatesData",
      templates: await this.fetchTemplates(),
      modules: E1M_MODULES,
    };
    void this.panel.webview.postMessage(catalogMsg);
  }

  /** Build the template picker from the CLI's real templates (single source of
   *  truth): `alp explain` lists ids, then per-id explain gives title/blurb. */
  private async fetchTemplates(): Promise<ProjectTemplate[]> {
    const overview = await runAlpCommand(this.context, ["explain"]);
    const ids =
      (
        overview.outcome.envelope?.data as
          | { available?: { projectTemplates?: string[] } }
          | undefined
      )?.available?.projectTemplates ?? [];

    const templates: ProjectTemplate[] = [];
    for (const id of ids) {
      const detail = await runAlpCommand(this.context, [
        "explain",
        "--template",
        id,
      ]);
      const data = detail.outcome.envelope?.data as
        | { summary?: string; details?: string[] }
        | undefined;
      templates.push({
        id,
        title: data?.summary ?? id,
        description: data?.details?.[0] ?? "",
        category: "starter",
        icon: "📦",
      });
    }
    return templates;
  }

  private async handleMessage(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.sendState();
        break;

      case "createNewProject":
        await this.createProject(msg.templateId, msg.moduleId, msg.projectName);
        break;

      case "closePanel":
        void vscode.commands.executeCommand("alp.ideHub.focus");
        this.panel.dispose();
        break;

      case "openUrl":
        if (msg.url.startsWith("https://") || msg.url.startsWith("vscode://")) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;

      case "runCommand":
        void vscode.commands.executeCommand(msg.command);
        break;
    }
  }

  private async createProject(
    templateId: string,
    moduleId: string,
    projectName: string,
  ): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select parent folder for new project",
      openLabel: "Select Folder",
    });

    if (!uris || uris.length === 0) {
      return;
    }

    const parentDir = uris[0].fsPath;
    const projectDir = path.join(parentDir, projectName);

    if (fs.existsSync(projectDir)) {
      void vscode.window.showErrorMessage(
        `Folder already exists: ${projectDir}`,
      );
      return;
    }

    // Delegate scaffolding to the CLI: real template files + the chosen SoM
    // written into board.yaml (alp init --som).
    const { outcome } = await runAlpCommand(this.context, [
      "init",
      "--template",
      templateId,
      "--name",
      projectName,
      "--destination",
      parentDir,
      "--som",
      moduleId,
      "--non-interactive",
    ]);
    if (!outcome.envelope || !outcome.envelope.ok) {
      await vscode.window.showErrorMessage(`Alp: ${outcome.message}`);
      return;
    }

    const open = "Open Project";
    const choice = await vscode.window.showInformationMessage(
      `Project "${projectName}" created at ${projectDir}`,
      open,
    );
    if (choice === open) {
      // Open in a new window when a workspace is already open, so we don't
      // replace the user's current session.
      await openProjectFolder(vscode.Uri.file(projectDir));
    }

    this.panel.dispose();
  }

  private dispose(): void {
    NewProjectFlowPanel.instance = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
