// SPDX-License-Identifier: Apache-2.0

/**
 * Normalize a filesystem path to forward slashes.
 *
 * `path.join` / `path.resolve` (and their `path.win32` twins) emit the OS
 * separator (`\` on Windows), but every ALP contract surface must be
 * byte-identical across platforms: the python command lines, the serialized
 * `ProjectContext`, the loader/validator plans, the batch summaries consumed
 * by alp-studio and the CLI↔extension handshake, and the golden snapshots
 * that pin them. Apply this at the boundary where a joined path becomes
 * emitted output or an SDK-root marker probe.
 *
 * Forward slashes are accepted by Node `fs`, python, and west on Windows, so
 * this changes determinism only — never whether a path resolves.
 */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Compare a `toPosix`-forced ALP path against the native host path it was
 * derived from.
 *
 * The supported pair is exactly that: one `ProjectContext` field (or loader
 * plan entry) versus the `Uri.fsPath` / `path.join` result it came from. A raw
 * `===` between the two can never be true on Windows, because the ALP side is
 * forward-slashed and the host side is not — that is how a debug session
 * silently lost its workspace-folder scope, taking folder-scoped `launch.json`
 * lookup and `${workspaceFolder}` substitution with it (#303).
 *
 * Separator flavour is the only skew this closes. It deliberately does NOT
 * normalize (`.`/`..`, trailing separators, 8.3 short names) and does NOT fold
 * case:
 *
 * - Normalizing would be wrong for UNC — `path.win32.normalize("\\\\a\\b")`
 *   appends a separator — and both operands already come from one producer, so
 *   there is nothing to reconcile.
 * - Folding case is unsafe. Directories created by WSL carry Windows'
 *   per-directory case-sensitivity flag, so `C:\ws\App` and `C:\ws\app` can be
 *   two real, distinct folders. A fold would match the wrong one — the #303
 *   failure in a rarer form (wrong scope instead of no scope). Both sides come
 *   from the same `Uri.fsPath` getter, so their casing is identical anyway and
 *   the fold buys nothing.
 *
 * Not folding can only ever produce a false negative; folding can produce a
 * false positive, which no caller can detect.
 */
export function samePath(a: string, b: string): boolean {
  return toPosix(a) === toPosix(b);
}
