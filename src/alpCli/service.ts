// SPDX-License-Identifier: Apache-2.0
//
// Pure logic for the tan-CLI integration: binary-source decision, envelope
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

/** The `tan` CLI version this extension build targets for download-on-demand.
 *  Must match a published `v<version>` release tag in `alplabai/tan-cli`
 *  (aligned with tan-cli's `[workspace.package] version`). */
export const SUPPORTED_CLI_VERSION = "0.3.0";

/** The repo whose GitHub releases host the prebuilt `tan` binaries. */
const RELEASE_REPO = "alplabai/tan-cli";

/** Host platform/arch → rust target triple (the six targets tan-cli publishes a
 *  raw binary for). Windows ships BOTH x64 and arm64, picked by `process.arch`. */
const TARGETS: Readonly<Record<string, string>> = {
  "win32/x64": "x86_64-pc-windows-msvc",
  "win32/arm64": "aarch64-pc-windows-msvc",
  // musl (static), not gnu: the -gnu assets carry a glibc 2.31 floor and fail
  // with "GLIBC_2.39 not found" on older distros (including the -gnu asset's
  // own build host). -musl is fully static, so it runs on any distro/libc.
  // TLS is rustls/ring, so musl needs no extra runtime deps. musl assets only
  // exist from tan-cli v0.3.0 on — see SUPPORTED_CLI_VERSION.
  "linux/x64": "x86_64-unknown-linux-musl",
  "linux/arm64": "aarch64-unknown-linux-musl",
  "darwin/x64": "x86_64-apple-darwin",
  "darwin/arm64": "aarch64-apple-darwin",
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
 * Resolution order (see EXTENSION_CLI_INTEGRATION.md §5): explicit
 * `alpSdk.cliPath` → the managed native binary (bundled `bin/tan[.exe]`
 * (platform-specific VSIX) → a locally-built sibling `tan-cli/target/
 * {release,debug}` binary → a previously cached download) → a verified-native
 * `tan` on PATH → download-on-demand. This default order is unchanged by the
 * `preferGlobalCli` opt-in below.
 *
 * `tan` on PATH is deliberately checked *last* BY DEFAULT, not second: a stale
 * or non-native `tan` on PATH could shadow the version this extension
 * targets, so preferring PATH risks silently running the wrong CLI (see
 * `isNativeTanVersionOutput`). The extension's own managed binary — one it
 * already resolved and knows is native — never depends on the caller's current
 * shell state, so it wins whenever one is already available. `onPath` here must
 * already be a verified-native result (the adapter's `commandOnPath` rejects a
 * `tan` that does not emit the native version line before this ever sees it);
 * PATH is then used as a last resort, before falling through to a fresh
 * download.
 *
 * Opt-in override — `input.preferGlobalCli` (`alpSdk.preferGlobalCli`,
 * default off): when set, a verified-native PATH `tan` is promoted to
 * outrank the extension's own managed copies (bundled/localBuild/cached),
 * closing the split-brain where the extension quietly runs a private managed
 * `tan` while the user's terminal runs a different, globally-installed one.
 * It still sits below an explicit `alpSdk.cliPath`, which always wins — that
 * setting is the user's most explicit override and must never be shadowed,
 * not even by their own global install.
 */
export function decideBinarySource(input: BinaryResolutionInput): BinarySource {
  if (input.cliPathSetting && input.cliPathExists) {
    return "cliPath";
  }
  if (input.preferGlobalCli && input.onPath) {
    return "path";
  }
  if (input.bundledExists) {
    return "bundled";
  }
  if (input.localBuildExists) {
    return "localBuild";
  }
  if (input.cachedExists) {
    return "cached";
  }
  if (input.onPath) {
    return "path";
  }
  return "download";
}

/**
 * True when `tan --version` stdout is the NATIVE (Rust/clap) CLI — e.g.
 * `tan 0.1.0`. A `tan` on PATH that does not print this exact shape (name +
 * MAJOR.MINOR.PATCH) is not the native envelope-emitting CLI: accepting it
 * would make every envelope command silently fail (`parseEnvelope` → null), so
 * callers treat a non-native PATH `tan` as "not on PATH" and resolution falls
 * through to the cached/downloaded native binary.
 *
 * Version-agnostic (any MAJOR.MINOR.PATCH) and tolerant of a trailing suffix
 * (e.g. a future `tan 0.1.0 (abc1234)`); only the first line is inspected.
 */
export function isNativeTanVersionOutput(stdout: string): boolean {
  const firstLine = stdout.trim().split(/\r?\n/, 1)[0] ?? "";
  return /^tan \d+\.\d+\.\d+/.test(firstLine);
}

/**
 * Extract the `MAJOR.MINOR.PATCH` version from `tan --version` stdout
 * (e.g. `tan 0.1.0` or `tan 0.1.0 (abc1234)`), or `null` when the output is
 * not the native CLI's version line.
 */
export function parseTanVersion(stdout: string): string | null {
  const firstLine = stdout.trim().split(/\r?\n/, 1)[0] ?? "";
  const match = /^tan (\d+)\.(\d+)\.(\d+)/.exec(firstLine);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/**
 * True when the `installed` version is strictly older than `supported`
 * (tuple compare over numeric `MAJOR.MINOR.PATCH` — no semver dep). An
 * unparseable/`null` installed version is treated as "unknown, not behind" so a
 * probe hiccup never nags the user.
 */
export function isCliBehind(
  installed: string | null,
  supported: string = SUPPORTED_CLI_VERSION,
): boolean {
  if (!installed) return false;
  const a = installed.split(".").map(Number);
  const b = supported.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai < bi) return true;
    if (ai > bi) return false;
  }
  return false;
}

/**
 * Whether activation should (re)fetch the managed `tan` binary. Fetch when
 * nothing resolves yet (`download`), OR when the resolved binary is the
 * extension's own managed cache (`cached`) AND its version is behind the pinned
 * `supported` — self-healing a stale managed install to the pin (the "tan shows
 * an old version and never updates" symptom). User/build-owned sources
 * (`cliPath` / `localBuild` / `bundled` / `path`) are never auto-replaced; the
 * per-command outdated/ahead warning nudges those instead. `cachedVersion` is
 * the parsed cached-binary version (null when unknown/unprobed → not behind).
 */
export function shouldFetchManagedCli(
  source: BinarySource,
  cachedVersion: string | null,
  supported: string = SUPPORTED_CLI_VERSION,
): boolean {
  if (source === "download") return true;
  if (source === "cached") return isCliBehind(cachedVersion, supported);
  return false;
}

/**
 * True when the `installed` version is strictly NEWER than `supported`
 * (tuple compare over numeric `MAJOR.MINOR.PATCH` — no semver dep). An
 * unparseable/`null` installed version is treated as "unknown, not ahead" so
 * a probe hiccup never nags the user (same shape as `isCliBehind`).
 */
export function isCliAhead(
  installed: string | null,
  supported: string = SUPPORTED_CLI_VERSION,
): boolean {
  if (!installed) return false;
  const a = installed.split(".").map(Number);
  const b = supported.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

/**
 * The action that actually clears an "ahead of supported" PATH-source `tan`
 * warning, chosen by `preferGlobalCli` state. Reinstalling the global tan is
 * never the answer (it fetches an even-newer latest).
 * - Flag OFF: a PATH `tan` only resolved because no managed copy exists, and
 *   the cache outranks PATH when the flag is off — so downloading the pinned
 *   version into the cache (`updateManagedCli`) restores the supported version.
 * - Flag ON: PATH outranks the managed copy, so a download can't win; the
 *   remedy is turning the preference off (`openPreferGlobalSetting`), after
 *   which a managed copy wins (a follow-up warn offers the download if none
 *   exists yet).
 */
export type AheadCliFix = "updateManagedCli" | "openPreferGlobalSetting";
export function aheadPathFixAction(preferGlobalCli: boolean): AheadCliFix {
  return preferGlobalCli ? "openPreferGlobalSetting" : "updateManagedCli";
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
      return "The tan CLI hit an internal error.";
    default:
      return "The tan CLI exited unexpectedly.";
  }
}

/** The release asset (and download URL) for a host, or null when the host has
 *  no prebuilt binary — caller should point `alpSdk.cliPath` at a dev build.
 *  tan-cli ships a RAW binary per target (not an archive): `tan-<triple>` on
 *  Unix, `tan-<triple>.exe` on Windows; the release tag is `v<version>`. */
export function releaseAssetForTarget(
  platform: NodeJS.Platform,
  arch: string,
  version: string = SUPPORTED_CLI_VERSION,
): ReleaseAsset | null {
  const target = TARGETS[`${platform}/${arch}`];
  if (!target) {
    return null;
  }
  const tag = `v${version}`;
  const assetName = `tan-${target}${platform === "win32" ? ".exe" : ""}`;
  return {
    target,
    assetName,
    tag,
    url: `https://github.com/${RELEASE_REPO}/releases/download/${tag}/${assetName}`,
  };
}

/** The on-disk binary filename for a platform. */
export function binaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "tan.exe" : "tan";
}
