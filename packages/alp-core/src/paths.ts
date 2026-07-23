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
