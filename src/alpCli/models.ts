// SPDX-License-Identifier: Apache-2.0
//
// Types for invoking the native `tan` CLI from the extension. The extension
// depends only on the documented JSON envelope (see CLI.md) — this is the seam
// between the extension and the binary.

/** The stable top-level JSON envelope every `tan <cmd> --format json` emits. */
export interface AlpEnvelope<T = unknown> {
  command: string;
  ok: boolean;
  exitCode: number;
  project: { root: string | null; boardYaml: string | null };
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
   * A managed download was REFUSED by checksum verification (`ChecksumError`):
   * the bytes did not match the published digest, the checksum file would not
   * fetch, or the release does not list this asset. Nothing was installed.
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
  /** The `alpSdk.preferGlobalCli` setting: when true, a verified-native `tan`
   *  on PATH is promoted above the managed bundled/localBuild/cached copies
   *  (still below an explicit `cliPathSetting`). Default false. */
  preferGlobalCli: boolean;
}

/** A GitHub release asset for the host target. tan-cli ships a RAW binary per
 *  target (not an archive). */
export interface ReleaseAsset {
  target: string; // rust triple, e.g. aarch64-apple-darwin
  assetName: string; // tan-<target>[.exe] (raw binary)
  tag: string; // v<version>
  url: string;
  /** The release's own `checksums.txt`, published at the SAME tag alongside the
   *  binaries. Part of the asset rather than a URL rebuilt at the call site, so
   *  the checksum can never be looked up against a different release than the
   *  binary came from. */
  checksumsUrl: string;
}

/** What checksum verification needs for one asset: where the release publishes
 *  its `checksums.txt`, and the exact filename to look up inside it. A `Pick` of
 *  `ReleaseAsset` rather than a parallel type, so a `ReleaseAsset` satisfies it
 *  as-is and the two can never disagree about the asset's name. */
export type ChecksumSpec = Pick<ReleaseAsset, "assetName" | "checksumsUrl">;
