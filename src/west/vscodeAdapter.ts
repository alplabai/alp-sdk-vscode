// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { collectProjectContext } from "../project/vscodeAdapter";
import {
  WestCommandPlan,
  WestWorkspaceContext,
} from "@alp-sdk/core/west/models";

export function collectWestWorkspaceContext(): WestWorkspaceContext {
  return collectProjectContext();
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

/** Quote a path for the shell only when it contains whitespace. */
function quoteIfNeeded(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
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

  // Prefer the workspace venv's west over PATH (hermetic; see findWorkspaceVenvWest).
  const venvWest = findWorkspaceVenvWest(plan.westCwd);
  const command =
    venvWest && /^\s*west\b/.test(plan.command)
      ? plan.command.replace(/^(\s*)west\b/, `$1${quoteIfNeeded(venvWest)}`)
      : plan.command;
  terminal.sendText(command);
}
