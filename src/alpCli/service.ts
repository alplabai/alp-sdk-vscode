// SPDX-License-Identifier: Apache-2.0
//
// Pure logic for the alp-CLI integration: binary-source decision, envelope
// parsing, exit-code classification, and release-asset resolution. No `vscode`,
// `fs`, `child_process`, or network here — all of that lives in the adapter.

import {
  AlpEnvelope,
  BinaryResolutionInput,
  BinarySource,
  CliExitKind,
  CliOutcome,
  ReleaseAsset,
} from "./models";

/** The CLI version this extension build targets for download-on-demand. Must
 *  match a published `cli-rs-v<version>` release tag. */
export const SUPPORTED_CLI_VERSION = "0.1.8";

/** The repo whose GitHub releases host the prebuilt `alp` archives. */
const RELEASE_REPO = "alplabai/alp-sdk-vscode";

/** Host platform/arch → rust target triple. Mirrors the npm shim's postinstall;
 *  Intel macOS (`darwin/x64`) has no prebuilt archive (build from source). */
const TARGETS: Readonly<Record<string, string>> = {
  "linux/x64": "x86_64-unknown-linux-gnu",
  "linux/arm64": "aarch64-unknown-linux-musl", // static — runs on glibc hosts too
  "darwin/arm64": "aarch64-apple-darwin",
  "win32/x64": "x86_64-pc-windows-msvc",
};

const EXIT_KINDS: Readonly<Record<number, CliExitKind>> = {
  0: "success",
  1: "runtime",
  2: "validation",
  3: "write",
  4: "doctor",
  5: "internal",
};

/**
 * Resolution order (locked, see EXTENSION_CLI_INTEGRATION.md §5):
 * explicit `alpSdk.cliPath` → `alp` on PATH → cached download → download.
 */
export function decideBinarySource(input: BinaryResolutionInput): BinarySource {
  if (input.cliPathSetting && input.cliPathExists) {
    return "cliPath";
  }
  if (input.onPath) {
    return "path";
  }
  if (input.cachedExists) {
    return "cached";
  }
  return "download";
}

export function classifyExitCode(code: number): CliExitKind {
  return EXIT_KINDS[code] ?? "unknown";
}

/** Parse the envelope from a command's stdout. Returns null when stdout is
 *  empty or not a well-formed envelope (so callers can fall back gracefully). */
export function parseEnvelope(stdout: string): AlpEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return isEnvelope(value) ? value : null;
}

function isEnvelope(value: unknown): value is AlpEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    typeof o.command === "string" &&
    typeof o.ok === "boolean" &&
    typeof o.exitCode === "number" &&
    Array.isArray(o.issues)
  );
}

/** Map an exit code + parsed envelope onto a UX-ready outcome. */
export function classifyOutcome(
  exitCode: number,
  envelope: AlpEnvelope | null,
): CliOutcome {
  const kind = classifyExitCode(exitCode);
  const ok = exitCode === 0;
  const severity: CliOutcome["severity"] = ok
    ? "info"
    : kind === "validation" || kind === "doctor"
      ? "warning"
      : "error";
  return {
    exitCode,
    kind,
    ok,
    severity,
    message: summarize(kind, envelope),
    envelope,
  };
}

function summarize(kind: CliExitKind, envelope: AlpEnvelope | null): string {
  const firstIssue = envelope?.issues?.[0]?.message;
  if (firstIssue) {
    return firstIssue;
  }
  switch (kind) {
    case "success":
      return "Command completed.";
    case "validation":
      return "Validation reported issues.";
    case "doctor":
      return "Diagnostics reported problems.";
    case "write":
      return "A file could not be written.";
    case "runtime":
      return "The command failed.";
    case "internal":
      return "The alp CLI hit an internal error.";
    default:
      return "The alp CLI exited unexpectedly.";
  }
}

/** The release asset (and download URL) for a host, or null when the host has
 *  no prebuilt binary (e.g. Intel macOS) — caller should point to a dev build. */
export function releaseAssetForTarget(
  platform: NodeJS.Platform,
  arch: string,
  version: string = SUPPORTED_CLI_VERSION,
): ReleaseAsset | null {
  const target = TARGETS[`${platform}/${arch}`];
  if (!target) {
    return null;
  }
  const tag = `cli-rs-v${version}`;
  const assetName = `alp-${target}.tar.gz`;
  return {
    target,
    assetName,
    tag,
    url: `https://github.com/${RELEASE_REPO}/releases/download/${tag}/${assetName}`,
  };
}

/** The on-disk binary filename for a platform. */
export function binaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "alp.exe" : "alp";
}
