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

/**
 * WHICH branch of the resolution chain produced `sdkRoot`. The first two are a
 * deliberate act by the user (`alpSdk.path`, or "Use" / `tan sdk switch`
 * writing `.alp/sdk-path`); the last two are the extension guessing because
 * nothing was pinned.
 *
 * The distinction is user-visible and it matters: with nothing pinned, an
 * "Active" badge and a "Deactivate" button both lie — there is no pin to clear,
 * so Deactivate changes nothing and the badge does not move. See
 * `LocalSdkEntry.activeSource`.
 */
export type SdkRootSource =
  /** The `alpSdk.path` setting. */
  | "setting"
  /** The `<workspace>/.alp/sdk-path` pointer. */
  | "pointer"
  /** Exactly one SDK found in or next to the workspace. */
  | "discovery"
  /** Newest install under the ~/.alp/sdk cache. */
  | "installed";

export interface ProjectContext {
  workspaceRoot: string | null;
  sdkRoot: string | null;
  /** How `sdkRoot` was decided; null exactly when `sdkRoot` is null. */
  sdkRootSource: SdkRootSource | null;
  boardYamlPath: string | null;
  westCwd: string | null;
  pythonBinary: string;
}
