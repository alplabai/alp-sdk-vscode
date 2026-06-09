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
 * The `west` to probe for readiness: prefer a bootstrap venv
 * (`<workspace>/.venv/bin/west`) over PATH — matching how builds run west.
 * `alp bootstrap` installs west into a venv, not globally, so a PATH-only probe
 * would wrongly report west missing. We look (in order) at: the open project's
 * west cwd (walking up), then — so it also works with no folder open — a venv
 * beside ZEPHYR_BASE (env var; shell-agnostic), the SDK's default isolated
 * workspace (`<sdk-parent>/zephyrproject`), and the conventional `~/zephyrproject`.
 */
function resolveWestBinary(
  westCwd: string | null,
  sdkRoot: string | null,
): string {
  const rel =
    process.platform === "win32"
      ? path.join("Scripts", "west.exe")
      : path.join("bin", "west");
  const venvWest = (workspaceDir: string): string =>
    path.join(workspaceDir, ".venv", rel);

  // 1) Walk up from the open project's west cwd.
  let dir = westCwd;
  while (dir) {
    const candidate = venvWest(dir);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2) Known bootstrap-workspace locations, usable with no folder open.
  const workspaces: string[] = [];
  const zephyrBase = process.env.ZEPHYR_BASE;
  if (zephyrBase) workspaces.push(path.dirname(zephyrBase)); // reused workspace
  if (sdkRoot)
    workspaces.push(path.join(path.dirname(sdkRoot), "zephyrproject"));
  workspaces.push(path.join(os.homedir(), "zephyrproject")); // Zephyr convention

  for (const workspaceDir of workspaces) {
    const candidate = venvWest(workspaceDir);
    if (fs.existsSync(candidate)) return candidate;
  }
  return "west";
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
      westInitialized: actualWorkspaceRoot
        ? fs.existsSync(path.join(actualWorkspaceRoot, ".west"))
        : false,
    },
  };
}
