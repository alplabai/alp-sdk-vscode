// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";

const OUTPUT = vscode.window.createOutputChannel("Alp SDK");

export function log(line: string): void {
  OUTPUT.appendLine(line);
}

export function showOutput(): void {
  OUTPUT.show(true);
}

/** Show an info/warn message tied to a follow-up action. */
export async function offerAction(
  message: string,
  action: string,
  severity: "info" | "warn" = "info",
): Promise<boolean> {
  const show =
    severity === "warn"
      ? vscode.window.showWarningMessage
      : vscode.window.showInformationMessage;
  const pick = await show(message, action);
  return pick === action;
}
