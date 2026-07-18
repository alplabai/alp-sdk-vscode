// SPDX-License-Identifier: Apache-2.0
//
// VS Code wiring for the alp-CLI integration: resolve the binary (setting →
// bundled/local-build/cached → PATH (verified native, last resort) → download
// into global storage) and run envelope-mode commands.
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
  downloadCli,
  resolveAlpBinary,
  runAlp,
} from "./adapterCore";
import { CliOutcome } from "./models";
import {
  SUPPORTED_CLI_VERSION,
  binaryName,
  isCliBehind,
  isNativeAlpVersionOutput,
  parseAlpVersion,
} from "./service";
import { collectProjectContext } from "../project/vscodeAdapter";
import { log, runInTerminal } from "../util";

/** Bare binary name (not the full resolved path) for readable log lines. */
function binaryLabel(command: string): string {
  return command.split(/[\\/]/).pop() || command;
}

/** Truncate long output so a single stderr dump can't flood the channel. */
function clip(text: string, max = 4000): string {
  const t = text.trim();
  return t.length > max
    ? `${t.slice(0, max)}\n… (${t.length - max} more chars)`
    : t;
}

/**
 * Forward the extension-resolved active SDK to the CLI as a global `--sdk-root`,
 * so envelope/terminal commands (build --plan, validate, …) use the same SDK the
 * user selected (alpSdk.path / per-project override) rather than the CLI's own
 * cwd-based discovery. No-op when nothing resolves or the caller already set it.
 */
function withSdkRoot(args: string[]): string[] {
  if (args.includes("--sdk-root")) return args;
  const sdkRoot = collectProjectContext().sdkRoot;
  return sdkRoot ? ["--sdk-root", sdkRoot, ...args] : args;
}

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
  // Only present in a platform-specific VSIX (`vsce package --target <triple>`
  // stages `bin/alp[.exe]` into the extension install); the universal VSIX
  // ships no `bin/`, so this is always absent there.
  const bundledBinaryPath = path.join(
    context.extensionPath,
    "bin",
    binaryName(platform),
  );
  // A locally-built CLI under the extension path — present when running from a
  // source checkout (F5 / dev host / `code --extensionDevelopmentPath`), where
  // no `bin/` is staged and a network download may be unavailable. Prefer a
  // release build over debug. Lets the CLI-backed buttons work out of the box
  // in a checkout instead of failing with "Alp CLI unavailable".
  const localBuildBinaryPath =
    [
      path.join(
        context.extensionPath,
        "cli-rs",
        "target",
        "release",
        binaryName(platform),
      ),
      path.join(
        context.extensionPath,
        "cli-rs",
        "target",
        "debug",
        binaryName(platform),
      ),
    ].find((candidate) => fs.existsSync(candidate)) ?? null;
  return {
    cliPathSetting: vscode.workspace
      .getConfiguration("alpSdk")
      .get<string>("cliPath", "")
      .trim(),
    platform,
    arch: process.arch,
    cacheDir,
    cachedBinaryPath: path.join(cacheDir, binaryName(platform)),
    bundledBinaryPath,
    bundledExists: fs.existsSync(bundledBinaryPath),
    localBuildBinaryPath,
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

/** One-shot per window: run once to avoid nagging on every command. */
let versionChecked = false;

/**
 * Probe the resolved `alp` binary's version and, when it's older than the
 * version this extension targets, warn once with an actionable path — the
 * silent cause of missing features (e.g. project examples) when a stale CLI is
 * pinned via `alpSdk.cliPath` or left cached from an older extension build.
 * Never throws: an unresolvable binary or unparseable version is a no-op.
 */
export async function checkCliVersion(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (versionChecked) {
    return;
  }
  versionChecked = true;

  let binary: ResolvedBinary;
  try {
    binary = await resolveAlpBinaryForContext(context);
  } catch {
    return; // resolution failure is surfaced by the command that triggered it
  }
  // Probe directly (not runAlpCommand, which appends `--format json`).
  const probe = cp.spawnSync(binary.command, ["--version"], {
    encoding: "utf8",
  });
  const version = parseAlpVersion(probe.stdout ?? "");
  if (!isCliBehind(version, SUPPORTED_CLI_VERSION)) {
    return;
  }
  log(
    `[cli] resolved alp ${version} is older than supported ${SUPPORTED_CLI_VERSION} (source: ${binary.source})`,
  );

  if (binary.source === "cliPath") {
    // A user-pinned cliPath wins over the managed download, so we can't update
    // it — point the user at the setting (mirror surfaceResolutionError).
    const choice = await vscode.window.showWarningMessage(
      `The alp CLI at alpSdk.cliPath is ${version}, older than the ${SUPPORTED_CLI_VERSION} this extension expects — some features (e.g. project examples) may be missing. Update that binary, or clear the override to use the managed CLI.`,
      "Open Settings",
    );
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "alpSdk.cliPath",
      );
    }
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `The alp CLI is ${version}, older than the ${SUPPORTED_CLI_VERSION} this extension expects — some features (e.g. project examples) may be missing.`,
    "Update",
  );
  if (choice === "Update") {
    await vscode.commands.executeCommand("alp.updateCli");
  }
}

/**
 * Force-download the pinned `alp` release into the extension cache and reset
 * resolution so the next command uses it. A set `alpSdk.cliPath` wins over the
 * download, so guide the user to Settings instead of downloading a binary that
 * won't be used.
 */
export async function updateAlpCli(
  context: vscode.ExtensionContext,
): Promise<void> {
  const deps = buildResolveDeps(context);
  if (deps.cliPathSetting) {
    const choice = await vscode.window.showWarningMessage(
      "alpSdk.cliPath is set, so the managed CLI download won't be used. Clear the override to let the extension manage the alp CLI, or update that binary yourself.",
      "Open Settings",
    );
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "alpSdk.cliPath",
      );
    }
    return;
  }
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Updating the alp CLI to ${SUPPORTED_CLI_VERSION}…`,
      },
      async () => {
        await downloadCli(deps);
        resetResolvedBinary();
        versionChecked = false;
      },
    );
    void vscode.window.showInformationMessage(
      `Alp CLI updated to ${SUPPORTED_CLI_VERSION}.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Alp CLI update failed: ${message}`);
  }
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
  let binary: ResolvedBinary;
  try {
    binary = await resolveAlpBinaryForContext(context);
  } catch (error) {
    // Never throw: a resolution failure becomes an error outcome so callers
    // can present it uniformly (the message already points at alpSdk.cliPath).
    const message = error instanceof Error ? error.message : String(error);
    log(`[cli] ✗ CLI unavailable: ${message}`);
    return {
      outcome: {
        exitCode: -1,
        kind: "unknown",
        ok: false,
        severity: "error",
        message: `Alp CLI unavailable: ${message}`,
        envelope: null,
      },
      raw: {
        status: null,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error : new Error(message),
      },
    };
  }
  const finalArgs = withSdkRoot(args);
  log(
    `[cli] $ ${binaryLabel(binary.command)} ${finalArgs.join(" ")} --format json` +
      (cwd ? `  (cwd: ${cwd})` : ""),
  );
  const result = runAlp(binary.command, finalArgs, spawnAlp, cwd);
  const { outcome, raw } = result;
  if (outcome.ok) {
    log(`[cli] → ok (exit ${outcome.exitCode})`);
  } else {
    log(
      `[cli] → ${outcome.severity} (exit ${outcome.exitCode}): ${outcome.message}`,
    );
    if (raw.stderr && raw.stderr.trim()) {
      log(`[cli]   stderr: ${clip(raw.stderr)}`);
    }
  }
  return result;
}

/**
 * Run an `alp` command in a VS Code integrated terminal (terminal mode, per
 * EXTENSION_CLI_INTEGRATION.md §3): live output, interactive prompts, long
 * builds. Resolves the binary first; if it can't, surfaces a one-click action
 * to point `alpSdk.cliPath` at a build.
 */
export async function runAlpInTerminal(
  context: vscode.ExtensionContext,
  args: string[],
  options: { name: string; cwd?: string },
): Promise<void> {
  let binary: ResolvedBinary;
  try {
    binary = await resolveAlpBinaryForContext(context);
  } catch (error) {
    log(
      `[cli] ✗ CLI unavailable (terminal): ${error instanceof Error ? error.message : String(error)}`,
    );
    await surfaceResolutionError(error);
    return;
  }
  const finalArgs = withSdkRoot(args);
  log(
    `[cli] $ ${binaryLabel(binary.command)} ${finalArgs.join(" ")}  (terminal: ${options.name})`,
  );
  runInTerminal({
    name: options.name,
    argv: [binary.command, ...finalArgs],
    cwd: options.cwd,
  });
}

async function surfaceResolutionError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const choice = await vscode.window.showErrorMessage(
    `Alp CLI unavailable: ${message}`,
    "Open Settings",
  );
  if (choice === "Open Settings") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "alpSdk.cliPath",
    );
  }
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
  const probe = cp.spawnSync(command, ["--version"], { encoding: "utf8" });
  if (probe.error) {
    return false;
  }
  // A runnable `alp` is not enough. The SDK's bootstrap.sh pip-installs a Python
  // `alp` (click) into the workspace venv; with that venv active it shadows the
  // native binary on PATH and exits 0 on `--version`, but it does not emit the
  // JSON envelope — accepting it would make every envelope command silently fail
  // (parseEnvelope → null). Verify identity from `--version` so a shadowing
  // Python `alp` is treated as "not on PATH" and resolution falls through to the
  // cached/downloaded native binary.
  if (command === "alp" && !isNativeAlpVersionOutput(probe.stdout ?? "")) {
    const found =
      (probe.stdout ?? "").trim().split(/\r?\n/, 1)[0] ||
      "(no --version output)";
    log(
      `alp on PATH is not the native CLI (found: ${found}); ` +
        "using the cached/downloaded binary instead.",
    );
    return false;
  }
  return true;
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
