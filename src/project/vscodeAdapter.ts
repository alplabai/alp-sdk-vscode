// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  ProjectContext,
  ProjectResolutionInput,
  ProjectSettings,
} from "@alp-sdk/core/project/models";
import { resolveProjectContext } from "@alp-sdk/core/project/service";

export function collectProjectContext(): ProjectContext {
  return resolveProjectContext(createResolutionInput(), fs.existsSync);
}

function createResolutionInput(): ProjectResolutionInput {
  return {
    workspaceFolders: workspaceFolderPaths(),
    settings: readProjectSettings(),
    platform: process.platform,
    installedSdkRoots: installedSdkRoots(),
  };
}

/**
 * SDK installs under the ~/.alp/sdk cache, newest version first (best-effort
 * numeric sort on the version-named dirs). Lowest-precedence fallback for SDK
 * resolution — see resolveProjectContext in @alp-sdk/core.
 */
function installedSdkRoots(): string[] {
  const cacheRoot = path.join(os.homedir(), ".alp", "sdk");
  let names: string[];
  try {
    names = fs.readdirSync(cacheRoot);
  } catch {
    return [];
  }
  return names
    .map((name) => path.join(cacheRoot, name))
    .filter((candidate) => {
      try {
        return fs.statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) =>
      path.basename(b).localeCompare(path.basename(a), undefined, {
        numeric: true,
      }),
    );
}

function readProjectSettings(): ProjectSettings {
  // Resource-scoped so a multi-root folder's .vscode/settings.json can override
  // boardYamlPath; falls back to window scope when no editor is active.
  const config = vscode.workspace.getConfiguration(
    "alpSdk",
    vscode.window.activeTextEditor?.document.uri,
  );
  return {
    sdkPath: config.get<string>("path", ""),
    pythonPath: config.get<string>("pythonPath", ""),
    boardYamlPath: config.get<string>("boardYamlPath", "board.yaml"),
    westCwd: config.get<string>("westCwd", ""),
  };
}

function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map(
    (folder) => folder.uri.fsPath,
  );
}
