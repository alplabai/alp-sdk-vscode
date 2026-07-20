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

/** A classified result ready to map onto VS Code UX (toast severity + text). */
export interface CliOutcome {
  exitCode: number;
  kind: CliExitKind;
  ok: boolean;
  severity: "info" | "warning" | "error";
  message: string;
  envelope: AlpEnvelope | null;
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
}

/** A GitHub release asset for the host target. tan-cli ships a RAW binary per
 *  target (not an archive). */
export interface ReleaseAsset {
  target: string; // rust triple, e.g. aarch64-apple-darwin
  assetName: string; // tan-<target>[.exe] (raw binary)
  tag: string; // v<version>
  url: string;
}
