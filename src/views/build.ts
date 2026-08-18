// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
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
    // The orchestrator flash (`tan flash`), not plain `west flash`: west lives
    // in the bootstrap venv, so `alp.westFlash` dies before it can say why.
    // That command stays in the palette for the explicit single-image case;
    // no UI surface routes to it.
    label: "Flash device",
    description: "flash every slice onto the device",
    icon: "zap",
    command: "alp.westAlpFlash",
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
    const { workspaceRoot, boardYamlExists, westInitialized } = state.workspace;
    const { bootstrapRunning } = state.setup;
    // Gate on the OPEN project, not just the shared ~/zephyrproject workspace:
    // west commands run in the project folder, so they need a board.yaml too —
    // and never while a bootstrap is still populating that workspace.
    // `.west/config` is written at the START of `tan bootstrap`, so
    // `westInitialized` alone goes true minutes before the module tree is
    // fetched and these rows would launch a build over half of it.
    const enabled = westInitialized && boardYamlExists && !bootstrapRunning;

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
      if (bootstrapRunning) {
        // Checked FIRST: mid-run the on-disk answers below are whatever the
        // half-finished bootstrap has written so far, so they would offer
        // "install build dependencies" for the install that is already
        // running, or claim the board.yaml is missing. The only correct
        // action is to wait; the Hub shows the run's progress.
        cta = new BuildItem(
          "Bootstrapping…",
          "workspace is still being set up",
          new vscode.ThemeIcon("sync"),
          { command: "alp.openHub", title: "Open Hub" },
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
      } else if (!westInitialized) {
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
