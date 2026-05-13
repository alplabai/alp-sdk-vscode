// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { collectProjectContext } from "../project/vscodeAdapter";
import { WestCommandPlan, WestWorkspaceContext } from "./models";

export function collectWestWorkspaceContext(): WestWorkspaceContext {
  const project = collectProjectContext();
  return {
    westCwd: project.westCwd,
    sdkRoot: project.sdkRoot,
  };
}

export function executeWestPlan(plan: WestCommandPlan): void {
  const existing = vscode.window.terminals.find(
    (terminal) => terminal.name === plan.terminalName,
  );
  const terminal =
    existing ??
    vscode.window.createTerminal({
      name: plan.terminalName,
      cwd: plan.westCwd ?? undefined,
      env: plan.env,
    });
  terminal.show(true);
  terminal.sendText(plan.command);
}
