// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";

const OUTPUT = vscode.window.createOutputChannel("Alp SDK");

export type LogLevel = "info" | "warn" | "error";

/** Append a timestamped, leveled line to the shared "Alp SDK" output channel.
 *  Existing callers pass just a message (level defaults to "info"), so the
 *  channel gains triage-grade prefixes without touching every call site. */
export function log(line: string, level: LogLevel = "info"): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm (UTC)
  OUTPUT.appendLine(`[${ts}] [${level}] ${line}`);
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

const SHOW_OUTPUT = "Show Output";

/** Report a diagnosable failure: log the full detail to the "Alp SDK" channel
 *  AND show an error toast that always offers "Show Output" (plus any caller
 *  actions). Picking "Show Output" reveals the channel and returns undefined;
 *  otherwise the picked caller action is returned. The house pattern for every
 *  error toast tied to a failure the channel can explain.
 *
 *  Do not pass a caller action literally titled "Show Output" — that title is
 *  reserved for the appended house action and would be indistinguishable. */
export async function reportError(
  message: string,
  detail?: string,
  ...actions: string[]
): Promise<string | undefined> {
  log(detail ? `${message} — ${detail}` : message, "error");
  const pick = await vscode.window.showErrorMessage(
    message,
    ...actions,
    SHOW_OUTPUT,
  );
  if (pick === SHOW_OUTPUT) {
    showOutput();
    return undefined;
  }
  return pick;
}
