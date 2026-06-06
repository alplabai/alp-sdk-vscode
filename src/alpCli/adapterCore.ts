// SPDX-License-Identifier: Apache-2.0
//
// IO orchestration for the alp-CLI integration, written against injected seams
// (filesystem / process / network) so it is unit-testable without `vscode`.
// The thin `vscodeAdapter` wires the real implementations.

import { BinaryResolutionInput, BinarySource, CliOutcome } from "./models";
import {
  classifyOutcome,
  decideBinarySource,
  parseEnvelope,
  releaseAssetForTarget,
} from "./service";

/** Normalized result of spawning a process (mirrors child_process.spawnSync). */
export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type SpawnFn = (
  command: string,
  args: string[],
  cwd?: string,
) => SpawnResult;

/** Seams the resolver needs; the adapter supplies real fs/net/process impls. */
export interface ResolveDeps {
  cliPathSetting: string;
  platform: NodeJS.Platform;
  arch: string;
  /** Directory under global storage that holds the cached binary + archive. */
  cacheDir: string;
  /** Absolute path the cached binary would live at (cacheDir + binaryName). */
  cachedBinaryPath: string;
  fileExists: (path: string) => boolean;
  commandOnPath: (command: string) => boolean;
  ensureDir: (dir: string) => void;
  download: (url: string, destFile: string) => Promise<void>;
  extractTarGz: (archiveFile: string, destDir: string) => Promise<void>;
  chmodExec: (path: string) => void;
}

export interface ResolvedBinary {
  command: string;
  source: BinarySource;
}

/**
 * Resolve the `alp` command to invoke, downloading on demand when nothing else
 * is available. Throws when the host has no prebuilt binary and none is
 * configured/on PATH, or when a download fails — the surface maps that to a
 * one-click "install the Alp CLI" action.
 */
export async function resolveAlpBinary(
  deps: ResolveDeps,
): Promise<ResolvedBinary> {
  const input: BinaryResolutionInput = {
    cliPathSetting: deps.cliPathSetting,
    cliPathExists:
      Boolean(deps.cliPathSetting) && deps.fileExists(deps.cliPathSetting),
    onPath: deps.commandOnPath("alp"),
    cachedExists: deps.fileExists(deps.cachedBinaryPath),
  };

  const source = decideBinarySource(input);
  switch (source) {
    case "cliPath":
      return { command: deps.cliPathSetting, source };
    case "path":
      return { command: "alp", source };
    case "cached":
      return { command: deps.cachedBinaryPath, source };
    case "download":
      await downloadCli(deps);
      if (!deps.fileExists(deps.cachedBinaryPath)) {
        throw new Error("The alp CLI download did not produce a binary.");
      }
      return { command: deps.cachedBinaryPath, source };
  }
}

async function downloadCli(deps: ResolveDeps): Promise<void> {
  const asset = releaseAssetForTarget(deps.platform, deps.arch);
  if (!asset) {
    throw new Error(
      `No prebuilt alp CLI for ${deps.platform}/${deps.arch}. ` +
        "Set alpSdk.cliPath to a local build (cli-rs/target/release/alp).",
    );
  }
  deps.ensureDir(deps.cacheDir);
  const archive = joinPosix(deps.cacheDir, asset.assetName);
  await deps.download(asset.url, archive);
  await deps.extractTarGz(archive, deps.cacheDir);
  if (deps.platform !== "win32") {
    deps.chmodExec(deps.cachedBinaryPath);
  }
}

/**
 * Run an envelope-mode command: `alp <args...> --format json`. Parses the
 * envelope and classifies the outcome. A spawn failure (e.g. ENOENT) yields an
 * `unknown`/error outcome rather than throwing.
 */
export function runAlp(
  command: string,
  args: string[],
  spawn: SpawnFn,
  cwd?: string,
): { outcome: CliOutcome; raw: SpawnResult } {
  const raw = spawn(command, [...args, "--format", "json"], cwd);
  if (raw.error) {
    return {
      outcome: {
        exitCode: -1,
        kind: "unknown",
        ok: false,
        severity: "error",
        message: `Could not run the alp CLI: ${raw.error.message}`,
        envelope: null,
      },
      raw,
    };
  }
  const envelope = parseEnvelope(raw.stdout);
  // Prefer the process exit code; fall back to the envelope's own field.
  const exitCode = raw.status ?? envelope?.exitCode ?? 1;
  return { outcome: classifyOutcome(exitCode, envelope), raw };
}

function joinPosix(dir: string, file: string): string {
  return dir.endsWith("/") ? `${dir}${file}` : `${dir}/${file}`;
}
