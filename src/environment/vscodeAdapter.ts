// SPDX-License-Identifier: Apache-2.0
//
// Single source of truth for locating the bootstrap Python venv and the tools
// inside it (west, python). `alp bootstrap` installs west + Zephyr's Python deps
// into a venv inside the shared/central Zephyr workspace, NOT globally — so every
// readiness surface (Overview, sidebar, Setup wizard, Toolchain Doctor) must look
// there, not just on PATH / in the system Python. Both src/ideHub and src/toolchain
// adapters consume this so a detection fix lives in exactly one place.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Candidate Zephyr-workspace dirs, most specific first — used to locate the
 * bootstrap venv and the `.west` marker with or without a folder open. The west
 * workspace is shared/central (Zephyr's model: the SDK injects itself via
 * EXTRA_ZEPHYR_MODULES), so it usually lives outside the open project:
 *   1. the open project's west cwd + its ancestors,
 *   2. the workspace beside ZEPHYR_BASE (env var; shell-agnostic, not an rc file),
 *   3. the SDK's parent (`<sdk-parent>`, the v0.11 bootstrap topdir) and its
 *      legacy isolated workspace (`<sdk-parent>/zephyrproject`),
 *   4. the conventional `~/zephyrproject`.
 */
export function westWorkspaceCandidates(
  westCwd: string | null,
  sdkRoot: string | null,
): string[] {
  const candidates: string[] = [];
  let dir = westCwd;
  while (dir) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const zephyrBase = process.env.ZEPHYR_BASE;
  if (zephyrBase) candidates.push(path.dirname(zephyrBase));
  if (sdkRoot) {
    const sdkParent = path.dirname(sdkRoot);
    candidates.push(sdkParent);
    candidates.push(path.join(sdkParent, "zephyrproject"));
  }
  candidates.push(path.join(os.homedir(), "zephyrproject"));
  return candidates;
}

/** Relative path of a venv executable (`.venv/bin/<name>`, `Scripts\<name>.exe`). */
function venvRelative(name: string): string {
  return process.platform === "win32"
    ? path.join(".venv", "Scripts", `${name}.exe`)
    : path.join(".venv", "bin", name);
}

function firstVenvBinary(
  name: string,
  westCwd: string | null,
  sdkRoot: string | null,
): string | null {
  const rel = venvRelative(name);
  for (const workspaceDir of westWorkspaceCandidates(westCwd, sdkRoot)) {
    const candidate = path.join(workspaceDir, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The `west` to use: the bootstrap venv's west if present, else `"west"` on PATH.
 * `alp bootstrap` installs west into a venv, not globally, so PATH-only would
 * wrongly report west missing.
 */
export function resolveWestBinary(
  westCwd: string | null,
  sdkRoot: string | null,
): string {
  return firstVenvBinary("west", westCwd, sdkRoot) ?? "west";
}

/** True when a bootstrap-venv `west` exists on disk (deterministic file check),
 *  as opposed to the bare "west" PATH fallback. west AVAILABILITY should key off
 *  this, NOT a `west --version` spawn — that probe can time out under load
 *  (Windows CPython cold-start) and wrongly flip the Environment card to
 *  "Missing" mid-session even though west is installed. */
export function venvWestExists(
  westCwd: string | null,
  sdkRoot: string | null,
): boolean {
  return firstVenvBinary("west", westCwd, sdkRoot) !== null;
}

/**
 * The bootstrap venv's Python (where Zephyr's Python deps were installed), or
 * null if no venv is found — callers fall back to the system interpreter.
 */
export function resolveVenvPython(
  westCwd: string | null,
  sdkRoot: string | null,
): string | null {
  return firstVenvBinary("python", westCwd, sdkRoot);
}

/**
 * Whether an initialized west workspace (a `.west` dir) exists — the shared
 * bootstrap workspace, not necessarily the open folder.
 */
export function westWorkspaceInitialized(
  westCwd: string | null,
  sdkRoot: string | null,
): boolean {
  return westWorkspaceCandidates(westCwd, sdkRoot).some((workspaceDir) =>
    fs.existsSync(path.join(workspaceDir, ".west")),
  );
}
