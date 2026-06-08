// SPDX-License-Identifier: Apache-2.0

// ---------------------------------------------------------------------------
// Remote release catalogue
// ---------------------------------------------------------------------------

/** A single release entry from the alplabai/alp-sdk GitHub Releases API. */
export interface SdkRelease {
  /** Git tag name, e.g. "v1.5.0". */
  tag: string;
  /** ISO-8601 publish date returned by the API. */
  publishedAt: string;
  /** GitHub-generated source tarball URL for the tag. */
  tarballUrl: string;
  /** First paragraph of the release body, or empty string when absent. */
  releaseNotesSummary: string;
  /** Full release body (Markdown), for an expandable changelog. */
  releaseNotes: string;
}

// ---------------------------------------------------------------------------
// Local SDK inventory
// ---------------------------------------------------------------------------

/**
 * Readiness state of a local SDK installation.
 *
 * - `ready`   — all required artefacts are present.
 * - `partial` — directory exists but at least one required artefact is
 *               missing (still usable with reduced capability).
 * - `missing` — the path does not exist or is not an SDK directory at all.
 */
export type SdkReadinessState = "ready" | "partial" | "missing";

/** A locally present SDK candidate discovered on the host. */
export interface LocalSdkEntry {
  /** Absolute path to the SDK root. */
  path: string;
  /** Version string read from the SDK's VERSION file, or null if absent. */
  version: string | null;
  readiness: SdkReadinessState;
  /** Human-readable list of missing or failing checks. */
  issues: string[];
}

// ---------------------------------------------------------------------------
// Readiness report
// ---------------------------------------------------------------------------

/**
 * Surface-agnostic readiness report for a single SDK path.
 * Both the CLI and the VS Code UI render this without re-running checks.
 */
export interface SdkReadinessReport {
  sdkPath: string;
  version: string | null;
  /** `scripts/alp_project.py` is the canonical SDK root marker. */
  loaderScriptPresent: boolean;
  /** `metadata/` directory exists. */
  metadataPresent: boolean;
  state: SdkReadinessState;
  issues: string[];
}

// ---------------------------------------------------------------------------
// Active SDK pointer
// ---------------------------------------------------------------------------

/**
 * Written to `.alp/sdk-path` in the workspace root.
 * Surfaces read this to discover the active SDK without re-running discovery.
 */
export interface ActiveSdkPointer {
  /** Absolute path to the active SDK root. */
  sdkPath: string;
  /** ISO-8601 timestamp of when the pointer was last updated. */
  updatedAt: string;
}
