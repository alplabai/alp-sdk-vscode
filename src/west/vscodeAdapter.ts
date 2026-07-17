// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { collectProjectContext } from "../project/vscodeAdapter";
import { runInTerminal } from "../util";
import {
  WestCommandPlan,
  WestWorkspaceContext,
} from "@alp-sdk/core/west/models";

export function collectWestWorkspaceContext(): WestWorkspaceContext {
  return collectProjectContext();
}

/** True when the project already carries the native_sim GPIO overlay that
 *  `alp generate --target native-sim-overlay` writes, so a native_sim run can
 *  skip regenerating it. */
export function nativeSimOverlayExists(workspaceRoot: string): boolean {
  return fs.existsSync(
    path.join(workspaceRoot, "boards", "native_sim_native_64.overlay"),
  );
}

/**
 * Locate the `west` from the workspace's bootstrap venv (`<dir>/.venv/bin/west`,
 * searched from the west cwd upward). `alp bootstrap` installs west into a venv
 * rather than globally, so the plain-west commands must run that hermetic west
 * — not whatever (possibly broken) west happens to be on PATH. Returns
 * undefined when no venv is found, in which case we fall back to PATH `west`.
 */
function findWorkspaceVenvWest(
  westCwd: string | null | undefined,
): string | undefined {
  if (!westCwd) return undefined;
  const rel =
    process.platform === "win32"
      ? path.join("Scripts", "west.exe")
      : path.join("bin", "west");
  let dir = westCwd;
  for (;;) {
    const candidate = path.join(dir, ".venv", rel);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * West terminal names whose spawned command is still executing, keyed to the
 * terminal identity. runInTerminal disposes a same-named terminal before
 * recreating it, so without this a second invocation would KILL a still-running
 * `west build`/`flash` mid-run (interrupting a flash — issue #146). We warn and
 * leave the running terminal alone instead. Cleared when the command's shell
 * execution ends or the terminal closes.
 * ponytail: the end event needs terminal shell integration; with it off a name
 * stays in-flight until the terminal closes — the safe degraded mode (warn
 * rather than kill a live run).
 */
const inFlightTerminals = new Map<string, vscode.Terminal>();
let terminalTrackingReady = false;

function ensureTerminalTracking(): void {
  if (terminalTrackingReady) return;
  terminalTrackingReady = true;
  const clear = (terminal: vscode.Terminal): void => {
    // Identity check: a disposed same-named terminal's close event must not
    // clear a fresh run's flag.
    if (inFlightTerminals.get(terminal.name) === terminal) {
      inFlightTerminals.delete(terminal.name);
    }
  };
  vscode.window.onDidEndTerminalShellExecution((event) =>
    clear(event.terminal),
  );
  vscode.window.onDidCloseTerminal((terminal) => clear(terminal));
}

export function executeWestPlan(plan: WestCommandPlan): void {
  ensureTerminalTracking();

  // A previous run from this plan is still executing. runInTerminal would
  // dispose that terminal to recreate it, killing the live command — so warn
  // and reveal it instead of interrupting it (issue #146).
  const running = inFlightTerminals.get(plan.terminalName);
  if (running) {
    void vscode.window
      .showWarningMessage(
        `"${plan.terminalName}" is still running — wait for it to finish before starting it again.`,
        "Show Terminal",
      )
      .then((choice) => {
        if (choice === "Show Terminal") running.show();
      });
    return;
  }

  // Prefer the workspace venv's west over PATH (hermetic; see findWorkspaceVenvWest).
  const venvWest = findWorkspaceVenvWest(plan.westCwd);
  const argv =
    venvWest && plan.args[0] === "west"
      ? [venvWest, ...plan.args.slice(1)]
      : plan.args;
  runInTerminal({
    name: plan.terminalName,
    argv,
    cwd: plan.westCwd ?? undefined,
    env: plan.env,
  });

  // runInTerminal just (re)created the terminal with this name; track it as
  // in-flight so a repeat invocation warns instead of killing it.
  const created = vscode.window.terminals.find(
    (terminal) => terminal.name === plan.terminalName,
  );
  if (created) inFlightTerminals.set(plan.terminalName, created);
}
