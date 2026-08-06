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
  /** True when Alp installed this SDK (under ~/.alp/sdk) and may remove it.
   *  External SDKs (added via Browse / sibling checkouts) are not removable. */
  removable?: boolean;
  /** True when this entry IS the active SDK. Decided host-side (#361): the
   *  active path can come from a hand-typed `alpSdk.path` whose casing or
   *  trailing separator differs from what discovery produced, so matching it
   *  is a path-semantics rule that belongs with the other path rules — not
   *  re-derived with `===` by each of the four surfaces that render a badge. */
  active?: boolean;
  /** Only meaningful when `active` is true: WHY this entry is the active one.
   *
   *  `"pinned"` — the user pinned it (`alpSdk.path`, or "Use" / `tan sdk switch`
   *  writing `.alp/sdk-path`). Deactivate has a pin to clear.
   *
   *  `"auto"` — nothing was pinned and resolution fell through to a guess (the
   *  one SDK next to the workspace, or the newest install in ~/.alp/sdk). There
   *  is NO pin, so "Active" overstates it and Deactivate would clear nothing and
   *  change nothing on screen — which is exactly how it read as a broken button.
   *  Surfaces render this as "Default (auto-detected)" and offer "Use" (which
   *  pins it) instead of "Deactivate". */
  activeSource?: "pinned" | "auto";
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
