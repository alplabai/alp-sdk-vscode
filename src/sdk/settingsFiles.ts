// SPDX-License-Identifier: Apache-2.0

/** A path names a settings file VS Code might refuse to write while it is dirty. */
export function isSettingsFilePath(fsPath: string): boolean {
  return (
    /(^|[\\/])settings\.json$/i.test(fsPath) ||
    /\.code-workspace$/i.test(fsPath)
  );
}

/**
 * Folder/workspace-scoped settings live in `.vscode/settings.json` or a
 * `.code-workspace` file; the user (global) settings file is a bare
 * `settings.json` under the VS Code user-data directory.
 */
function isFolderScopedSettings(fsPath: string): boolean {
  return (
    /[\\/]\.vscode[\\/]settings\.json$/i.test(fsPath) ||
    /\.code-workspace$/i.test(fsPath)
  );
}

/**
 * Choose which of the currently-dirty documents to save so a write to the
 * failing scope can proceed. Prefer files matching that scope (folder/workspace
 * vs user); fall back to every dirty settings file — the offending one is
 * guaranteed to be among them, and saving a spare settings file is harmless.
 * Pure so the (fiddly) path heuristic is unit-tested without VS Code.
 */
export function selectSettingsFilesToSave(
  dirtyPaths: readonly string[],
  wantsFolderScope: boolean,
): string[] {
  const settings = dirtyPaths.filter(isSettingsFilePath);
  const scoped = settings.filter((p) =>
    wantsFolderScope ? isFolderScopedSettings(p) : !isFolderScopedSettings(p),
  );
  return scoped.length > 0 ? scoped : settings;
}
