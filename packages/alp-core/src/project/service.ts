// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { ProjectContext, ProjectResolutionInput } from "./models";

export function resolveProjectContext(
  input: ProjectResolutionInput,
  pathExists: (candidatePath: string) => boolean,
): ProjectContext {
  // Resolve all runtime inputs once so every surface reads the same project context.
  const workspaceRoot = resolveWorkspaceRoot(input.workspaceFolders);

  return {
    workspaceRoot,
    sdkRoot: resolveSdkRoot(
      input.workspaceFolders,
      input.settings.sdkPath,
      input.installedSdkRoots ?? [],
      pathExists,
    ),
    boardYamlPath: resolveBoardYamlPath(
      workspaceRoot,
      input.settings.boardYamlPath,
    ),
    westCwd: resolveWestCwd(workspaceRoot, input.settings.westCwd),
    pythonBinary: resolvePythonBinary(
      input.settings.pythonPath,
      input.platform,
    ),
  };
}

function resolveWorkspaceRoot(
  workspaceFolders: readonly string[],
): string | null {
  return workspaceFolders.length > 0 ? workspaceFolders[0]! : null;
}

function resolveSdkRoot(
  workspaceFolders: readonly string[],
  configuredSdkPath: string,
  installedSdkRoots: readonly string[],
  pathExists: (candidatePath: string) => boolean,
): string | null {
  // Prefer explicit SDK path, but only if it contains the loader entrypoint.
  const trimmedConfiguredPath = configuredSdkPath.trim();
  if (trimmedConfiguredPath) {
    return containsLoaderScript(trimmedConfiguredPath, pathExists)
      ? trimmedConfiguredPath
      : null;
  }

  // Auto-discovery is valid only when exactly one SDK root is detected.
  const candidates = collectSdkCandidates(workspaceFolders, pathExists);
  if (candidates.length === 1) {
    return candidates[0]!;
  }
  // Multiple sibling SDKs is ambiguous — require an explicit alpSdk.path.
  if (candidates.length > 1) {
    return null;
  }

  // Lowest precedence: an SDK installed in the local cache (~/.alp/sdk/<version>).
  // Lets the extension recognize + use an installed SDK with no workspace and no
  // alpSdk.path set (e.g. straight after `alp sdk install`, before activation).
  for (const installedRoot of installedSdkRoots) {
    const trimmed = installedRoot.trim();
    if (trimmed && containsLoaderScript(trimmed, pathExists)) {
      return trimmed;
    }
  }

  return null;
}

function collectSdkCandidates(
  workspaceFolders: readonly string[],
  pathExists: (candidatePath: string) => boolean,
): string[] {
  const candidates = new Set<string>();

  for (const workspaceFolder of workspaceFolders) {
    // Check both workspace root and the conventional sibling alp-sdk folder.
    if (containsLoaderScript(workspaceFolder, pathExists)) {
      candidates.add(workspaceFolder);
    }

    const siblingSdk = path.resolve(workspaceFolder, "..", "alp-sdk");
    if (containsLoaderScript(siblingSdk, pathExists)) {
      candidates.add(siblingSdk);
    }
  }

  return [...candidates];
}

function resolveBoardYamlPath(
  workspaceRoot: string | null,
  configuredBoardYamlPath: string,
): string | null {
  if (!workspaceRoot) return null;
  return path.isAbsolute(configuredBoardYamlPath)
    ? configuredBoardYamlPath
    : path.join(workspaceRoot, configuredBoardYamlPath);
}

function resolveWestCwd(
  workspaceRoot: string | null,
  configuredWestCwd: string,
): string | null {
  const trimmedWestCwd = configuredWestCwd.trim();
  if (trimmedWestCwd) return trimmedWestCwd;
  return workspaceRoot;
}

function resolvePythonBinary(
  configuredPythonPath: string,
  platform: NodeJS.Platform,
): string {
  const trimmedPythonPath = configuredPythonPath.trim();
  if (trimmedPythonPath) return trimmedPythonPath;
  return platform === "win32" ? "python" : "python3";
}

function containsLoaderScript(
  rootPath: string,
  pathExists: (candidatePath: string) => boolean,
): boolean {
  // scripts/alp_project.py is the canonical marker for an Alp SDK root.
  return pathExists(path.join(rootPath, "scripts", "alp_project.py"));
}
