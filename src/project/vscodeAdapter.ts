// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
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
  };
}

function readProjectSettings(): ProjectSettings {
  const config = vscode.workspace.getConfiguration("alpSdk");
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
