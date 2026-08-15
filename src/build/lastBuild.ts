// SPDX-License-Identifier: Apache-2.0
//
// When did a build last finish, and how did it end? (#470)
//
// The Build Plan panel needs one fact nothing was recording: whether a build
// has run SINCE `build/system-manifest.yaml` was written. Without it the panel
// could only see that the file exists, so it presented an old build's slices
// and memory numbers as the current state — including immediately after a
// build that had just failed.
//
// `workspaceState`, not `globalState`: "the last build" is a fact about THIS
// folder. A second window on another project must not answer for it, and
// `globalState` is shared by every window on the machine.
//
// Written by the one subscriber in `src/extension.ts` that already sees every
// run finish, so it covers a build started from the panel, the palette or the
// status bar without each dispatch site having to remember.

import type * as vscode from "vscode";
import type { LastBuildRecord } from "@alp-sdk/core/systemManifest/staleness";

/** Namespaced under `alp.build.` next to the other `alp.*` memento keys. */
const LAST_BUILD_KEY = "alp.build.lastFinished";

/**
 * Record that a build finished.
 *
 * `now` is injected rather than read here so the caller owns the clock and a
 * test does not have to mock a global.
 */
export function recordBuildFinish(
  context: vscode.ExtensionContext,
  exitCode: number | undefined,
  now: number,
): Thenable<void> {
  return context.workspaceState.update(LAST_BUILD_KEY, {
    finishedAt: now,
    // `undefined` (a run that ended without reporting one) is written as an
    // explicit `null`.
    //
    // This is NOT load-bearing for the read, and saying otherwise would be a
    // comment that outlives its truth: a memento round-trips JSON, so an
    // `undefined` value and an absent key come back identically, and
    // `readLastBuild` below normalises both to `null` anyway. What it buys is a
    // self-describing record on disk — `{"finishedAt":…,"exitCode":null}`
    // states "the build reported no exit code", where `{"finishedAt":…}` alone
    // leaves the next reader (or the next debugging session, staring at a
    // memento dump) to work out whether the key was dropped or never set.
    // `test/buildPlan.staleness.test.js` asserts the STORED shape for that
    // reason, not the read result, which is identical either way.
    exitCode: exitCode ?? null,
  } satisfies LastBuildRecord);
}

/**
 * The last recorded build, or `null` when none has been seen in this folder.
 *
 * TOLERANT: a record written by an older build of this extension, or one whose
 * shape drifted, reads as `null` rather than throwing or — far worse —
 * producing a `NaN` comparison, which would silently answer "not stale" for
 * every manifest forever. `null` means "no claim", which is exactly what a
 * record we cannot read supports.
 */
export function readLastBuild(
  context: vscode.ExtensionContext,
): LastBuildRecord | null {
  // Wrapped, and not because the types say it can fail — they say it cannot.
  // This feeds a BADGE. If reading a memento ever throws, the caller is
  // mid-way through fetching the manifest, and letting it propagate would
  // blank the whole Build Plan panel to avoid mislabelling one line on it.
  // "No claim" is the correct degradation and the panel already renders it.
  let raw: unknown;
  try {
    raw = context.workspaceState?.get<unknown>(LAST_BUILD_KEY);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Partial<LastBuildRecord>;
  if (
    typeof record.finishedAt !== "number" ||
    !Number.isFinite(record.finishedAt)
  ) {
    return null;
  }
  const exitCode =
    typeof record.exitCode === "number" && Number.isFinite(record.exitCode)
      ? record.exitCode
      : null;
  return { finishedAt: record.finishedAt, exitCode };
}
