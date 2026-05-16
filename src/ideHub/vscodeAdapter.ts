// SPDX-License-Identifier: Apache-2.0

import {
    checkSdkReadiness,
    listLocalSdkEntries,
    resolveActiveSdk,
} from "@alp-sdk/core/sdk/service";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { AlpIdeState } from "./messages";

function commandAvailable(cmd: string): boolean {
  try {
    cp.execSync(`${cmd} --version`, { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Run `cmd --version` and return the first line of stdout, or null on error. */
function commandVersion(cmd: string): string | null {
  try {
    const out = cp.execSync(`${cmd} --version`, {
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
  const workspaceRoot = workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const actualWorkspaceRoot: string | null =
    workspaceFolders?.[0]?.uri.fsPath ?? null;

  const sdkPath = resolveActiveSdk(
    workspaceRoot,
    (p) => fs.existsSync(p),
    (p) => fs.readFileSync(p, "utf8"),
  );

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

  const localEntries = listLocalSdkEntries(
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

  const boardYamlPath = actualWorkspaceRoot
    ? path.join(actualWorkspaceRoot, "board.yaml")
    : null;

  const pyCmd = pythonCmd();
  const pythonAvailable = commandAvailable(pyCmd);
  const westAvailable = commandAvailable("west");

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
        west: westAvailable ? commandVersion("west") : null,
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
