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
import {
  resolveWestBinary,
  westWorkspaceInitialized,
} from "../environment/vscodeAdapter";
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
  if (actualWorkspaceRoot) {
    searchRoots.push(actualWorkspaceRoot);
    // The documented sibling layout: an SDK checked out next to the project.
    searchRoots.push(path.resolve(actualWorkspaceRoot, "..", "alp-sdk"));
  }
  // Always include the resolved active SDK so the picker and SDK Manager list
  // the SDK the extension is actually driving, even when it lives outside the
  // cache and workspace (sibling checkout or an alpSdk.path pin). Seeding it as
  // a root keeps localEntries in step with the resolution chain; listLocalSdkEntries
  // de-dupes via its `seen` set and the removable flag below keys off the cache
  // prefix, so an external checkout lands as non-removable.
  if (sdkPath) searchRoots.push(sdkPath);

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
