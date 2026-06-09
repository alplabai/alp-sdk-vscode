// SPDX-License-Identifier: Apache-2.0

import {
  checkSdkReadiness,
  listLocalSdkEntries,
} from "@alp-sdk/core/sdk/service";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { collectProjectContext } from "../project/vscodeAdapter";
import type { AlpIdeState } from "./messages";

/**
 * Open a project folder without disrupting the user's current session: if a
 * workspace is already open, open in a NEW window; otherwise reuse the current
 * (empty) window. Used by the new- and existing-project flows.
 */
export async function openProjectFolder(uri: vscode.Uri): Promise<void> {
  const hasWorkspaceOpen = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  await vscode.commands.executeCommand("vscode.openFolder", uri, {
    forceNewWindow: hasWorkspaceOpen,
  });
}

function commandAvailable(cmd: string): boolean {
  try {
    // Quote so an absolute venv path (possibly with spaces) is one token.
    cp.execSync(`"${cmd}" --version`, { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Run `cmd --version` and return the first line of stdout, or null on error. */
function commandVersion(cmd: string): string | null {
  try {
    const out = cp.execSync(`"${cmd}" --version`, {
      stdio: "pipe",
      timeout: 3000,
    });
    return out.toString("utf8").trim().split("\n")[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Candidate Zephyr-workspace dirs, most specific first — used to locate both the
 * bootstrap venv and the `.west` marker with or without a folder open. The west
 * workspace is shared/central (Zephyr's model: the SDK injects itself via
 * EXTRA_ZEPHYR_MODULES), so it usually lives outside the open project:
 *   1. the open project's west cwd + its ancestors,
 *   2. the workspace beside ZEPHYR_BASE (env var; shell-agnostic, not an rc file),
 *   3. the SDK's default isolated workspace (`<sdk-parent>/zephyrproject`),
 *   4. the conventional `~/zephyrproject`.
 */
function westWorkspaceCandidates(
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
    candidates.push(path.join(path.dirname(sdkRoot), "zephyrproject"));
  }
  candidates.push(path.join(os.homedir(), "zephyrproject"));
  return candidates;
}

/**
 * The `west` to probe for readiness: prefer a bootstrap venv
 * (`<workspace>/.venv/bin/west`) over PATH — matching how builds run west.
 * `alp bootstrap` installs west into a venv, not globally, so a PATH-only probe
 * would wrongly report west missing.
 */
function resolveWestBinary(
  westCwd: string | null,
  sdkRoot: string | null,
): string {
  const rel =
    process.platform === "win32"
      ? path.join("Scripts", "west.exe")
      : path.join("bin", "west");
  for (const workspaceDir of westWorkspaceCandidates(westCwd, sdkRoot)) {
    const candidate = path.join(workspaceDir, ".venv", rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return "west";
}

/**
 * Whether an initialized west workspace (a `.west` dir) exists. Checks the shared
 * bootstrap workspace, not just the open folder — the Zephyr workspace is central
 * and the SDK builds against it via EXTRA_ZEPHYR_MODULES, so a project folder
 * need not contain `.west` itself.
 */
function westWorkspaceInitialized(
  westCwd: string | null,
  sdkRoot: string | null,
): boolean {
  return westWorkspaceCandidates(westCwd, sdkRoot).some((workspaceDir) =>
    fs.existsSync(path.join(workspaceDir, ".west")),
  );
}

function pythonCmd(): string {
  return process.platform === "win32" ? "python" : "python3";
}

/** Default directory for versioned SDK installations. */
export function sdkCacheRoot(): string {
  return path.join(os.homedir(), ".alp", "sdk");
}

export async function queryAlpIdeState(
  lastBootstrapAt: string | null = null,
): Promise<AlpIdeState> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const actualWorkspaceRoot: string | null =
    workspaceFolders?.[0]?.uri.fsPath ?? null;

  // Active SDK = the unified project/CLI resolution (alpSdk.path → sibling →
  // newest cache install), so the SDK Manager UI agrees with what `--sdk-root`
  // sends to the CLI.
  const projectContext = collectProjectContext();
  const sdkPath = projectContext.sdkRoot;

  let sdkReadiness: AlpIdeState["sdk"]["readiness"] = "unknown";
  let sdkVersion: string | null = null;

  if (sdkPath) {
    const report = checkSdkReadiness(
      sdkPath,
      (p) => fs.existsSync(p),
      (p) => {
        try {
          return fs.readFileSync(p, "utf8");
        } catch {
          return "";
        }
      },
    );
    sdkReadiness = report.state;
    sdkVersion = report.version;
  }

  const versionFile = sdkPath ? path.join(sdkPath, "VERSION") : null;
  if (versionFile && sdkVersion === null && fs.existsSync(versionFile)) {
    sdkVersion = fs.readFileSync(versionFile, "utf8").trim();
  }

  const cacheRoot = sdkCacheRoot();
  const searchRoots = [cacheRoot];
  if (actualWorkspaceRoot) searchRoots.push(actualWorkspaceRoot);

  const discoveredEntries = listLocalSdkEntries(
    searchRoots,
    (p) => fs.existsSync(p),
    (p) => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return "";
      }
    },
    (p) => {
      try {
        return fs.readdirSync(p);
      } catch {
        return [];
      }
    },
  );

  // Only Alp-installed SDKs (under the ~/.alp/sdk cache) are removable; external
  // SDKs (sibling checkouts / Browse) are the user's own folders.
  const cacheRootResolved = path.resolve(cacheRoot);
  const localEntries = discoveredEntries.map((entry) => ({
    ...entry,
    removable: path
      .resolve(entry.path)
      .startsWith(cacheRootResolved + path.sep),
  }));

  const boardYamlPath = actualWorkspaceRoot
    ? path.join(actualWorkspaceRoot, "board.yaml")
    : null;

  const pyCmd = pythonCmd();
  const westBin = resolveWestBinary(
    projectContext.westCwd,
    projectContext.sdkRoot,
  );
  const pythonAvailable = commandAvailable(pyCmd);
  const westAvailable = commandAvailable(westBin);

  return {
    sdk: {
      activePath: sdkPath,
      version: sdkVersion,
      readiness: sdkReadiness,
      localEntries,
    },
    setup: {
      pythonAvailable,
      westAvailable,
      lastBootstrapAt,
      toolVersions: {
        python: pythonAvailable ? commandVersion(pyCmd) : null,
        west: westAvailable ? commandVersion(westBin) : null,
        cmake: commandVersion("cmake"),
        ninja: commandVersion("ninja"),
      },
    },
    workspace: {
      workspaceRoot: actualWorkspaceRoot,
      boardYamlExists: boardYamlPath ? fs.existsSync(boardYamlPath) : false,
      westInitialized: westWorkspaceInitialized(
        projectContext.westCwd,
        projectContext.sdkRoot,
      ),
    },
  };
}
