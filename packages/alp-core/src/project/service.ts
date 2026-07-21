// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { resolveActiveSdk } from "../sdk/service";
import { ProjectContext, ProjectResolutionInput } from "./models";

// All path joins/resolves are done through the path flavour of the DECLARED
// target platform (`input.platform`), not the host's. In production the two are
// identical (platform === process.platform), so behaviour is unchanged; the
// distinction only matters under test, where a fixture can declare platform
// "linux"/"win32" and get deterministic, host-independent path semantics.
type PathImpl = path.PlatformPath;

function pathFor(platform: NodeJS.Platform): PathImpl {
  return platform === "win32" ? path.win32 : path.posix;
}

export function resolveProjectContext(
  input: ProjectResolutionInput,
  pathExists: (candidatePath: string) => boolean,
  readFile: (candidatePath: string) => string = () => "",
): ProjectContext {
  const p = pathFor(input.platform);
  // Resolve all runtime inputs once so every surface reads the same project context.
  const workspaceRoot = resolveWorkspaceRoot(
    input.workspaceFolders,
    input.settings.boardYamlPath,
    pathExists,
    p,
  );

  return {
    workspaceRoot,
    sdkRoot: resolveSdkRoot(
      workspaceRoot,
      input.workspaceFolders,
      input.settings.sdkPath,
      input.installedSdkRoots ?? [],
      pathExists,
      readFile,
      p,
    ),
    boardYamlPath: resolveBoardYamlPath(
      workspaceRoot,
      input.settings.boardYamlPath,
      p,
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
  configuredBoardYamlPath: string,
  pathExists: (candidatePath: string) => boolean,
  p: PathImpl,
): string | null {
  if (workspaceFolders.length === 0) return null;
  // Multi-root: target the folder that actually holds the configured board.yaml
  // so the loader, Projects tree, and west all operate on the same project —
  // not blindly workspaceFolders[0]. Falls back to the first folder.
  const folderWithBoardYaml = workspaceFolders.find((folder) =>
    pathExists(resolveBoardYamlPath(folder, configuredBoardYamlPath, p)!),
  );
  return folderWithBoardYaml ?? workspaceFolders[0]!;
}

function resolveSdkRoot(
  workspaceRoot: string | null,
  workspaceFolders: readonly string[],
  configuredSdkPath: string,
  installedSdkRoots: readonly string[],
  pathExists: (candidatePath: string) => boolean,
  readFile: (candidatePath: string) => string,
  p: PathImpl,
): string | null {
  // Prefer explicit SDK path, but only if it contains the loader entrypoint.
  const trimmedConfiguredPath = configuredSdkPath.trim();
  if (trimmedConfiguredPath) {
    return containsLoaderScript(trimmedConfiguredPath, pathExists, p)
      ? trimmedConfiguredPath
      : null;
  }

  // Shared `.alp/sdk-path` pointer, written by `alp sdk switch` and the
  // extension's "Select active SDK". Sits below the explicit setting but above
  // auto-discovery, and only when it still points at a valid SDK root — a stale
  // pointer falls through so it can't lock out auto-discovery.
  if (workspaceRoot) {
    const pointer = resolveActiveSdk(workspaceRoot, pathExists, readFile, p);
    if (pointer && containsLoaderScript(pointer, pathExists, p)) {
      return pointer;
    }
  }

  // Auto-discovery is valid only when exactly one SDK root is detected.
  const candidates = collectSdkCandidates(workspaceFolders, pathExists, p);
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
    if (trimmed && containsLoaderScript(trimmed, pathExists, p)) {
      return trimmed;
    }
  }

  return null;
}

function collectSdkCandidates(
  workspaceFolders: readonly string[],
  pathExists: (candidatePath: string) => boolean,
  p: PathImpl,
): string[] {
  const candidates = new Set<string>();

  for (const workspaceFolder of workspaceFolders) {
    // Check both workspace root and the conventional sibling alp-sdk folder.
    if (containsLoaderScript(workspaceFolder, pathExists, p)) {
      candidates.add(workspaceFolder);
    }

    const siblingSdk = p.resolve(workspaceFolder, "..", "alp-sdk");
    if (containsLoaderScript(siblingSdk, pathExists, p)) {
      candidates.add(siblingSdk);
    }
  }

  return [...candidates];
}

function resolveBoardYamlPath(
  workspaceRoot: string | null,
  configuredBoardYamlPath: string,
  p: PathImpl,
): string | null {
  if (!workspaceRoot) return null;
  return p.isAbsolute(configuredBoardYamlPath)
    ? configuredBoardYamlPath
    : p.join(workspaceRoot, configuredBoardYamlPath);
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
  p: PathImpl,
): boolean {
  // scripts/alp_project.py is the canonical marker for an Alp SDK root.
  return pathExists(p.join(rootPath, "scripts", "alp_project.py"));
}
