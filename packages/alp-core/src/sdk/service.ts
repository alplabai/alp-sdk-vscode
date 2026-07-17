// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import {
  MkdirP,
  PathExists,
  Readdir,
  ReadFile,
  SdkHttpFetch,
  WriteFile,
} from "./adapterCore";
import {
  ActiveSdkPointer,
  LocalSdkEntry,
  SdkReadinessReport,
  SdkReadinessState,
  SdkRelease,
} from "./models";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/alplabai/alp-sdk/releases";

/** Canonical marker that identifies a directory as an Alp SDK root. */
const LOADER_SCRIPT_RELATIVE = path.join("scripts", "alp_project.py");

/** Legacy version file (older SDK build systems wrote a bare VERSION). */
const VERSION_FILE_RELATIVE = "VERSION";

/** Canonical SDK version file — `metadata/sdk_version.yaml` (`version: X`). */
const SDK_VERSION_FILE_RELATIVE = path.join("metadata", "sdk_version.yaml");

/** Metadata catalogue directory. */
const METADATA_DIR_RELATIVE = "metadata";

/** Workspace-relative path where the active SDK pointer is stored. */
const ACTIVE_SDK_POINTER_RELATIVE = path.join(".alp", "sdk-path");

// ---------------------------------------------------------------------------
// Remote release catalogue
// ---------------------------------------------------------------------------

interface GithubReleaseShape {
  tag_name: string;
  published_at: string;
  tarball_url: string;
  body: string | null;
}

/**
 * Query the alplabai/alp-sdk GitHub Releases API and return a typed
 * list of available SDK releases, newest first.
 *
 * @param fetch - injectable HTTP adapter (no VS Code / Node imports here)
 */
export async function listRemoteSdkReleases(
  fetch: SdkHttpFetch,
): Promise<SdkRelease[]> {
  const raw = await fetch(GITHUB_RELEASES_URL, {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });

  if (!Array.isArray(raw)) {
    throw new Error(
      "Alp SDK: unexpected response shape from GitHub Releases API.",
    );
  }

  return (raw as GithubReleaseShape[])
    .filter((item) => typeof item.tag_name === "string")
    .map((item) => ({
      tag: item.tag_name,
      publishedAt: item.published_at ?? "",
      tarballUrl: item.tarball_url ?? "",
      releaseNotesSummary: extractFirstParagraph(item.body ?? ""),
      releaseNotes: (item.body ?? "").trim(),
    }));
}

function extractFirstParagraph(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  // Take text up to the first blank line.
  const blankLine = trimmed.indexOf("\n\n");
  return blankLine === -1 ? trimmed : trimmed.slice(0, blankLine).trim();
}

// ---------------------------------------------------------------------------
// Local SDK discovery
// ---------------------------------------------------------------------------

/**
 * Scan `searchRoots` for local SDK installations.
 * Each directory that contains the canonical loader script is treated as
 * a candidate. Direct children of each root are also inspected, allowing
 * a cache directory containing multiple versioned subdirectories to be
 * passed as a single root.
 *
 * @param searchRoots - list of directories to scan
 * @param pathExists  - injectable filesystem existence check
 * @param readFile    - injectable file reader; null means skip VERSION check
 * @param readdir     - injectable directory listing
 */
export function listLocalSdkEntries(
  searchRoots: string[],
  pathExists: PathExists,
  readFile: ReadFile | null,
  readdir: Readdir,
): LocalSdkEntry[] {
  const seen = new Set<string>();
  const entries: LocalSdkEntry[] = [];

  function consider(candidate: string): void {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) return;
    seen.add(normalized);

    if (pathExists(path.join(normalized, LOADER_SCRIPT_RELATIVE))) {
      const report = checkSdkReadiness(
        normalized,
        pathExists,
        readFile ??
          (() => {
            throw new Error("readFile not available");
          }),
      );
      entries.push({
        path: normalized,
        version: report.version,
        readiness: report.state,
        issues: report.issues,
      });
    }
  }

  for (const root of searchRoots) {
    consider(root);

    // Also scan direct children (versioned subdirectory layout).
    try {
      for (const child of readdir(root)) {
        consider(path.join(root, child));
      }
    } catch {
      // readdir may fail for non-existent roots; ignore silently.
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Active SDK pointer
// ---------------------------------------------------------------------------

/**
 * Resolve the active SDK path for `workspaceRoot`.
 * Reads the pointer file at `.alp/sdk-path`; returns null when absent.
 *
 * @param workspaceRoot - absolute path to the project workspace
 * @param pathExists    - injectable filesystem existence check
 * @param readFile      - injectable file reader
 */
export function resolveActiveSdk(
  workspaceRoot: string,
  pathExists: PathExists,
  readFile: ReadFile,
): string | null {
  const pointerPath = path.join(workspaceRoot, ACTIVE_SDK_POINTER_RELATIVE);
  if (!pathExists(pointerPath)) return null;

  try {
    const raw = readFile(pointerPath);
    const pointer: ActiveSdkPointer = JSON.parse(raw);
    return typeof pointer.sdkPath === "string" ? pointer.sdkPath : null;
  } catch {
    return null;
  }
}

/**
 * Write or update the active SDK pointer for `workspaceRoot`.
 *
 * @param workspaceRoot - absolute path to the project workspace
 * @param sdkPath       - absolute path to the SDK root to activate
 * @param writeFile     - injectable file writer
 * @param mkdirP        - injectable mkdir -p adapter
 */
export function switchActiveSdk(
  workspaceRoot: string,
  sdkPath: string,
  writeFile: WriteFile,
  mkdirP: MkdirP,
): void {
  const pointerPath = path.join(workspaceRoot, ACTIVE_SDK_POINTER_RELATIVE);
  mkdirP(path.dirname(pointerPath));

  const pointer: ActiveSdkPointer = {
    sdkPath,
    updatedAt: new Date().toISOString(),
  };

  writeFile(pointerPath, JSON.stringify(pointer, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Readiness check
// ---------------------------------------------------------------------------

/**
 * Inspect a local SDK path and return a surface-agnostic readiness report.
 * Both CLI and VS Code UI render this report without re-running the checks.
 *
 * @param sdkPath    - absolute path to the SDK root to inspect
 * @param pathExists - injectable filesystem existence check
 * @param readFile   - injectable file reader (for VERSION)
 */
/** Extract `version: X` from a `metadata/sdk_version.yaml` document. */
function parseSdkVersionYaml(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^version:\s*["']?([^"'#]+?)["']?\s*$/);
    if (match) return match[1].trim() || null;
  }
  return null;
}

export function checkSdkReadiness(
  sdkPath: string,
  pathExists: PathExists,
  readFile: ReadFile,
): SdkReadinessReport {
  const issues: string[] = [];

  const loaderScriptPresent = pathExists(
    path.join(sdkPath, LOADER_SCRIPT_RELATIVE),
  );
  if (!loaderScriptPresent) {
    issues.push(
      `scripts/alp_project.py not found — "${sdkPath}" is not a valid Alp SDK root.`,
    );
  }

  const metadataPresent = pathExists(path.join(sdkPath, METADATA_DIR_RELATIVE));
  if (!metadataPresent) {
    issues.push("metadata/ directory is missing.");
  }

  let version: string | null = null;
  const versionFilePath = path.join(sdkPath, VERSION_FILE_RELATIVE);
  if (pathExists(versionFilePath)) {
    try {
      version = readFile(versionFilePath).trim() || null;
    } catch {
      issues.push("VERSION file could not be read.");
    }
  }
  // Fall back to the SDK's canonical metadata/sdk_version.yaml (`version: X`).
  if (version === null) {
    const sdkVersionPath = path.join(sdkPath, SDK_VERSION_FILE_RELATIVE);
    if (pathExists(sdkVersionPath)) {
      try {
        version = parseSdkVersionYaml(readFile(sdkVersionPath));
      } catch {
        /* leave version null — readiness still derives from the loader script */
      }
    }
  }

  const state = deriveReadinessState(loaderScriptPresent, issues);

  return {
    sdkPath,
    version,
    loaderScriptPresent,
    metadataPresent,
    state,
    issues,
  };
}

function deriveReadinessState(
  loaderPresent: boolean,
  issues: string[],
): SdkReadinessState {
  if (!loaderPresent) return "missing";
  if (issues.length > 0) return "partial";
  return "ready";
}
