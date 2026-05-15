// SPDX-License-Identifier: Apache-2.0

import { checkSdkReadiness, resolveActiveSdk } from "@alp-sdk/core/sdk/service";
import * as cp from "child_process";
import * as fs from "fs";
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

function pythonCmd(): string {
  return process.platform === "win32" ? "python" : "python3";
}

export async function queryAlpIdeState(): Promise<AlpIdeState> {
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

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

  return {
    sdk: {
      activePath: sdkPath,
      version: sdkVersion,
      readiness: sdkReadiness,
    },
    setup: {
      pythonAvailable: commandAvailable(pythonCmd()),
      westAvailable: commandAvailable("west"),
      workspaceOpen: (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
    },
  };
}
