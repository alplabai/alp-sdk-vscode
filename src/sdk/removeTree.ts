// SPDX-License-Identifier: Apache-2.0
//
// Delete an installed SDK tree, and say which way it failed.
//
// ---------------------------------------------------------------------------
// WHAT THIS DOES AND DOES NOT FIX — read this before extending it
// ---------------------------------------------------------------------------
//
// An earlier version of this comment claimed that `fs.rmSync(target,
// { recursive: true, force: true })` fails on Windows for a `git clone`d SDK
// because git marks its pack and object files read-only and `force` does not
// clear that. **That is wrong, and the measurement is worth keeping so nobody
// re-derives it:** Node's own recursive remove already handles it. Its
// internal rimraf carries `fixWinEPERM`, which chmods and retries on `EPERM`
// (4 occurrences in the shipped v24 binary), and on the GitHub Windows runner
// a `0o444` file did NOT make `rmSync` refuse — the tests that tried to
// arrange one skipped, saying so.
//
// So what is left, honestly:
//
//   * WINDOWS read-only attributes — already Node's job, and it does it. The
//     pass below is redundant there. Harmless, and kept because it costs one
//     walk on a path that has already failed once.
//   * POSIX read-only DIRECTORIES — genuinely ours. `fixWinEPERM` is
//     Windows-only; on macOS and Linux Node does not chmod anything, and a
//     directory without its write bit defeats the delete of every child.
//     That case is real and is what the tests exercise.
//   * THE MESSAGE — the part that actually helps the person reading it. The
//     panel used to tell EVERY failure to "close anything using it (an editor,
//     a terminal, a running build)". For a permissions problem that is not
//     merely unhelpful, it is a wrong instruction that sends someone hunting a
//     holder that does not exist. Splitting the causes is the user-visible fix.
//
// The reported Windows failure is NOT explained by anything above, and this
// module should not be read as having fixed it. After Node's own retry, the
// remaining candidates are a held handle (a terminal in the tree, a build, an
// indexer, a scanner), the 260-character path limit — a bootstrapped SDK is
// about 3 GB and deep — or a synced/junctioned folder. Diagnosing it needs the
// actual `detail` line from the "Alp SDK" output channel; until then this
// improves the report rather than the outcome.
//
// POSIX is what the tests can arrange, and they say so: removing a file needs
// write permission on its DIRECTORY, so a directory at mode 0500 fails the
// same way there and is fixed by the same pass. On Windows the equivalent
// cannot be arranged portably, and those tests skip with the reason printed.

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
 *  the list because a directory whose child could not be unlinked surfaces
 *  that way rather than propagating the child's own code. */
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
      // failure slower. `src/alpCli/download.ts` reached the same conclusion
      // for the CLI binary.
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
        // Everything this process could change has been changed — and on
        // Windows, Node had already tried its own chmod-and-retry before this
        // module saw the first error. A permission error that survives BOTH is
        // no longer plausibly an attribute, which is what makes "close what is
        // using it" a reasoned verdict here rather than the blanket guess it
        // used to be. It is still a verdict, not proof: a path-length or
        // filesystem limit can surface the same way.
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
