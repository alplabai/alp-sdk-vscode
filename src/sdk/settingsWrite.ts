// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { isSettingsUnsavedChangesError } from "./settingsErrors";
import { selectSettingsFilesToSave } from "./settingsFiles";

const SAVE_AND_RETRY = "Save settings & retry";

/**
 * Update an `alpSdk.*` setting resiliently. VS Code refuses to write a settings
 * file that is open with unsaved edits — `WorkspaceConfiguration.update()`
 * rejects with "…the file has unsaved changes" — which used to dead-end the
 * "set active SDK" flow on a raw error. Here we offer to save the offending
 * settings file and retry the write once.
 *
 * Returns `true` when the value was written; `false` when the write did not
 * happen because the settings file was dirty and could not be persisted (the
 * user declined, or the save/retry did not clear it — in every such case the
 * user has been told, in plain language, to save the file and try again). Only
 * a genuinely unrelated failure is rethrown for the caller to surface.
 */
export async function writeAlpSetting(
  key: string,
  value: unknown,
  target: vscode.ConfigurationTarget,
): Promise<boolean> {
  try {
    await vscode.workspace
      .getConfiguration("alpSdk")
      .update(key, value, target);
    return true;
  } catch (err) {
    if (!isSettingsUnsavedChangesError(err)) throw err;
    return recoverFromUnsavedSettings(key, value, target);
  }
}

/** Guidance message: the write didn't land; the file must be saved by hand. */
function tellUserToSaveManually(): void {
  void vscode.window.showWarningMessage(
    "Alp: settings unchanged — save your settings file manually, then try again.",
  );
}

/**
 * The write was rejected because the target settings file is dirty. Offer to
 * save it and retry once. Every exit that didn't write returns `false` after
 * telling the user what to do; a retry that fails for an *unrelated* reason is
 * rethrown, but a second unsaved-changes rejection is handled (not leaked raw).
 */
async function recoverFromUnsavedSettings(
  key: string,
  value: unknown,
  target: vscode.ConfigurationTarget,
): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    "Alp couldn't update your settings file because it has unsaved changes. " +
      "Save it and retry?",
    SAVE_AND_RETRY,
  );
  if (choice !== SAVE_AND_RETRY) {
    void vscode.window.showInformationMessage(
      "Alp: settings unchanged — save your settings file, then try again.",
    );
    return false;
  }

  if (!(await saveSettingsFile(target))) {
    tellUserToSaveManually();
    return false;
  }

  try {
    await vscode.workspace
      .getConfiguration("alpSdk")
      .update(key, value, target);
    return true;
  } catch (err) {
    // The save didn't clear the dirty state (a save participant re-dirtied it,
    // a race, etc.). Don't leak the raw core error the way the old code did.
    if (isSettingsUnsavedChangesError(err)) {
      tellUserToSaveManually();
      return false;
    }
    throw err;
  }
}

/**
 * Persist the settings file backing `target`. The unsaved-changes error can
 * only arise when that file is open in an editor, so its dirty document is in
 * `textDocuments`; we save it in place without disturbing the active editor.
 * Returns `true` if at least one settings document was saved successfully —
 * `TextDocument.save()` can itself fail (read-only file, a save-participant
 * veto), which we must not mistake for success.
 */
async function saveSettingsFile(
  target: vscode.ConfigurationTarget,
): Promise<boolean> {
  const wantsFolderScope = target === vscode.ConfigurationTarget.Workspace;
  const dirtyDocs = vscode.workspace.textDocuments.filter((doc) => doc.isDirty);
  const chosen = new Set(
    selectSettingsFilesToSave(
      dirtyDocs.map((doc) => doc.uri.fsPath),
      wantsFolderScope,
    ),
  );

  let savedAny = false;
  for (const doc of dirtyDocs) {
    if (chosen.has(doc.uri.fsPath) && (await doc.save())) {
      savedAny = true;
    }
  }
  return savedAny;
}
