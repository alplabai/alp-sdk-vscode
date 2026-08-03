// SPDX-License-Identifier: Apache-2.0
//
// Types for invoking the native `tan` CLI from the extension. The extension
// depends only on the documented JSON envelope (see CLI.md) — this is the seam
// between the extension and the binary.

/**
 * The alp-sdk checkout a command actually resolved and used, plus which
 * precedence tier produced it (tan-cli#129, `crates/tan-cli/src/envelope.rs`
 * `SdkInfo`). `sourceTier` is tan's `SdkSourceTier` — kept a plain `string`
 * because this repo does not branch on it and a closed union here would
 * reject a tier tan adds.
 */
export interface AlpSdkInfo {
  root: string;
  sourceTier: string;
}

/** The stable top-level JSON envelope every `tan <cmd> --format json` emits. */
export interface AlpEnvelope<T = unknown> {
  command: string;
  ok: boolean;
  exitCode: number;
  project: { root: string | null; boardYaml: string | null };
  /**
   * The SDK root + tier this command resolved, when one resolved at all — the
   * SEVENTH top-level key, added in tan-cli#129 and on the wire since v0.4.0.
   *
   * OPTIONAL, and not merely for old binaries: tan serializes it
   * `#[serde(skip_serializing_if = "Option::is_none")]`, so it is absent
   * ENTIRELY (not `null`) from any envelope whose command resolved no SDK —
   * most of tan v0.4.0's published goldens, as it happens. `isEnvelope`
   * therefore must NOT require it: a required `sdk` would make `parseEnvelope`
   * return `null` for all of those, and every caller reads `null` as "no
   * envelope at all" and silently falls back. That is the exact fail-open the
   * envelope contract gate exists to catch, so requiring it would be
   * manufacturing one.
   */
  sdk?: AlpSdkInfo;
  data: T;
  issues: AlpIssue[];
}

export interface AlpIssue {
  code: string;
  severity: string; // "error" | "warning" | "info" (kept open per the contract)
  message: string;
}

/** Stable CLI exit codes (CLI.md): 0 success, 1 runtime, 2 validation, 3 write,
 *  4 doctor, 5 internal. Anything else (incl. spawn failure) is "unknown". */
export type CliExitKind =
  | "success"
  | "runtime"
  | "validation"
  | "write"
  | "doctor"
  | "internal"
  | "unknown";

/**
 * Why no envelope was produced, when the cause is the BINARY rather than the
 * project. Splits "tan was never installed here" (Install is the fix) from
 * "tan is present but broken/misconfigured" (Settings/Doctor is the fix) — the
 * two read identically to a first-run user otherwise, and the wrong remedy is
 * offered for whichever half the call site guessed.
 *
 * EXTENSION-SIDE ONLY. This is not part of the `{command, ok, exitCode,
 * project, data, issues}` envelope contract with the tan CLI, which stays
 * byte-stable (CLI.md).
 */
export type CliUnavailableReason =
  /** Nothing resolved / the resolved path is gone → download or install it. */
  | "notInstalled"
  /** tan-cli publishes no prebuilt binary for this platform/arch. */
  | "noPrebuilt"
  /** `alpSdk.cliPath` points at something that isn't there. */
  | "cliPathMissing"
  /** The managed download failed (network, HTTP status, disk). */
  | "downloadFailed"
  /** A binary resolved, but `--version` says it isn't the native tan CLI. */
  | "notNative"
  /** A binary is present but unusable (not executable, truncated download). */
  | "corrupt"
  /**
   * A binary was REFUSED by checksum verification (`ChecksumError`). Five
   * causes, on two of the six resolution arms:
   *
   * `download` — the bytes did not match the published digest, the checksum
   * file would not fetch, or the release does not list this asset. Nothing was
   * installed.
   *
   * `cached` (#386) — the file at the cached path no longer hashes to the
   * digest recorded when it was downloaded, or it predates the recording
   * entirely and could not be re-acquired. Nothing was run.
   *
   * Distinct from `corrupt` — which says "the installed copy looks broken" and
   * offers `alpSdk.cliPath` — for two reasons, and neither is cosmetic. The
   * sentence would be FALSE: no copy was installed, and an already-installed
   * good one is deliberately left untouched. And `alpSdk.cliPath` resolves with
   * NO checksum path at all (`resolveAlpBinary`'s `cliPath` case), so offering
   * it mid-tamper is a one-click route to permanently executing the unverified
   * binary this refusal just stopped.
   */
  | "checksumRefused"
  /**
   * A FRESH download (case 1 — no tan resolves anywhere, digest-clean cache)
   * was refused for lack of consent — ADR 0021 Tier A. Distinct from every
   * reason above: nothing about the BINARY is wrong, the extension simply
   * has not been told it may fetch one yet (or was told not to). Never set
   * for the two heals (`updatingStaleCache`, `reacquiringUnverifiedCache`) —
   * those act on a tan the user already has and are never gated.
   */
  | "consentDeclined"
  /** The process started but couldn't be run to completion. */
  | "spawnFailed"
  /** The CLI exceeded the extension's spawn timeout. */
  | "timeout";

/** A classified result ready to map onto VS Code UX (toast severity + text). */
export interface CliOutcome {
  exitCode: number;
  kind: CliExitKind;
  ok: boolean;
  severity: "info" | "warning" | "error";
  message: string;
  envelope: AlpEnvelope | null;
  /** Set ONLY when no envelope exists because the binary itself failed.
   *  `detail` holds the raw errno / HTTP / path text and MUST NOT be
   *  interpolated into anything the customer sees — the notification planner
   *  routes it to the "Alp SDK" output channel (`NotificationPlan.detail`). */
  unavailable?: { reason: CliUnavailableReason; detail?: string };
}

/** How the `tan` binary was (or will be) located. */
export type BinarySource =
  | "cliPath"
  | "path"
  | "bundled"
  | "localBuild"
  | "cached"
  | "download";

export interface BinaryResolutionInput {
  /** The `alpSdk.cliPath` setting value (may be ""). */
  cliPathSetting: string;
  /** Whether `cliPathSetting` resolves to an existing file. */
  cliPathExists: boolean;
  /** Whether `tan` is on PATH. */
  onPath: boolean;
  /** Whether a `bin/tan[.exe]` staged in the extension install exists (only
   *  true in a platform-specific VSIX built with `vsce package --target`). */
  bundledExists: boolean;
  /** Whether a locally-built sibling `tan-cli/target/{release,debug}/tan[.exe]`
   *  exists next to the extension path — true when running from a source
   *  checkout with a built tan, so the CLI resolves without a network download. */
  localBuildExists: boolean;
  /** Whether a previously downloaded binary exists in global storage. */
  cachedExists: boolean;
  /**
   * Whether this extension holds the sha256 it verified for THAT cached file
   * (`ResolveDeps.recordedCachedDigest`). Every copy cached before the digest
   * was recorded has none — that is the #386 migration, and it is why this is
   * a separate field instead of being folded into `cachedExists`: a reader of
   * `decideBinarySource` has to be able to see that an unvouched-for cache is
   * skipped rather than resolved.
   *
   * FAIL-CLOSED, and required rather than optional for that reason: a missing
   * record means "cannot be checked", never "assume it is fine". Accepting an
   * unrecorded binary and recording its current digest would launder the very
   * bytes #386 is about into a "verified" state.
   */
  cachedDigestRecorded: boolean;
  /** The `alpSdk.preferGlobalCli` setting: when true, a verified-native `tan`
   *  on PATH is promoted above the managed bundled/localBuild/cached copies
   *  (still below an explicit `cliPathSetting`). Default false. */
  preferGlobalCli: boolean;
}

/** One name tan-cli might have published a target's asset under, and the URL
 *  it would live at for a given release. */
export interface ReleaseAssetCandidate {
  assetName: string;
  url: string;
}

/** A `ReleaseAssetCandidate` that has been resolved against the release's own
 *  `checksums.txt` — i.e. the candidate `resolvePublishedAsset` (download.ts)
 *  picked, PLUS the digest that same read of the manifest already found for
 *  it. #465: carrying `digest` forward is what lets `download` skip fetching
 *  `checksums.txt` a second time to re-derive the exact value this resolution
 *  step already had — see `ChecksumSpec.digest`. */
export interface ResolvedAssetCandidate extends ReleaseAssetCandidate {
  digest: string;
}

/** A GitHub release asset for the host target — GitHub Release, not a single
 *  known filename. tan-cli published a RAW binary per target through
 *  v0.5.0-rc4 (`tan-<target>[.exe]`); a release built with the archive freeze
 *  (tan-cli#349) publishes the same target under a DIFFERENT name instead —
 *  `tan-<target>.zip` (win32) / `tan-<target>.tar.gz` (elsewhere) — because the
 *  archive holds a onedir tree, not a single file. Both possible names are
 *  listed in `candidates`; which one a given release actually used is decided
 *  from that release's own `checksums.txt` (`resolvePublishedAsset` in
 *  download.ts), never guessed from a version number (#463: a per-version
 *  table needs editing on every release and silently breaks a pin nobody
 *  remembered to update — the same trap `HOSTS_WITHOUT_RELEASE_ASSET` and
 *  `RELEASES_PREDATING_CONTRACT_ASSET` in service.ts exist to avoid for their
 *  own questions). There is deliberately no top-level `assetName`/`url` here:
 *  a single "the" name is exactly the assumption that 404'd on the first
 *  archive release, and reintroducing one would just move the footgun. */
export interface ReleaseAsset {
  target: string; // rust triple, e.g. aarch64-apple-darwin
  tag: string; // v<version>
  /** The release's own `checksums.txt`, published at the SAME tag alongside the
   *  binaries. Part of the asset rather than a URL rebuilt at the call site, so
   *  the checksum can never be looked up against a different release than the
   *  binary came from. Release-level, not per-candidate: both names below, if
   *  either is published, are vouched for by this SAME file. */
  checksumsUrl: string;
  /** [raw-binary name, archive name] — see the type doc above. Always both,
   *  regardless of which (if either) `SUPPORTED_CLI_VERSION` actually
   *  publishes; a real release is expected to have an entry in its
   *  `checksums.txt` for exactly one. */
  candidates: readonly [ReleaseAssetCandidate, ReleaseAssetCandidate];
}

/** What checksum verification needs for one RESOLVED asset: where the release
 *  publishes its `checksums.txt`, and the exact filename to look up inside it.
 *  Deliberately not a `Pick` of `ReleaseAsset` any more — `ReleaseAsset` now
 *  carries two candidate names, and this type exists precisely to hold the
 *  ONE that was actually selected (`resolvePublishedAsset`), so a caller can
 *  never absent-mindedly pass the whole candidate set where a single verified
 *  name belongs. */
export interface ChecksumSpec {
  assetName: string;
  checksumsUrl: string;
  /** The digest to verify against, when the caller already has it (#465) —
   *  `downloadCli` fills this from `resolveAsset`'s `ResolvedAssetCandidate`,
   *  which read `checksumsUrl` to pick the candidate in the first place, so
   *  re-fetching the same file here would just re-derive a value already in
   *  hand. OPTIONAL, and deliberately not required: the transfer-mechanics
   *  tests, and any future caller that has an asset name but no prior read of
   *  the manifest, still work by leaving this unset — `downloadFile` fetches
   *  and parses `checksumsUrl` itself in that case, exactly as it always did. */
  digest?: string;
}
