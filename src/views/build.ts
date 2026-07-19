// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { derivePhase } from "../ideHub/phase";
import type { AlpIdeState } from "../ideHub/messages";
import type { StateManager } from "./stateManager";

class BuildItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: vscode.ThemeIcon,
    command: vscode.Command,
    enabled = true,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = enabled ? description : "workspace not initialized";
    this.iconPath = icon;
    this.command = enabled ? command : undefined;
    this.contextValue = enabled ? "build-item" : "build-item-disabled";
    if (!enabled) {
      this.tooltip = "Initialize your workspace first";
    }
  }
}

const BUILD_ACTIONS: Array<{
  label: string;
  description: string;
  icon: string;
  command: string;
}> = [
  {
    label: "Build",
    description: "validate + generate + build",
    icon: "play",
    command: "alp.westBuild",
  },
  {
    label: "Flash device (west)",
    description: "flash connected device",
    icon: "zap",
    command: "alp.westFlash",
  },
  {
    label: "Run (native_sim)",
    description: "simulate under native_sim",
    icon: "debug-start",
    command: "alp.westRunNativeSim",
  },
  {
    label: "Image",
    description: "assemble image bundle",
    icon: "package",
    command: "alp.westAlpImage",
  },
  {
    label: "Flash",
    description: "flash all slices",
    icon: "rocket",
    command: "alp.westAlpFlash",
  },
  {
    label: "Debug",
    description: "generate profile + start a debug session",
    icon: "debug-alt",
    command: "alp.debug",
  },
  {
    label: "Renode",
    description: "simulate in Renode",
    icon: "beaker",
    command: "alp.westAlpRenode",
  },
  {
    label: "Update modules (west)",
    description: "fetch & update modules",
    icon: "sync",
    command: "alp.westUpdate",
  },
  {
    label: "Clean",
    description: "remove build directory",
    icon: "trash",
    command: "alp.westAlpClean",
  },
];

export class BuildTreeProvider
  implements vscode.TreeDataProvider<BuildItem>, vscode.Disposable
{
  private readonly _emitter = new vscode.EventEmitter<
    BuildItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._emitter.event;
  private items: BuildItem[] = [];

  constructor(stateMgr: StateManager) {
    stateMgr.onStateChange((s) => this.updateItems(s));
    this.updateItems(stateMgr.state);
  }

  private updateItems(state: AlpIdeState): void {
    const { workspaceRoot } = state.workspace;
    // Gate on the full ladder phase (single source of truth), not just
    // westInitialized && boardYamlExists — an invalid board.yaml must not
    // silently look like "no project".
    const phase = derivePhase(state);
    const enabled = phase === "ready";

    // "Preview Build Plan" stays available even before west init — the view
    // explains its own empty/error states (no SDK, no board.yaml, …).
    const previewPlan = new BuildItem(
      "Preview Build Plan",
      "inspect the SDK build plan",
      new vscode.ThemeIcon("list-tree"),
      { command: "alp.showBuildPlan", title: "Preview Build Plan" },
      true,
    );

    if (enabled) {
      this.items = [
        previewPlan,
        ...BUILD_ACTIONS.map(
          (a) =>
            new BuildItem(
              a.label,
              a.description,
              new vscode.ThemeIcon(a.icon),
              { command: a.command, title: a.label },
              true,
            ),
        ),
      ];
    } else {
      // No buildable project: one actionable call-to-action instead of eight
      // inert (or misleading, home-dir) build rows.
      let cta: BuildItem;
      if (phase === "invalid-board") {
        cta = new BuildItem(
          "board.yaml has issues",
          "resolve to build",
          new vscode.ThemeIcon("warning"),
          { command: "alp.openConfigurator", title: "Open Board Configurator" },
          true,
        );
      } else if (!workspaceRoot) {
        cta = new BuildItem(
          "No project open",
          "create or open a project",
          new vscode.ThemeIcon("new-folder"),
          { command: "alp.newProjectWizard", title: "New Project" },
          true,
        );
      } else if (phase === "no-env") {
        cta = new BuildItem(
          "Workspace not initialized",
          "install build dependencies",
          new vscode.ThemeIcon("cloud-download"),
          { command: "alp.installDependencies", title: "Install Dependencies" },
          true,
        );
      } else {
        cta = new BuildItem(
          "No board.yaml in this folder",
          "create or open an Alp project",
          new vscode.ThemeIcon("new-folder"),
          { command: "alp.newProjectWizard", title: "New Project" },
          true,
        );
      }
      this.items = [previewPlan, cta];
    }

    this._emitter.fire(undefined);
  }

  getTreeItem(element: BuildItem): BuildItem {
    return element;
  }

  getChildren(element?: BuildItem): BuildItem[] {
    if (element) return [];
    return this.items;
  }

  dispose(): void {
    this._emitter.dispose();
  }
}
