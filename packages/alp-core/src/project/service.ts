// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { resolveActiveSdk } from "../sdk/service";
import { toPosix } from "../paths";
import {
  ProjectContext,
  ProjectResolutionInput,
  SdkRootSource,
} from "./models";

// All path joins/resolves are done through the path flavour of the DECLARED
// target platform (`input.platform`), not the host's. In production the two are
// identical (platform === process.platform), so behaviour is unchanged; the
// distinction only matters under test, where a fixture can declare platform
// "linux"/"win32" and get deterministic, host-independent path semantics.
type PathImpl = typeof path.posix;

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
  // workspaceRoot is normalized at its source (resolveWorkspaceRoot) so westCwd
  // + boardYaml derive a forward-slash root; sdkRoot is normalized here so every
  // resolveSdkRoot branch (explicit path, workspace-is-SDK, installed cache,
  // sibling) lands platform-identical in the serialized context. Needed even
  // though `p` already picks posix/win32 by the *declared* platform: in
  // production `input.platform` is always `process.platform`, so on a real
  // Windows host `p` is `path.win32` and still emits `\`.
  const workspaceRoot = resolveWorkspaceRoot(
    input.workspaceFolders,
    input.settings.boardYamlPath,
    pathExists,
    p,
  );
  const { root: sdkRoot, source: sdkRootSource } = resolveSdkRoot(
    workspaceRoot,
    input.workspaceFolders,
    input.settings.sdkPath,
    input.installedSdkRoots ?? [],
    pathExists,
    readFile,
    p,
  );

  return {
    workspaceRoot,
    sdkRoot: sdkRoot === null ? null : toPosix(sdkRoot),
    sdkRootSource,
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
  return toPosix(folderWithBoardYaml ?? workspaceFolders[0]!);
}

/**
 * Returns the root AND which branch produced it. The branch is not a debugging
 * aid — the SDK Manager renders a different badge and a different button for a
 * pinned root ("setting"/"pointer") than for a guessed one, because
 * "Deactivate" on a guessed root clears a pin that was never written and leaves
 * the UI unchanged.
 */
function resolveSdkRoot(
  workspaceRoot: string | null,
  workspaceFolders: readonly string[],
  configuredSdkPath: string,
  installedSdkRoots: readonly string[],
  pathExists: (candidatePath: string) => boolean,
  readFile: (candidatePath: string) => string,
  p: PathImpl,
): { root: string | null; source: SdkRootSource | null } {
  // Prefer explicit SDK path, but only if it contains the loader entrypoint.
  const trimmedConfiguredPath = configuredSdkPath.trim();
  if (trimmedConfiguredPath) {
    return containsLoaderScript(trimmedConfiguredPath, pathExists, p)
      ? { root: trimmedConfiguredPath, source: "setting" }
      : { root: null, source: null };
  }

  // Shared `.alp/sdk-path` pointer, written by `alp sdk switch` and the
  // extension's "Select active SDK". Sits below the explicit setting but above
  // auto-discovery, and only when it still points at a valid SDK root — a stale
  // pointer falls through so it can't lock out auto-discovery.
  if (workspaceRoot) {
    const pointer = resolveActiveSdk(workspaceRoot, pathExists, readFile, p);
    if (pointer && containsLoaderScript(pointer, pathExists, p)) {
      return { root: pointer, source: "pointer" };
    }
  }

  // Auto-discovery is valid only when exactly one SDK root is detected.
  const candidates = collectSdkCandidates(workspaceFolders, pathExists, p);
  if (candidates.length === 1) {
    return { root: candidates[0]!, source: "discovery" };
  }
  // Multiple sibling SDKs is ambiguous — require an explicit alpSdk.path.
  if (candidates.length > 1) {
    return { root: null, source: null };
  }

  // Lowest precedence: an SDK installed in the local cache (~/.alp/sdk/<version>).
  // Lets the extension recognize + use an installed SDK with no workspace and no
  // alpSdk.path set (e.g. straight after `alp sdk install`, before activation).
  for (const installedRoot of installedSdkRoots) {
    const trimmed = installedRoot.trim();
    if (trimmed && containsLoaderScript(trimmed, pathExists, p)) {
      return { root: trimmed, source: "installed" };
    }
  }

  return { root: null, source: null };
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

    // p.join (lexical, cwd-independent) not p.resolve: on Windows resolve()
    // treats a POSIX-absolute folder as relative and injects the cwd drive,
    // breaking the sibling match. join stays platform-deterministic.
    const siblingSdk = toPosix(p.join(workspaceFolder, "..", "alp-sdk"));
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
  return toPosix(
    p.isAbsolute(configuredBoardYamlPath)
      ? configuredBoardYamlPath
      : p.join(workspaceRoot, configuredBoardYamlPath),
  );
}

/**
 * The board.yaml a single workspace FOLDER would use — the same rule
 * `resolveProjectContext` applies, exposed for callers that hold one folder
 * rather than a whole window.
 *
 * The debug device-write gate (#586) needs exactly this: VS Code hands a
 * `DebugConfigurationProvider` the folder its launch belongs to, and asking a
 * window-wide probe instead answers for whichever folder the active editor
 * happens to sit in. Re-joining the path at the call site got the ABSOLUTE
 * `alpSdk.boardYamlPath` case wrong (`path.join` concatenates rather than
 * resets), which is why the rule is shared rather than copied.
 */
export function boardYamlPathForFolder(
  folderPath: string,
  configuredBoardYamlPath: string,
  platform: NodeJS.Platform,
): string | null {
  return resolveBoardYamlPath(
    folderPath,
    configuredBoardYamlPath,
    pathFor(platform),
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
  p: PathImpl,
): boolean {
  // scripts/alp_project.py is the canonical marker for an Alp SDK root.
  return pathExists(toPosix(p.join(rootPath, "scripts", "alp_project.py")));
}
