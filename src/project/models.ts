// SPDX-License-Identifier: Apache-2.0

export interface ProjectSettings {
  sdkPath: string;
  pythonPath: string;
  boardYamlPath: string;
  westCwd: string;
}

export interface ProjectResolutionInput {
  workspaceFolders: readonly string[];
  settings: ProjectSettings;
  platform: NodeJS.Platform;
}

export interface ProjectContext {
  workspaceRoot: string | null;
  sdkRoot: string | null;
  boardYamlPath: string | null;
  westCwd: string | null;
  pythonBinary: string;
}
