// SPDX-License-Identifier: Apache-2.0
//
// Where a core's application may live (#538).
//
// A HAND MIRROR of `@alp-sdk/core/project/coreScaffold`'s two helpers, kept
// here because the webview does not import core (see types.ts). The host runs
// the core copy as the boundary that counts; this one exists so the wizard can
// refuse a bad directory before the customer presses Create rather than after.
// `test/webview.appDirMirror.test.js` pins the two against each other.

/**
 * Where a core's application may live: inside the project, and nowhere else.
 *
 * The wizard's field is free text and the host resolves it against the project
 * directory, so `../../..` walks out and an absolute path ignores the project
 * entirely — and three files get written wherever it lands. Checked here, in
 * the pure layer, so both the webview's own validation and the host's final
 * guard ask the same question.
 *
 * A Windows absolute path is rejected explicitly: on a POSIX host
 * `path.isAbsolute("C:\\x")` is false and the string would sail through as a
 * relative directory with backslashes in its name.
 */
export function isSafeAppDir(app: string): boolean {
  const trimmed = app.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) return false;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return false;
  const normalised = normaliseAppDir(trimmed);
  return normalised !== ".." && !normalised.startsWith("../");
}

/**
 * One spelling per directory, so two cores cannot claim the same tree under
 * different names — `./src`, `src` and `./a/../src` are one place, and `tan
 * build` would build that source twice under two slice configs.
 *
 * Deliberately string arithmetic rather than `path.posix.normalize`: this
 * module is pure and must not import node's `path` (the webview mirrors this
 * logic and has no node).
 */
export function normaliseAppDir(app: string): string {
  const parts = app.trim().replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}
