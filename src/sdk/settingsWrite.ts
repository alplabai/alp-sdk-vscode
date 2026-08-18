// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { isCancellation, planFailure } from "../notify/service";
import { notify } from "../notify/vscodeAdapter";
import { log } from "../util";
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
 * user has been told, in plain language, to save the file and try again), and
 * `false` when the window went away mid-write. Only a genuinely unrelated
 * failure is rethrown for the caller to surface.
 *
 * THE CANCELLATION GUARD IS HERE, not spread across the callers — three
 * calling FUNCTIONS (`setActiveSdk`, `clearActiveSdk`, and the SDK-manager
 * remove handler in `ideHub/sdkManagerMessages.ts`), six call sites once the
 * retry below is counted. `update()` is a main-thread RPC and the recovery
 * path awaits a toast, so at window teardown (reload, close, a folder-open
 * replacing the workspace) either can reject with a CancellationError — and
 * every caller turns a throw from here into a toast ("Alp: couldn't set the
 * active SDK", "the removed SDK is still named as the active one"). One guard
 * at the seam every caller routes through beats three that can drift apart.
 * `false` is already each caller's silent path, because it means "not written,
 * and the user has been told" — and a user whose window is closing has nothing
 * left to be told.
 *
 * @callers 6 writeAlpSetting
 * @quotes src/ideHub/sdkManagerMessages.ts "couldn't set the active SDK"
 * @quotes src/ideHub/sdkManagerMessages.ts "still named as the active one"
 */
export async function writeAlpSetting(
  key: string,
  value: unknown,
  target: vscode.ConfigurationTarget,
): Promise<boolean> {
  try {
    try {
      await vscode.workspace
        .getConfiguration("alpSdk")
        .update(key, value, target);
      return true;
    } catch (err) {
      if (!isSettingsUnsavedChangesError(err)) throw err;
    }
    return await recoverFromUnsavedSettings(key, value, target);
  } catch (err) {
    if (isCancellation(err)) {
      log(`[settings] alpSdk.${key} write abandoned, window closing`);
      return false;
    }
    log(`[settings] alpSdk.${key} write failed: ${String(err)}`);
    throw err;
  }
}

/**
 * The write didn't land; the file must be saved by hand. Carries the two
 * controls the old buttonless toast lacked — it ordered the user to save a file
 * it never opened and to retry a command it never re-ran:
 *
 *  - "Open Settings" opens the very setting that failed to write;
 *  - "Retry" is caller-handled (no `run` in the presenter's table), so the pick
 *    comes back here and re-runs the whole write.
 *
 * `reason` names which of the three exits fired. It goes to `detail`, which is
 * logged to the channel and never rendered, so the customer sentence stays the
 * one canonical line while the log can tell the exits apart.
 *
 * Returns `true` only when the retried write actually landed.
 */
async function offerManualSaveOrRetry(
  key: string,
  value: unknown,
  target: vscode.ConfigurationTarget,
  reason: string,
): Promise<boolean> {
  const picked = await notify(
    planFailure({
      operation: "Updating your Alp settings",
      cause:
        "Alp: settings unchanged — save your settings file manually, then try again.",
      detail: reason,
      severity: "warning",
      actions: [{ id: "openSettings", arg: `alpSdk.${key}` }, { id: "retry" }],
    }),
  );
  return picked === "retry" ? writeAlpSetting(key, value, target) : false;
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
  // `retry` has no `run` in the presenter's table, so the pick comes back and
  // still gates the save + retry below — the whole recovery loop depends on it.
  const choice = await notify(
    planFailure({
      operation: "Updating your Alp settings",
      cause:
        "Alp couldn't update your settings file because it has unsaved changes. " +
        "Save it and retry?",
      severity: "warning",
      actions: [{ id: "retry", title: SAVE_AND_RETRY }],
    }),
  );
  if (choice !== "retry") {
    // One canonical "save manually" message + severity for every non-write exit
    // (previously an info toast here vs. a warning toast elsewhere).
    return offerManualSaveOrRetry(key, value, target, "save prompt declined");
  }

  if (!(await saveSettingsFile(target))) {
    return offerManualSaveOrRetry(
      key,
      value,
      target,
      "no settings document could be saved",
    );
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
      return offerManualSaveOrRetry(
        key,
        value,
        target,
        "settings file was dirty again after the save",
      );
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
