// SPDX-License-Identifier: Apache-2.0
//
// VS Code wiring for the alp-CLI integration: resolve the binary (setting →
// PATH → cached → download into global storage) and run envelope-mode commands.
// All fs/process/network seams are implemented here; the testable logic lives
// in `service.ts` + `adapterCore.ts`.

import * as cp from "child_process";
import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import * as vscode from "vscode";

import {
  ResolveDeps,
  ResolvedBinary,
  SpawnResult,
  resolveAlpBinary,
  runAlp,
} from "./adapterCore";
import { CliOutcome } from "./models";
import { binaryName } from "./service";

/** Session memo so we probe PATH / download at most once per window. */
let resolved: ResolvedBinary | undefined;

/** Reset the cached resolution (e.g. when `alpSdk.cliPath` changes). */
export function resetResolvedBinary(): void {
  resolved = undefined;
}

function cacheDirFor(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "cli");
}

function buildResolveDeps(context: vscode.ExtensionContext): ResolveDeps {
  const cacheDir = cacheDirFor(context);
  const platform = process.platform;
  return {
    cliPathSetting: vscode.workspace
      .getConfiguration("alpSdk")
      .get<string>("cliPath", "")
      .trim(),
    platform,
    arch: process.arch,
    cacheDir,
    cachedBinaryPath: path.join(cacheDir, binaryName(platform)),
    fileExists: fs.existsSync,
    commandOnPath,
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    download: downloadFile,
    extractTarGz: extractTarGz,
    chmodExec: (p) => fs.chmodSync(p, 0o755),
  };
}

/** Resolve (and if needed download) the `alp` binary for this window. */
export async function resolveAlpBinaryForContext(
  context: vscode.ExtensionContext,
): Promise<ResolvedBinary> {
  if (resolved) {
    return resolved;
  }
  resolved = await resolveAlpBinary(buildResolveDeps(context));
  return resolved;
}

/**
 * Run `alp <args...> --format json`, returning the classified outcome. Surface
 * code decides how to present `outcome` (toast/diagnostics). Throws only when
 * the binary cannot be resolved at all (caller offers an install action).
 */
export async function runAlpCommand(
  context: vscode.ExtensionContext,
  args: string[],
  cwd?: string,
): Promise<{ outcome: CliOutcome; raw: SpawnResult }> {
  const binary = await resolveAlpBinaryForContext(context);
  return runAlp(binary.command, args, spawnAlp, cwd);
}

// ── real seams ───────────────────────────────────────────────────────────────

function spawnAlp(command: string, args: string[], cwd?: string): SpawnResult {
  const result = cp.spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function commandOnPath(command: string): boolean {
  const probe = cp.spawnSync(command, ["--version"], { stdio: "ignore" });
  return !probe.error;
}

function extractTarGz(archiveFile: string, destDir: string): Promise<void> {
  // `tar` ships on Linux, macOS, and Windows 10+ (bsdtar) and reads .tar.gz.
  return new Promise((resolve, reject) => {
    try {
      cp.execFileSync("tar", ["-xzf", archiveFile, "-C", destDir]);
      fs.rmSync(archiveFile, { force: true });
      resolve();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function downloadFile(url: string, destFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const status = response.statusCode ?? 0;
      // Follow GitHub's redirect to the asset CDN.
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destFile).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Download failed (HTTP ${status}) for ${url}`));
        return;
      }
      const file = fs.createWriteStream(destFile);
      response.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", (error) => {
        fs.rmSync(destFile, { force: true });
        reject(error);
      });
    });
    request.on("error", reject);
  });
}
