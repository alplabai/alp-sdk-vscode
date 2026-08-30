// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { canonicalPath } from "../paths";
import {
  MkdirP,
  PathExists,
  Readdir,
  ReadFile,
  SdkHttpFetch,
  SdkInstallAdapter,
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

/**
 * Minimum alp-sdk version this extension build supports. Older SDKs lack
 * planner contracts the extension hardcodes — notably `--emit
 * native-sim-overlay` (added in v0.10.0), whose absence makes `Alp: Generate
 * native_sim overlay` fail with a raw argparse error. Tracks the vendored
 * `schemas/board.schema.json` (re-vendored at v0.9.0 then v0.11.0).
 */
export const MIN_SDK_VERSION = "0.10.0";

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

/** A field of `record` if present AND a string, else `""` — never invented,
 *  never coerced from a wrong-typed value. Both known readers of a narrowed
 *  `SdkRelease` already treat an empty string as "not reported"
 *  (`packages/alp-webview/src/shared/sdkRows.ts`'s `r.publishedAt ||
 *  undefined`), so this is the same "absent" a real tan that omits the field
 *  would produce, not a guess standing in for one. */
function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

/**
 * Narrow `tan sdk list`'s untrusted `data` payload into `SdkRelease[]`,
 * dropping any entry this repo cannot trust rather than coercing it (#611).
 *
 * This is NOT `listRemoteSdkReleases` above: that one maps GitHub's OWN raw
 * response shape (`tag_name`, `published_at`, …) into `SdkRelease`; this one
 * narrows a payload that already CLAIMS to be `SdkRelease`-shaped — tan's own
 * envelope — and must not be trusted just because the field names line up.
 *
 * `tag` is the one field a dropped entry cannot survive without: both known
 * readers (`src/deps/vscodeAdapter.ts`'s `pickLatestSdkTag`, which calls
 * `.find` over the array, and its `isStableTag`, which calls `tag.trim()`)
 * read it with no try/catch on the path, so a `releases` that is not an array
 * or an entry missing a string `tag` is exactly what used to throw out of a
 * bare `(envelope.data as { releases?: SdkRelease[] }).releases ?? []` cast.
 * Every other field is cosmetic (rendered, never branched on), so a
 * wrong-typed or absent one degrades to `""` rather than dropping the whole
 * release a customer could otherwise still install.
 */
export function narrowSdkReleases(raw: unknown): SdkRelease[] {
  if (typeof raw !== "object" || raw === null) return [];
  const releases = (raw as Record<string, unknown>).releases;
  if (!Array.isArray(releases)) return [];

  const out: SdkRelease[] = [];
  for (const entry of releases) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.tag !== "string") continue;
    out.push({
      tag: record.tag,
      publishedAt: stringField(record, "publishedAt"),
      tarballUrl: stringField(record, "tarballUrl"),
      releaseNotesSummary: stringField(record, "releaseNotesSummary"),
      releaseNotes: stringField(record, "releaseNotes"),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// SDK installation
// ---------------------------------------------------------------------------

/**
 * Clone or extract a specific SDK version into `cacheRoot/<version>`.
 * Returns a readiness report so surfaces can display the result immediately.
 *
 * @param version     - tag name, e.g. "v1.5.0"
 * @param cacheRoot   - parent directory for the versioned SDK subdirectory
 * @param install     - injectable install adapter (git clone, tarball extract…)
 * @param pathExists  - injectable filesystem existence check
 * @param readFile    - injectable file reader (for VERSION and readiness checks)
 */
export async function installSdkRelease(
  version: string,
  cacheRoot: string,
  install: SdkInstallAdapter,
  pathExists: PathExists,
  readFile: ReadFile,
): Promise<SdkReadinessReport> {
  const destPath = path.join(cacheRoot, version);

  if (pathExists(path.join(destPath, LOADER_SCRIPT_RELATIVE))) {
    // Already installed — skip download, return current readiness.
    return checkSdkReadiness(destPath, pathExists, readFile);
  }

  await install(version, destPath);
  return checkSdkReadiness(destPath, pathExists, readFile);
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
 * @param platform    - declared host platform; only affects the de-dup key
 */
export function listLocalSdkEntries(
  searchRoots: string[],
  pathExists: PathExists,
  readFile: ReadFile | null,
  readdir: Readdir,
  platform: NodeJS.Platform = process.platform,
): LocalSdkEntry[] {
  const seen = new Set<string>();
  const entries: LocalSdkEntry[] = [];

  function consider(candidate: string): void {
    const normalized = path.resolve(candidate);
    // De-dup on the CANONICAL form, not the resolved one: `path.resolve` does
    // not fold case, so a user-typed `alpSdk.path` seeded as a search root
    // would list the same SDK a second time whenever its casing differed from
    // what discovery produced (#361). The stored `path` stays `normalized` —
    // the canonical form is a key, never a value the user sees.
    const key = canonicalPath(normalized, platform);
    if (seen.has(key)) return;
    seen.add(key);

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
  // Path flavour of the declared target platform; defaults to the host's. Only
  // matters under test (a fixture can force posix/win32 semantics on any host);
  // in production the host path is correct.
  p: typeof path.posix = path,
): string | null {
  const pointerPath = p.join(workspaceRoot, ".alp", "sdk-path");
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

/**
 * Remove the active SDK pointer for `workspaceRoot`. Returns true when a
 * pointer existed and was removed.
 *
 * `switchActiveSdk` never had a counterpart, and that asymmetry was the bug:
 * "Deactivate" cleared the `alpSdk.path` SETTING only, so the pointer written
 * on activation survived — and the pointer sits ABOVE auto-discovery in
 * `resolveSdkRoot`. Resolution kept returning the same SDK, the badge never
 * moved, and the button read as dead.
 *
 * @param workspaceRoot - absolute path to the project workspace
 * @param pathExists    - injectable existence probe
 * @param removeFile    - injectable unlink adapter
 */
export function clearActiveSdkPointer(
  workspaceRoot: string,
  pathExists: PathExists,
  removeFile: (target: string) => void,
): boolean {
  const pointerPath = path.join(workspaceRoot, ACTIVE_SDK_POINTER_RELATIVE);
  if (!pathExists(pointerPath)) return false;
  removeFile(pointerPath);
  return true;
}

// ---------------------------------------------------------------------------
// West workspace manifest pointer (read-only)
// ---------------------------------------------------------------------------

/**
 * Classification of a west workspace's `<topdir>/.west/config` manifest pointer.
 *
 * - `no-workspace` — no `.west/` here at all; nothing to say (the existing
 *   bootstrap call-to-actions already own that state).
 * - `ok`           — `[manifest] path` resolves to a directory that exists.
 * - `dangling`     — it resolves to a directory that does NOT exist. west reads
 *   this file directly and independently of the active-SDK pointer, so the
 *   workspace is broken until something rewrites it.
 * - `unparsable`   — absent/unreadable/ambiguous config. Never acted on.
 */
export type WestManifestState =
  | "no-workspace"
  | "ok"
  | "dangling"
  | "unparsable";

export interface WestManifestStatus {
  /** The west topdir inspected. */
  topdir: string;
  /** `<topdir>/.west/config`. */
  configPath: string;
  /** Raw `[manifest] path` value, trimmed; null when there wasn't exactly one. */
  manifestPath: string | null;
  /** `manifestPath` resolved against `topdir`; null when `manifestPath` is. */
  resolvedPath: string | null;
  state: WestManifestState;
}

/**
 * Read `<topdir>/.west/config` and classify its `[manifest] path` pointer.
 *
 * READ-ONLY BY DESIGN. The repair belongs to `tan` — `tan bootstrap` has
 * reconciled this pointer since tan-cli #31, and `tan sdk switch` since #74 —
 * and duplicating a *mutating* guard here would give one file two writers with
 * separately-evolving policies. This function exists only so the extension can
 * stop being silent about a workspace it invalidated.
 *
 * Parsing follows Python `configparser` (what west itself uses), not a generic
 * INI reader: option keys are case-insensitive but SECTION names are not
 * (`optionxform` lowercases only keys — `[Manifest]` raises `NoSectionError`
 * for `manifest`, so west never reads it and neither may we), `=` and `:` both
 * delimit, and inline comments are NOT stripped (configparser ships with them
 * disabled, so `path = v0.13.0 # old` really is the directory name west looks
 * for). A config with duplicate `[manifest]` sections or a duplicate `path` key
 * is `unparsable` rather than guessed at — strict `configparser` rejects it too.
 *
 * @param topdir     - the west topdir (the directory CONTAINING `.west/`)
 * @param pathExists - injectable filesystem existence check
 * @param readFile   - injectable file reader
 * @param p          - path flavour; defaults to the host's (tests force one)
 */
export function inspectWestManifest(
  topdir: string,
  pathExists: PathExists,
  readFile: ReadFile,
  p: typeof path.posix = path,
): WestManifestStatus {
  const configPath = p.join(topdir, ".west", "config");
  const base: Omit<WestManifestStatus, "state"> = {
    topdir,
    configPath,
    manifestPath: null,
    resolvedPath: null,
  };

  if (!pathExists(p.join(topdir, ".west"))) {
    return { ...base, state: "no-workspace" };
  }
  if (!pathExists(configPath)) return { ...base, state: "unparsable" };

  let contents: string;
  try {
    contents = readFile(configPath);
  } catch {
    return { ...base, state: "unparsable" };
  }

  const manifestPath = readManifestPath(contents);
  // An empty value must not resolve to the topdir itself and report a false
  // "ok" — treat it as unparsable, same as a missing key.
  if (manifestPath === null || manifestPath === "") {
    return { ...base, state: "unparsable" };
  }

  // west resolves `manifest.path` against the topdir; `resolve` (never `join`)
  // is what makes an already-absolute value replace the topdir rather than be
  // appended to it.
  const resolvedPath = p.resolve(topdir, manifestPath);
  return {
    ...base,
    manifestPath,
    resolvedPath,
    state: pathExists(resolvedPath) ? "ok" : "dangling",
  };
}

/**
 * The `[manifest]` section's `path` value, or null when there is no
 * `[manifest]` section, no `path` key inside it, or MORE THAN ONE of either —
 * an ambiguity strict `configparser` rejects outright, so neither should this.
 */
function readManifestPath(config: string): string | null {
  let section = "";
  let manifestSections = 0;
  const values: string[] = [];

  for (const line of config.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      // Case-SENSITIVE: configparser does not transform section names, so
      // `[Manifest]` is a different section that west will never resolve.
      section = trimmed.slice(1, -1).trim();
      if (section === "manifest") manifestSections++;
      continue;
    }
    if (section !== "manifest") continue;

    // configparser accepts both `=` and `:` as the delimiter. The key half can
    // contain neither, so a Windows value like `C:\sdk` never confuses the split.
    const match = /^([^=:]+)[=:](.*)$/.exec(trimmed);
    if (!match) continue;
    if (match[1].trim().toLowerCase() === "path") values.push(match[2].trim());
  }

  if (manifestSections !== 1 || values.length !== 1) return null;
  return values[0];
}

/**
 * The user-visible warning for a manifest status, or null when there is nothing
 * worth interrupting for. Only `dangling` warns: it is the state in which west
 * silently resolves the wrong workspace (or none).
 */
export function westManifestWarning(status: WestManifestStatus): string | null {
  if (status.state !== "dangling") return null;
  return (
    `Alp: the west workspace at ${status.topdir} points its manifest at ` +
    `"${status.manifestPath}", which no longer exists. Builds and flashes will ` +
    "use the wrong Zephyr workspace or fail."
  );
}

/**
 * The output-channel line for a manifest status, or null when there is nothing
 * to record. Carries the manual escape hatch deliberately: no shipped command
 * is a guaranteed repair. `tan bootstrap` reconciles this pointer only when it
 * does NOT reuse an existing `$ZEPHYR_BASE` workspace (tan-cli v0.3.1
 * `bootstrap/mod.rs` gates the reconcile on `!reuse`), and an ambient
 * `$ZEPHYR_BASE` is exactly what masked this failure when it was reported. The
 * wording stays action-agnostic so it reads correctly from every caller.
 */
export function westManifestLogLine(status: WestManifestStatus): string | null {
  if (status.state !== "dangling") return null;
  return (
    `west manifest dangling: ${status.configPath} [manifest] path = ` +
    `${status.manifestPath} -> ${status.resolvedPath} (missing). Bootstrap ` +
    "reconciles it only when it does not reuse an existing $ZEPHYR_BASE " +
    `workspace; otherwise set that \`path =\` to an SDK version present under ` +
    `${status.topdir}.`
  );
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

  if (isSdkVersionBelowMin(version)) {
    issues.push(
      `alp-sdk ${version} is older than the minimum supported v${MIN_SDK_VERSION} — generation targets the extension relies on (e.g. the native_sim overlay) are missing and will fail. Install v${MIN_SDK_VERSION} or newer from the SDK Manager.`,
    );
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

/**
 * True when a parsed `MAJOR.MINOR.PATCH` SDK version is strictly older than
 * `min` (tuple compare, no semver dep — mirrors the CLI's `isCliBehind`). A
 * null/unparseable version is treated as "unknown, not behind": a stale or
 * absent version file (e.g. a dev checkout whose `metadata/sdk_version.yaml`
 * lags the tag) must never mis-flag a usable SDK.
 */
export function isSdkVersionBelowMin(
  version: string | null,
  min: string = MIN_SDK_VERSION,
): boolean {
  if (!version) return false;
  const a = version.replace(/^v/i, "").split(".").map(Number);
  if (a.some(Number.isNaN)) return false;
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai < bi) return true;
    if (ai > bi) return false;
  }
  return false;
}

function deriveReadinessState(
  loaderPresent: boolean,
  issues: string[],
): SdkReadinessState {
  if (!loaderPresent) return "missing";
  if (issues.length > 0) return "partial";
  return "ready";
}
