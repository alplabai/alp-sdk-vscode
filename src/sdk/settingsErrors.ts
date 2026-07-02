// SPDX-License-Identifier: Apache-2.0

/** Pull a human-readable message out of whatever `catch` handed us. */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/**
 * True when a failed `WorkspaceConfiguration.update()` was rejected because the
 * target settings file is open with unsaved edits. VS Code core raises a
 * `CodeExpectedError` whose message reads, e.g.:
 *
 *   "Unable to write into user settings because the file has unsaved changes.
 *    Please save the user settings file first and then try again."
 *
 * The scope word varies ("user" / "workspace" / "folder" / "remote" settings)
 * but the phrase "unsaved changes" is constant. This condition is *recoverable*:
 * saving the file and retrying the write succeeds — unlike the sibling
 * "…because the file is invalid" error, which needs the user to fix their JSON
 * by hand and must NOT be auto-retried. Match narrowly so only the dirty-file
 * case is treated as recoverable.
 */
export function isSettingsUnsavedChangesError(err: unknown): boolean {
  const message = messageOf(err);
  return (
    /unable to write into .*settings/i.test(message) &&
    /unsaved changes/i.test(message)
  );
}
