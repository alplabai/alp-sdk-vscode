// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
    emptyAlpIdeState,
    PROTOCOL_VERSION,
    type E1mModule,
    type ExtToWebviewMessage,
    type ProjectTemplate,
    type WebviewToExtMessage,
} from "./messages";
import { queryAlpIdeState } from "./vscodeAdapter";
import { buildWebviewHtml } from "./webviewHtml";

const PANEL_VIEW_TYPE = "alp-ide.new-project-flow";
const PANEL_TITLE = "ALP IDE — New Project";

// ---------------------------------------------------------------------------
// Static catalog (mirrors alp-sdk-upstream/metadata/e1m_modules/*.yaml)
// ---------------------------------------------------------------------------

const E1M_MODULES: E1mModule[] = [
  {
    id: "E1M-AEN701",
    displayName: "E1M-AEN701 (Alif Ensemble E7)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-AEN301",
    displayName: "E1M-AEN301 (Alif Ensemble E3)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-AEN401",
    displayName: "E1M-AEN401 (Alif Ensemble E4)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-AEN501",
    displayName: "E1M-AEN501 (Alif Ensemble E5)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-AEN601",
    displayName: "E1M-AEN601 (Alif Ensemble E6)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-AEN801",
    displayName: "E1M-AEN801 (Alif Ensemble E8)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-V2N101",
    displayName: "E1M-V2N101 (Renesas RZ/V2N)",
    family: "renesas-rzv2n",
  },
  {
    id: "E1M-V2N102",
    displayName: "E1M-V2N102 (Renesas RZ/V2N, larger memory)",
    family: "renesas-rzv2n",
  },
  {
    id: "E1M-V2M101",
    displayName: "E1M-V2M101 (Renesas RZ/V2N + DEEPX DX-M1)",
    family: "renesas-rzv2n",
  },
  {
    id: "E1M-V2M102",
    displayName: "E1M-V2M102 (Renesas RZ/V2N + DEEPX DX-M1, larger memory)",
    family: "renesas-rzv2n",
  },
  {
    id: "E1M-NX9101",
    displayName: "E1M-NX9101 (NXP i.MX 93)",
    family: "nxp-imx9",
  },
];

const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "blank-app",
    title: "Blank Application",
    description:
      "Minimal starter with CMakeLists.txt, prj.conf, board.yaml, and an empty main.c",
    category: "starter",
    icon: "📄",
  },
  {
    id: "gpio-button-led",
    title: "GPIO Peripheral",
    description:
      "Button input and LED output using board.yaml pin allocation and the peripheral block helper",
    category: "example",
    icon: "🔘",
    sourceDir: "gpio-button-led",
  },
  {
    id: "lvgl-widgets",
    title: "LVGL UI Application",
    description:
      "Touchscreen UI with LVGL widgets, animations, and theme support",
    category: "example",
    icon: "🖥️",
    sourceDir: "lvgl-widgets-demo",
  },
  {
    id: "iot-dashboard",
    title: "IoT Dashboard",
    description:
      "Connected device with sensor data aggregation and cloud reporting",
    category: "example",
    icon: "🌐",
    sourceDir: "iot-dashboard",
  },
  {
    id: "ai-object-detection",
    title: "AI Object Detection",
    description:
      "Real-time object detection pipeline using the DRP-AI3 or Ethos-U55 accelerator",
    category: "example",
    icon: "🤖",
    sourceDir: "ai-object-detection-realtime",
  },
  {
    id: "audio-loopback",
    title: "Audio Processing",
    description: "I2S audio capture and playback with PDM microphone support",
    category: "example",
    icon: "🎵",
    sourceDir: "audio-loopback",
  },
];

// ---------------------------------------------------------------------------
// Panel class
// ---------------------------------------------------------------------------

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
      templates: PROJECT_TEMPLATES,
      modules: E1M_MODULES,
    };
    void this.panel.webview.postMessage(catalogMsg);
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

    try {
      fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, "board.yaml"),
        generateBoardYaml(moduleId, projectName),
      );
      fs.writeFileSync(
        path.join(projectDir, "CMakeLists.txt"),
        generateCMakeLists(projectName),
      );
      fs.writeFileSync(
        path.join(projectDir, "prj.conf"),
        "# Kconfig fragments — add CONFIG_* entries here.\n",
      );
      fs.writeFileSync(
        path.join(projectDir, "src", "main.c"),
        generateMainC(templateId),
      );
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Failed to create project: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const open = "Open Project";
    const choice = await vscode.window.showInformationMessage(
      `Project "${projectName}" created at ${projectDir}`,
      open,
    );
    if (choice === open) {
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(projectDir),
      );
    }

    this.panel.dispose();
  }

  private dispose(): void {
    NewProjectFlowPanel.instance = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

// ---------------------------------------------------------------------------
// File generators
// ---------------------------------------------------------------------------

function generateBoardYaml(moduleId: string, projectName: string): string {
  return `# board.yaml — ALP SDK project configuration (schema v2)
# Generated by ALP IDE for project: ${projectName}
#
# Edit this file to configure hardware peripherals, build targets,
# and project-level settings.  See docs/board-config.md for the schema.

schema_version: 2

som:
  sku: ${moduleId}

project:
  name: ${projectName}
  version: "0.1.0"
`;
}

function generateCMakeLists(projectName: string): string {
  return `cmake_minimum_required(VERSION 3.20)

# ALP SDK project — generated by ALP IDE.
# alp_project.py reads board.yaml and generates all build configuration.
# Do not add CONFIG_* here; put Kconfig knobs in prj.conf.

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(${projectName})

target_sources(app PRIVATE src/main.c)
`;
}

function generateMainC(templateId: string): string {
  if (templateId === "blank-app") {
    return `#include <zephyr/kernel.h>

int main(void)
{
\tprintk("Hello from ${templateId}\\n");
\treturn 0;
}
`;
  }
  // For example-based templates, generate a stub referencing the source
  return `#include <zephyr/kernel.h>

/* TODO: Copy the full implementation from alp-sdk-upstream/examples/${templateId}/ */

int main(void)
{
\tprintk("${templateId} stub — replace with example implementation\\n");
\treturn 0;
}
`;
}
