// SPDX-License-Identifier: Apache-2.0
//
// Is `build/system-manifest.yaml` describing the LAST build, or an older one?
// (#470)
//
// The Build Plan panel decided a manifest was "post-build" from the mere
// EXISTENCE of the file, never from its age. So after any past successful
// build it presented that build's per-slice status and its memory numbers as
// the current state — including right after a build that had just failed, with
// nothing on screen saying so. Monday's green table, on Tuesday, over a tree
// that no longer compiles.
//
// The producer cannot help yet: `system-manifest-v1` carries no timestamp and
// no build id, which `packages/alp-core/src/tanPayloadShape.ts` records too
// (`SYSTEM_MANIFEST_SHAPE` has nothing to key on). Adding one is an alp-sdk
// schema change plus a tan pass-through — the honest fix, and the slow one. So
// this reads the two facts already available on this side: the FILE's mtime,
// and the finish of the last build this extension actually observed.
//
// ---------------------------------------------------------------------------
// "STALE" AND "UNKNOWN" ARE DIFFERENT ANSWERS, AND CONFLATING THEM IS THE BUG
// ---------------------------------------------------------------------------
//
// `stale` is a CLAIM, and only one thing here can support it: a build finished
// AFTER the manifest was written and did not rewrite it. That is evidence, not
// inference — the build ran, the file did not move, so the file describes an
// earlier one.
//
// Everything else is `unknown`. No build observed since the file was written
// means exactly that: the sources may have changed under it, or nothing may
// have happened at all, and this extension cannot tell the two apart. Calling
// that `fresh` is the original defect wearing a new word, and calling it
// `stale` would cry wolf on every project that also builds outside the IDE.
//
// So `unknown` is a first-class verdict and the view renders it as one. What
// makes even `unknown` an improvement is that the manifest's AGE is now on
// screen either way: "post-build · 3 days ago" lets a reader draw the
// conclusion this module refuses to draw for them.

/**
 * - `fresh` — the last observed build finished at or before the manifest was
 *   written, so the file describes it.
 * - `stale` — a build finished AFTER the file was written and did not update
 *   it. The slices and sizes on screen belong to an earlier build.
 * - `unknown` — no claim. Nothing observed since, or the timestamps cannot be
 *   trusted.
 */
export type ManifestFreshness = "fresh" | "stale" | "unknown";

/** Where the rendered manifest came from, so the view can say so. */
export interface ManifestProvenance {
  /** The manifest file's mtime, ISO-8601, or `null` when it could not be read. */
  writtenAt: string | null;
  freshness: ManifestFreshness;
  /**
   * One customer-facing sentence, or `null` when there is nothing to add
   * beyond the age. Present for every `stale` verdict — a badge that says
   * "stale" without saying why is a puzzle, not a warning.
   */
  reason: string | null;
}

/** What the host knows about the last build it watched run. */
export interface LastBuildRecord {
  /** Epoch ms when the run finished. */
  finishedAt: number;
  /** Its exit code; `null` when the run ended without one (see `awaitRun`). */
  exitCode: number | null;
}

export interface ManifestFreshnessInput {
  /** The manifest file's mtime in epoch ms, or `null` when it was not stat-able. */
  writtenAt: number | null;
  /** The last build this extension observed, or `null` if it has seen none. */
  lastBuild: LastBuildRecord | null;
  /** Injected, never `Date.now()` — a pure module and a testable clock. */
  now: number;
}

function describeExit(exitCode: number | null): string {
  if (exitCode === null) return "did not report an exit code";
  return exitCode === 0 ? "exited 0" : `exited ${exitCode}`;
}

/**
 * Decide whether the manifest on disk describes the last build.
 *
 * Reads only timestamps. It never inspects the manifest's CONTENTS — a slice
 * marked `failed` inside an otherwise current manifest is a real, fresh result
 * and must keep saying so; that is tan's verdict about a build, not evidence
 * about the file's age.
 */
export function manifestFreshness(
  input: ManifestFreshnessInput,
): ManifestProvenance {
  const { writtenAt, lastBuild, now } = input;

  if (writtenAt === null) {
    return {
      writtenAt: null,
      freshness: "unknown",
      reason:
        "The manifest's timestamp could not be read, so how recent it is cannot be shown.",
    };
  }

  const iso = new Date(writtenAt).toISOString();

  // A file stamped in the FUTURE means the clock moved — a dual-boot, a
  // corrected NTP sync, a file copied off another machine. Every comparison
  // below would be arithmetic on a lie, and it lies in the dangerous
  // direction: a future mtime makes any real build look older than the file,
  // so the manifest reads fresh forever.
  if (writtenAt > now) {
    return {
      writtenAt: iso,
      freshness: "unknown",
      reason:
        "The manifest is dated in the future, so this machine's clock cannot " +
        "say whether it describes the last build.",
    };
  }

  if (lastBuild === null) {
    // Not a failure and not a claim. The age still renders, which is the whole
    // point: the reader gets the fact, not a verdict nobody can support.
    return { writtenAt: iso, freshness: "unknown", reason: null };
  }

  if (lastBuild.finishedAt > writtenAt) {
    return {
      writtenAt: iso,
      freshness: "stale",
      reason:
        `A build finished after this manifest was written (it ` +
        `${describeExit(lastBuild.exitCode)}) and did not update it, so these ` +
        `slices and their memory figures are from an earlier build.`,
    };
  }

  return { writtenAt: iso, freshness: "fresh", reason: null };
}
