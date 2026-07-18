// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { ProjectContext, ProjectResolutionInput } from "./models";
import { toPosix } from "../paths";

export function resolveProjectContext(
  input: ProjectResolutionInput,
  pathExists: (candidatePath: string) => boolean,
): ProjectContext {
  // Resolve all runtime inputs once so every surface reads the same project context.
  // workspaceRoot is normalized at its source (resolveWorkspaceRoot) so westCwd
  // + boardYaml derive a forward-slash root; sdkRoot is normalized here so every
  // resolveSdkRoot branch (explicit path, workspace-is-SDK, installed cache,
  // sibling) lands platform-identical in the serialized context.
  const workspaceRoot = resolveWorkspaceRoot(input.workspaceFolders);
  const sdkRoot = resolveSdkRoot(
    input.workspaceFolders,
    input.settings.sdkPath,
    input.installedSdkRoots ?? [],
    pathExists,
  );

  return {
    workspaceRoot,
    sdkRoot: sdkRoot === null ? null : toPosix(sdkRoot),
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
  return workspaceFolders.length > 0 ? toPosix(workspaceFolders[0]!) : null;
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

    // path.join (lexical, cwd-independent) not path.resolve: on Windows
    // resolve() treats a POSIX-absolute folder as relative and injects the cwd
    // drive, breaking the sibling match. join stays platform-deterministic.
    const siblingSdk = toPosix(path.join(workspaceFolder, "..", "alp-sdk"));
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
  return toPosix(
    path.isAbsolute(configuredBoardYamlPath)
      ? configuredBoardYamlPath
      : path.join(workspaceRoot, configuredBoardYamlPath),
  );
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
  return pathExists(toPosix(path.join(rootPath, "scripts", "alp_project.py")));
}
