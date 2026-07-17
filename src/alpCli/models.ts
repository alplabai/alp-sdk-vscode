// SPDX-License-Identifier: Apache-2.0
//
// Types for invoking the native `alp` CLI from the extension. The extension
// depends only on the documented JSON envelope (see CLI.md) — this is the seam
// between the extension and the binary.

/** The stable top-level JSON envelope every `alp <cmd> --format json` emits. */
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

/** How the `alp` binary was (or will be) located. */
export type BinarySource =
  | "cliPath"
  | "path"
  | "bundled"
  | "cached"
  | "download";

export interface BinaryResolutionInput {
  /** The `alpSdk.cliPath` setting value (may be ""). */
  cliPathSetting: string;
  /** Whether `cliPathSetting` resolves to an existing file. */
  cliPathExists: boolean;
  /** Whether `alp` is on PATH. */
  onPath: boolean;
  /** Whether a `bin/alp[.exe]` staged in the extension install exists (only
   *  true in a platform-specific VSIX built with `vsce package --target`). */
  bundledExists: boolean;
  /** Whether a previously downloaded binary exists in global storage. */
  cachedExists: boolean;
}

/** A GitHub release asset for the host target (mirrors the npm shim). */
export interface ReleaseAsset {
  target: string; // rust triple, e.g. aarch64-apple-darwin
  assetName: string; // alp-<target>.tar.gz
  tag: string; // cli-rs-v<version>
  url: string;
}
