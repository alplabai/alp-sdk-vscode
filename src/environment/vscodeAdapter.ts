// SPDX-License-Identifier: Apache-2.0
//
// Single source of truth for locating the bootstrap Python venv and the tools
// inside it (west, python). `alp bootstrap` installs west + Zephyr's Python deps
// into a venv inside the shared/central Zephyr workspace, NOT globally — so every
// readiness surface (Overview, sidebar, Setup wizard, Toolchain Doctor) must look
// there, not just on PATH / in the system Python. Both src/ideHub and src/toolchain
// adapters consume this so a detection fix lives in exactly one place.

import {
  inspectWestManifest,
  WestManifestStatus,
} from "@alp-sdk/core/sdk/service";
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
 * The venv `west` INSIDE one specific topdir, or null if it is not there.
 *
 * Deliberately NOT `resolveWestBinary`: that scans the whole
 * `westWorkspaceCandidates` list independently of any resolved topdir, so it
 * can pair one candidate's venv with a DIFFERENT candidate's topdir — e.g. an
 * ambient `$ZEPHYR_BASE` workspace's venv `west` reported as usable while the
 * `.west` topdir a caller actually resolved (`westWorkspaceTopdir`) has no
 * venv of its own. A caller that already resolved a topdir and needs the
 * `west` THAT topdir owns — not merely a `west` somewhere in the candidate
 * list — calls this on that topdir, never on a candidate of its own.
 */
export function venvWestInTopdir(topdir: string): string | null {
  const candidate = path.join(topdir, venvRelative("west"));
  return fs.existsSync(candidate) ? candidate : null;
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

/** Throw-safe file reader for the pure inspectors (same shape as activeSdk.ts). */
function readTextOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/** Classify one candidate topdir's `.west/config` manifest pointer. */
function manifestStatus(workspaceDir: string): WestManifestStatus {
  return inspectWestManifest(
    workspaceDir,
    (p) => fs.existsSync(p),
    readTextOrEmpty,
  );
}

/**
 * The first candidate topdir that counts as an initialized west workspace, or
 * null when none does — the shared bootstrap workspace, not necessarily the
 * open folder.
 *
 * A `.west` directory alone is NOT enough. west reads `.west/config`'s own
 * `[manifest] path` directly, so a workspace whose manifest names a directory
 * that no longer exists is broken, not initialized — reporting it as ready is
 * what let an ambient `$ZEPHYR_BASE` pointing at an unrelated Zephyr checkout
 * satisfy this probe while the real SDK workspace stayed silently stranded
 * (issue #349). A `dangling` candidate is skipped; the next candidate still
 * gets its chance, so a legitimate `$ZEPHYR_BASE` workspace is demoted, never
 * disqualified. `unparsable` still counts — never demote on parse ambiguity:
 * a config this extension cannot parse is not evidence west cannot either.
 */
export function westWorkspaceTopdir(
  westCwd: string | null,
  sdkRoot: string | null,
  // Candidate list; overridable so a test can pin it. In production the derived
  // list is correct (same injection idiom as the `p` parameter on the pure
  // services). Kept lazy: `.find` short-circuits before reading every config.
  candidates: string[] = westWorkspaceCandidates(westCwd, sdkRoot),
): string | null {
  return (
    candidates.find((workspaceDir) => {
      const state = manifestStatus(workspaceDir).state;
      return state === "ok" || state === "unparsable";
    }) ?? null
  );
}

/**
 * Whether an initialized west workspace exists. Same acceptance rule as
 * {@link westWorkspaceTopdir} — re-expressed in terms of it, one loop, so the
 * two can never drift apart.
 */
export function westWorkspaceInitialized(
  westCwd: string | null,
  sdkRoot: string | null,
  candidates: string[] = westWorkspaceCandidates(westCwd, sdkRoot),
): boolean {
  return westWorkspaceTopdir(westCwd, sdkRoot, candidates) !== null;
}

/**
 * The west topdirs this extension's own SDK owns: the SDK's parent (the v0.11
 * bootstrap topdir) and its legacy isolated `zephyrproject` sibling.
 *
 * Deliberately NOT the full `westWorkspaceCandidates` list. That list exists to
 * FIND a usable workspace and reaches every ancestor of the project, an ambient
 * `$ZEPHYR_BASE`, and `~/zephyrproject` — so a stale Zephyr tutorial checkout
 * left in a home directory would fire "builds and flashes will use the wrong
 * workspace" on every SDK switch, uninstall and Doctor run. That assertion
 * would be false: west never resolves that topdir for this project, and the
 * extension did not invalidate it. Only the SDK's own topdir is broken by
 * switching or removing an SDK, so only it is reported.
 */
function sdkOwnedTopdirs(sdkRoot: string | null): string[] {
  if (!sdkRoot) return [];
  const parent = path.dirname(sdkRoot);
  return [parent, path.join(parent, "zephyrproject")];
}

/**
 * The first SDK-owned workspace whose `.west/config` manifest points at a
 * directory that no longer exists, or null when none does. Drives the
 * "your workspace is broken" warning after an SDK switch/uninstall and the
 * Toolchain Doctor's bootstrap offer.
 *
 * `sdkRoot` is the SDK whose activation/removal is in question — the one just
 * activated, or the one just deleted — not necessarily the resolved active SDK.
 */
export function danglingWestManifest(
  sdkRoot: string | null,
): WestManifestStatus | null {
  for (const workspaceDir of sdkOwnedTopdirs(sdkRoot)) {
    const status = manifestStatus(workspaceDir);
    if (status.state === "dangling") return status;
  }
  return null;
}
