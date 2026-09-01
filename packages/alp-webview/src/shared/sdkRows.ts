// SPDX-License-Identifier: Apache-2.0
//
// How the remote release list and the local installs become one list of rows
// (#593).
//
// Kept out of `SdkView.tsx` so it can be exercised as data, the same argument
// `coreChoices.ts` and `templateSelection.ts` make for themselves. The defect
// this file was extracted for was invisible precisely because the rule lived
// inside a component and nothing could ask it a question.

import type { LocalSdkEntry, SdkRelease } from "../types";

export type SdkSource = "available" | "installed" | "linked";

/** One unified row in the SDK list — a release and/or a local install. */
export interface SdkRow {
  id: string;
  label: string;
  date?: string;
  changelog?: string;
  /** Release tag to install (only for not-yet-installed releases). */
  installTag?: string;
  /** Path of the local install (for activate / remove). */
  localPath?: string;
  isActive: boolean;
  /** Why it is active — see LocalSdkEntry.activeSource. Absent on rows that are
   *  not active. A row that is active by fallback ("auto") is NOT pinned, so it
   *  gets the honest badge and "Use" rather than "Active" and "Deactivate". */
  activeSource?: "pinned" | "auto";
  source: SdkSource;
}

/** Last path segment (cross-platform); the cache dir is named after the tag. */
export function pathTail(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/**
 * True when a directory name is itself a version — `v0.16.0`, `0.16.0-rc1`.
 *
 * When it is, the directory name is the AUTHORITATIVE answer to "which release
 * is this?" and the version-metadata fallback below must not override it.
 */
export function looksLikeVersionDir(name: string): boolean {
  return /^v?\d+\.\d+\.\d+(?:[-+].+)?$/.test(name);
}

/**
 * The local install for a release tag, or undefined.
 *
 * Two ways to match, and the ORDER of authority is the whole point:
 *
 *  1. The directory name equals the tag. The installer names the cache
 *     directory after the tag, so this is exact.
 *  2. The SDK's own reported version equals the tag without its leading `v`.
 *     This exists for installs whose directory is NOT named after a tag — a
 *     sibling checkout called `alp-sdk`, a hand-made cache.
 *
 * Rule 2 is only consulted when the directory name is not itself a version.
 * Without that guard a prerelease install answered for the stable release:
 * `~/.alp/sdk/v0.16.0-rc1` reports its version as `0.16.0` — an RC's metadata
 * names the release it is a candidate for — so the `v0.16.0` row bound to the
 * rc1 install. Both rows then showed Active off one entry, Deactivate on either
 * cleared the single shared pointer, and Remove on a row labelled `v0.16.0`
 * would have deleted `v0.16.0-rc1` (#593).
 *
 * `claimed` holds the paths already bound to an earlier row. One install can
 * answer for at most one release: two rows sharing a path share its Active
 * state and its destructive actions, which is the same defect by another route.
 */
export function installedFor(
  tag: string,
  entries: LocalSdkEntry[],
  claimed: ReadonlySet<string> = new Set(),
): LocalSdkEntry | undefined {
  const free = entries.filter((e) => !claimed.has(e.path));
  const byDir = free.find((e) => pathTail(e.path) === tag);
  if (byDir) return byDir;
  return free.find(
    (e) =>
      e.version !== null &&
      e.version === tag.replace(/^v/, "") &&
      !looksLikeVersionDir(pathTail(e.path)),
  );
}

/** Merge the remote release list with local installs into one keyed list. */
export function buildRows(
  releases: SdkRelease[] | null,
  locals: LocalSdkEntry[],
): SdkRow[] {
  const rows: SdkRow[] = [];
  const usedPaths = new Set<string>();

  for (const r of releases ?? []) {
    const local = installedFor(r.tag, locals, usedPaths);
    if (local) usedPaths.add(local.path);
    const source: SdkSource = !local
      ? "available"
      : local.removable
        ? "installed"
        : "linked";
    rows.push({
      id: r.tag,
      label: r.tag,
      date: r.publishedAt || undefined,
      changelog: r.releaseNotes || r.releaseNotesSummary || undefined,
      installTag: local ? undefined : r.tag,
      localPath: local?.path,
      isActive: !!local?.active,
      activeSource: local?.active ? (local.activeSource ?? "auto") : undefined,
      source,
    });
  }

  // Local installs with no matching release (linked checkouts, manual caches).
  for (const e of locals) {
    if (usedPaths.has(e.path)) continue;
    rows.push({
      id: e.path,
      label: e.version ?? pathTail(e.path),
      localPath: e.path,
      isActive: !!e.active,
      // Absent `activeSource` falls back to "auto", not "pinned": host and
      // webview ship in the same VSIX so the field is always there in practice,
      // and if it ever isn't, under-claiming is the harmless direction.
      activeSource: e.active ? (e.activeSource ?? "auto") : undefined,
      source: e.removable ? "installed" : "linked",
    });
  }

  return rows;
}
