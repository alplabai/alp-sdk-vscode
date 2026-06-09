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
  /**
   * SDK installs found in the local cache (~/.alp/sdk/<version>), newest first.
   * Lowest-precedence fallback so an installed-but-not-active SDK still resolves
   * when no alpSdk.path / sibling SDK applies (e.g. right after `alp sdk install`,
   * with no workspace open). Optional — callers that don't surface the cache omit it.
   */
  installedSdkRoots?: readonly string[];
}

export interface ProjectContext {
  workspaceRoot: string | null;
  sdkRoot: string | null;
  boardYamlPath: string | null;
  westCwd: string | null;
  pythonBinary: string;
}
