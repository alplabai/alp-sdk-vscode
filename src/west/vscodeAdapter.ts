// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
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

export function executeWestPlan(plan: WestCommandPlan): void {
  // No "still running" pre-check here on purpose. `runInTerminal` refuses a
  // live run under the same terminal name itself (issue #146: never terminate
  // a flash mid-write to start a fresh one) with the byte-identical warning
  // and the same "Show Terminal" action, so a second copy of that toast in
  // this file only ever meant two places to keep in sync.

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
}
