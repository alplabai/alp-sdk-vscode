// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";

const OUTPUT = vscode.window.createOutputChannel("Alp SDK");

export function log(line: string): void {
  OUTPUT.appendLine(line);
}

export function showOutput(): void {
  OUTPUT.show(true);
}

/**
 * Launch `argv` in a dedicated integrated terminal, running the executable
 * directly via `shellPath`/`shellArgs` (no intermediate shell). VS Code passes
 * the args to the OS as an argv array, so a path containing whitespace never has
 * to be quoted — sidestepping the per-shell quoting that broke PowerShell (which
 * parses a leading quoted token in expression mode). Any prior terminal of the
 * same name is disposed so a re-run reuses one named slot instead of piling up.
 */
export function runInTerminal(options: {
  name: string;
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
}): void {
  vscode.window.terminals
    .find((terminal) => terminal.name === options.name)
    ?.dispose();
  const terminal = vscode.window.createTerminal({
    name: options.name,
    cwd: options.cwd,
    env: options.env,
    shellPath: options.argv[0],
    shellArgs: options.argv.slice(1),
  });
  // Capture the command's outcome: a terminal-backed command used to run with
  // its exit code vanishing when the terminal closed. Log it via a one-shot,
  // self-disposing listener so success/failure lands in the "Alp SDK" channel.
  const sub = vscode.window.onDidCloseTerminal((closed) => {
    if (closed !== terminal) return;
    const code = closed.exitStatus?.code;
    log(`[terminal] "${options.name}" exited (code=${code ?? "unknown"})`);
    sub.dispose();
  });
  terminal.show(true);
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
