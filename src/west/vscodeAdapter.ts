// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { collectProjectContext } from "../project/vscodeAdapter";
import { WestCommandPlan, WestWorkspaceContext } from "@alp-sdk/core/west/models";

export function collectWestWorkspaceContext(): WestWorkspaceContext {
  return collectProjectContext();
}

export function executeWestPlan(plan: WestCommandPlan): void {
  const problemMatchers = plan.kind === "build" ? ["$alp-west"] : [];
  const task = new vscode.Task(
    { type: "alp-west", kind: plan.kind },
    vscode.TaskScope.Workspace,
    plan.terminalName,
    "alp",
    new vscode.ShellExecution(plan.command, {
      cwd: plan.westCwd ?? undefined,
      env: plan.env,
    }),
    problemMatchers,
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
  };
  void vscode.tasks.executeTask(task);
}
