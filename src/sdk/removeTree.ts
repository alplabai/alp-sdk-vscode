// SPDX-License-Identifier: Apache-2.0
//
// Delete an installed SDK tree, and say which of the two ways it failed.
//
// `fs.rmSync(target, { recursive: true, force: true })` is not enough, and the
// gap bites hardest on Windows. TWO independent causes produce the same
// `EPERM`, they need opposite advice, and the panel used to guess one of them:
//
//   1. READ-ONLY ATTRIBUTES. An SDK is installed with `git clone`, and nothing
//      strips `.git` afterwards. Git on Windows writes pack and object files
//      with the read-only attribute set. `force: true` does NOT clear it — it
//      only swallows `ENOENT`, which `src/alpCli/download.ts` already records
//      in as many words. So the delete raises `EPERM` on the first read-only
//      object, DETERMINISTICALLY, every single time. No amount of closing
//      editors helps, which is exactly what the old message told the user to
//      do.
//
//   2. A HELD HANDLE. A terminal sitting in the tree, a running build, an
//      indexer, a virus scanner. Windows refuses to unlink an open file where
//      POSIX allows it. Closing the holder IS the fix here.
//
// So this clears the attributes and retries. What that buys is not only a
// higher success rate — it is a TRUTHFUL diagnosis: if the retry still fails
// after everything this process is allowed to change, the remaining cause is
// something holding the file, and the message can say so without guessing.
//
// POSIX is not exempt, and the test does not have to pretend. Removing a file
// needs write permission on its DIRECTORY, not on the file, so a directory
// left at mode 0500 fails the same way and is fixed by the same pass. That is
// what lets this be covered by a real filesystem test on macOS and Linux
// rather than a Windows-only mock.

import * as fs from "fs";
import * as path from "path";

/** Which of the two failures happened, once the retry has been exhausted. */
export type SdkRemovalCause = "in-use" | "permission" | "other";

export interface SdkRemovalResult {
  ok: boolean;
  /** True when the first attempt failed and the attribute pass was needed.
   *  Logged, not shown: it is the difference between "worked" and "worked
   *  because we cleared read-only bits", which matters when reading a report. */
  clearedAttributes: boolean;
  cause?: SdkRemovalCause;
  /** The raw error, for the channel. Never the whole message to the user. */
  error?: string;
}

/** Errors worth a second attempt after clearing attributes. `ENOTEMPTY` is in
 *  the list because Windows reports a directory whose child could not be
 *  unlinked that way rather than propagating the child's own code. */
const RETRYABLE = new Set(["EPERM", "EACCES", "ENOTEMPTY", "EBUSY"]);

function errnoOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code?: unknown }).code)
    : undefined;
}

/**
 * Give every entry under `target` (and `target` itself) write permission.
 *
 * Directories get the write bit because that is what unlinking a CHILD
 * requires; files get it because Windows maps its read-only attribute onto the
 * same bit, which is how `git`'s object files end up undeletable there.
 *
 * Best-effort per entry: one `chmod` that fails must not abort the pass, since
 * the entry it could not change may not be the one blocking the delete. The
 * retry that follows is the real verdict.
 */
function clearReadOnly(target: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }

  // A symlink's own mode is not what governs deletion, and following it would
  // walk out of the tree being removed — into whatever the link points at.
  if (stat.isSymbolicLink()) return;

  try {
    fs.chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
  } catch {
    // Not ours to change (another owner, a locked file). Keep walking.
  }

  if (!stat.isDirectory()) return;
  let entries: string[];
  try {
    entries = fs.readdirSync(target);
  } catch {
    return;
  }
  for (const entry of entries) clearReadOnly(path.join(target, entry));
}

/**
 * Remove an installed SDK tree.
 *
 * Never throws: the caller is a panel handler, and the verdict is more useful
 * as a value than as an exception it would have to re-classify.
 */
export function removeSdkTree(target: string): SdkRemovalResult {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true, clearedAttributes: false };
  } catch (first) {
    const code = errnoOf(first);
    if (!code || !RETRYABLE.has(code)) {
      return {
        ok: false,
        clearedAttributes: false,
        cause: "other",
        error: String(first),
      };
    }

    clearReadOnly(target);

    try {
      // `maxRetries` covers a TRANSIENT holder — a scanner that opened a file
      // as the walk passed it. It does nothing for a live holder, whose lock
      // lasts as long as the process does; that case is what the `in-use`
      // verdict below is for, and pretending otherwise would just make the
      // failure slower.
      fs.rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      return { ok: true, clearedAttributes: true };
    } catch (second) {
      const secondCode = errnoOf(second);
      return {
        ok: false,
        clearedAttributes: true,
        // Everything this process could change has been changed. A permission
        // error that SURVIVES that is something holding the file open — which
        // is the one case where "close what is using it" is true advice rather
        // than a guess.
        cause:
          secondCode === "EBUSY" ||
          secondCode === "EPERM" ||
          secondCode === "ENOTEMPTY"
            ? "in-use"
            : secondCode === "EACCES"
              ? "permission"
              : "other",
        error: String(second),
      };
    }
  }
}

/** What to tell the user, per cause. One sentence each, and each one names a
 *  next step that can actually work for THAT cause. */
export function removalFailureMessage(cause: SdkRemovalCause): string {
  switch (cause) {
    case "in-use":
      return (
        "Alp: couldn't delete the SDK folder — something still has a file " +
        "open in it. Close any editor, terminal or build using it (on Windows " +
        "a virus scanner can hold one briefly too), then try again."
      );
    case "permission":
      return (
        "Alp: couldn't delete the SDK folder — the files' permissions could " +
        "not be changed, so this account may not own them. Remove the folder " +
        "manually, or take ownership of it first."
      );
    case "other":
      return (
        "Alp: couldn't delete the SDK folder. The exact error is in the Alp " +
        "SDK output channel."
      );
  }
}
