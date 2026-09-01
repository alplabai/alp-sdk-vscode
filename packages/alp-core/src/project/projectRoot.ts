// SPDX-License-Identifier: Apache-2.0
//
// Which directory IS the project — as opposed to which folder is open.
//
// These are not the same thing, and the difference is settable by the customer.
// `alpSdk.boardYamlPath` is a documented, per-folder `resource`-scoped setting
// holding a path RELATIVE to its workspace folder (`package.json`, default
// `"board.yaml"`). Point it at `firmware/board.yaml` in a repo whose sources
// live under `firmware/` and the workspace folder is the outer directory while
// the project is the inner one.
//
// `src/west.ts` has resolved it correctly since it was written: build, flash,
// image and clean all run in `path.dirname(boardYamlPath)`. `src/wizard.ts` did
// not, and passed the workspace folder to `tan scaffold` as both `--project`
// and the spawn's cwd — so on exactly that layout the module was written to
// `<outer>/src/modules/<name>/` while the build ran in `<outer>/firmware/`, and
// was never compiled. That is #601's own symptom, re-created by the fix for it
// (found in adversarial review, confirmed live against the pinned tan 0.6.0).
//
// So it is one function now, and both callers use it. A rule two files spell
// for themselves is a rule that holds in one of them.

/** Does this path exist? Injected so this module stays free of `fs`. */
export type PathExists = (path: string) => boolean;

/**
 * The project root: the directory holding `board.yaml` when one resolves, and
 * the workspace folder otherwise.
 *
 * `dirname` is injected for the same reason `exists` is — this module is loaded
 * by tests that stub the host — and callers pass `path.dirname`, so the
 * platform's own separator rules apply.
 *
 * The fallback is NOT a guess dressed up as an answer: with no `board.yaml` on
 * disk there is no project to be wrong about, and the workspace folder is the
 * only directory the customer has actually chosen. A caller that WRITES should
 * still report where it wrote — `tan scaffold`'s `written[]` paths are relative
 * to whatever this returns.
 */
export function resolveProjectRoot(
  workspaceRoot: string,
  boardYamlPath: string | null,
  exists: PathExists,
  dirname: (path: string) => string,
): string {
  if (!boardYamlPath) return workspaceRoot;
  if (!exists(boardYamlPath)) return workspaceRoot;
  return dirname(boardYamlPath);
}
