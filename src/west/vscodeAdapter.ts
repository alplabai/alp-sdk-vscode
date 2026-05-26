// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
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

export function tasksJsonPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".vscode", "tasks.json");
}

export function readTasksJson(workspaceRoot: string): string | null {
  const filePath = tasksJsonPath(workspaceRoot);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

export function writeTasksJson(workspaceRoot: string, content: string): string {
  const filePath = tasksJsonPath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}
