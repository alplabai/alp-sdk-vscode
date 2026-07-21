// SPDX-License-Identifier: Apache-2.0
//
// VS Code wiring for the tan-CLI integration: resolve the binary (setting →
// bundled/local-build/cached → PATH (verified native, last resort by default;
// promoted above bundled/local-build/cached when alpSdk.preferGlobalCli is
// on) → download into global storage) and run envelope-mode commands.
// All fs/process/network seams are implemented here; the testable logic lives
// in `service.ts` + `adapterCore.ts`.

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import {
  ResolveDeps,
  ResolvedBinary,
  SpawnResult,
  downloadCli,
  resolutionInputFromDeps,
  resolveAlpBinary,
  runAlp,
} from "./adapterCore";
import { downloadFile } from "./download";
import { BinarySource, CliOutcome } from "./models";
import {
  SUPPORTED_CLI_VERSION,
  aheadPathFixAction,
  binaryName,
  decideBinarySource,
  isCliAhead,
  isCliBehind,
  isNativeTanVersionOutput,
  parseTanVersion,
  releaseAssetForTarget,
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

/** Reset the cached resolution (e.g. when `alpSdk.cliPath` or
 *  `alpSdk.preferGlobalCli` changes), and re-arm the one-shot version check so
 *  a repointed binary gets re-probed instead of staying silently unchecked
 *  for the rest of the window. */
export function resetResolvedBinary(): void {
  resolved = undefined;
  versionChecked = false;
}

function cacheDirFor(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "cli");
}

function buildResolveDeps(context: vscode.ExtensionContext): ResolveDeps {
  const cacheDir = cacheDirFor(context);
  const platform = process.platform;
  // Only present in a platform-specific VSIX (`vsce package --target <triple>`
  // stages `bin/tan[.exe]` into the extension install); the universal VSIX
  // ships no `bin/`, so this is always absent there.
  const bundledBinaryPath = path.join(
    context.extensionPath,
    "bin",
    binaryName(platform),
  );
  // A locally-built tan from a SIBLING `tan-cli` checkout — present when running
  // from a source checkout with both repos cloned side by side (F5 / dev host /
  // `code --extensionDevelopmentPath`), where no `bin/` is staged and a network
  // download may be unavailable. Prefer a release build over debug. In an
  // installed VSIX `../tan-cli` does not exist, so this is null and resolution
  // falls through to the cached/downloaded binary.
  const siblingTanCli = path.join(context.extensionPath, "..", "tan-cli");
  const localBuildBinaryPath =
    [
      path.join(siblingTanCli, "target", "release", binaryName(platform)),
      path.join(siblingTanCli, "target", "debug", binaryName(platform)),
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
    preferGlobalCli: vscode.workspace
      .getConfiguration("alpSdk")
      .get<boolean>("preferGlobalCli", false),
    fileExists: fs.existsSync,
    commandOnPath,
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    download: downloadFile,
    chmodExec: (p) => fs.chmodSync(p, 0o755),
  };
}

/** Resolve (and if needed download) the `tan` binary for this window. */
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
 * Ensure the managed `tan` binary is present up front (called on activation) so
 * a fresh install feels "installed together" instead of stalling on the first
 * command. Only fetches when nothing else resolves — a download would happen on
 * first use anyway — and surfaces it with a one-time progress notification.
 * Never throws: a failure here is logged and the normal per-command resolution
 * ladder still runs (and can retry the download) later.
 */
export async function ensureTanCliProvisioned(
  context: vscode.ExtensionContext,
): Promise<void> {
  const deps = buildResolveDeps(context);
  const input = resolutionInputFromDeps(deps);

  warnIfPreferGlobalCliHasNoPath(deps.preferGlobalCli, input.onPath);

  // A binary already resolves (cliPath / bundled / local build / cached / PATH)
  // — nothing to fetch. With `preferGlobalCli` on and a PATH `tan` present,
  // this correctly resolves to `path` rather than `download`, so activation
  // does not fetch a shadow managed copy the user didn't ask for.
  if (decideBinarySource(input) !== "download") {
    return;
  }
  // No prebuilt binary for this host: skip silently (a command will surface the
  // "set alpSdk.cliPath" guidance if the user actually invokes one).
  if (!releaseAssetForTarget(deps.platform, deps.arch)) {
    return;
  }
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Downloading the tan CLI…",
      },
      async () => {
        await downloadCli(deps);
        resetResolvedBinary();
      },
    );
  } catch (error) {
    log(
      `[cli] tan CLI provisioning failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** One-shot per window: `alpSdk.preferGlobalCli` is on but no verified-native
 *  `tan` resolved on the extension host's PATH, so the flag is silently a
 *  no-op — a known macOS-shell-env class where e.g. `~/.local/bin` is on the
 *  terminal's PATH but not the extension host's. Logs loudly and nudges the
 *  user once; never blocks and never suppresses the normal download ladder,
 *  which still correctly provisions the managed copy in this case. */
let preferGlobalCliNoPathWarned = false;

function warnIfPreferGlobalCliHasNoPath(
  preferGlobalCli: boolean,
  onPath: boolean,
): void {
  if (!preferGlobalCli || onPath || preferGlobalCliNoPathWarned) {
    return;
  }
  preferGlobalCliNoPathWarned = true;
  log(
    "[cli] alpSdk.preferGlobalCli is on, but no verified-native tan resolved " +
      "on PATH from this window (the extension host's PATH can diverge from " +
      "your terminal's, e.g. ~/.local/bin on macOS) — falling back to the " +
      "managed tan CLI for now.",
  );
  void vscode.window
    .showWarningMessage(
      "alpSdk.preferGlobalCli is on, but no tan CLI was found on PATH from " +
        "this window. Install a global tan, or clear alpSdk.preferGlobalCli " +
        "to use the extension's managed copy.",
      "Install tan CLI (global)",
      "Open Settings",
    )
    .then((choice) => {
      if (choice === "Install tan CLI (global)") {
        void vscode.commands.executeCommand("alp.installTanCli");
      } else if (choice === "Open Settings") {
        void vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "alpSdk.preferGlobalCli",
        );
      }
    });
}

/** One-shot per window: run once to avoid nagging on every command. */
let versionChecked = false;

/** The one-click action (if any) that can actually fix a stale/broken
 *  `source` on the NEXT resolution. `decideBinarySource` (service.ts) ranks
 *  `bundled` and `localBuild` ABOVE the managed cache, so `alp.updateCli`
 *  downloading a fresh binary into `cacheDir` would silently keep losing to
 *  either of them — offering "Update" there is a dead-end action that leaves
 *  the user thinking they fixed it. `cliPath` needs the setting changed;
 *  every other source (`cached`/`path`/`download`) sits at or below the cache
 *  in that ranking BY DEFAULT, so a fresh download does win next time —
 *  EXCEPT `path` when `preferGlobalCli` is on: it re-ranks `path` ABOVE
 *  `bundled`/`localBuild`/`cached` (service.ts), so `alp.updateCli` would
 *  again be a dead end there (it downloads into the cache, which `path` now
 *  outranks) — offer re-running the global installer instead. */
function cliFixAction(
  source: BinarySource,
  preferGlobalCli: boolean,
): {
  label: "Open Settings" | "Update" | "Install tan CLI (global)";
  command: string;
  arg?: string;
} | null {
  switch (source) {
    case "cliPath":
      return {
        label: "Open Settings",
        command: "workbench.action.openSettings",
        arg: "alpSdk.cliPath",
      };
    case "bundled":
    case "localBuild":
      return null;
    case "path":
      if (preferGlobalCli) {
        return {
          label: "Install tan CLI (global)",
          command: "alp.installTanCli",
        };
      }
      return { label: "Update", command: "alp.updateCli" };
    default:
      return { label: "Update", command: "alp.updateCli" };
  }
}

/** Show `message` with whatever action `cliFixAction(binary.source, …)`
 *  offers (or no action button for a `bundled`/`localBuild` source `message`
 *  should already explain how to actually fix). */
async function warnAboutResolvedBinary(
  binary: ResolvedBinary,
  message: string,
  preferGlobalCli: boolean,
): Promise<void> {
  const fix = cliFixAction(binary.source, preferGlobalCli);
  if (!fix) {
    await vscode.window.showWarningMessage(message);
    return;
  }
  const choice = await vscode.window.showWarningMessage(message, fix.label);
  if (choice !== fix.label) {
    return;
  }
  if (fix.arg) {
    await vscode.commands.executeCommand(fix.command, fix.arg);
  } else {
    await vscode.commands.executeCommand(fix.command);
  }
}

/** Message for a resolved binary whose `--version` output isn't the native
 *  `tan <MAJOR.MINOR.PATCH>` line at all — worded per source since the cause
 *  (and the fix) differs: a leftover retired `alp` binary pinned via
 *  `alpSdk.cliPath`, a stale bundled/local build, or a managed binary
 *  corrupted by an old non-atomic download. */
function nonNativeCliMessage(binary: ResolvedBinary, found: string): string {
  const printed = `\`--version\` printed "${found}" instead of "tan <version>"`;
  switch (binary.source) {
    case "cliPath":
      return `The binary at alpSdk.cliPath (${binary.command}) doesn't look like the native tan CLI — ${printed}. This may be the retired alp CLI or a corrupted binary. Point the setting at a tan build, or clear the override to use the managed CLI.`;
    case "bundled":
      return `The tan binary bundled with this extension install (${binary.command}) doesn't look like the native tan CLI — ${printed}. Reinstall from a current .vsix to refresh it.`;
    case "localBuild":
      return `The local tan-cli build (${binary.command}) doesn't look like the native tan CLI — ${printed}. Rebuild the sibling tan-cli checkout.`;
    default:
      return `The managed tan CLI (${binary.command}) doesn't look like the native tan CLI — ${printed}. It may be corrupted from an old download.`;
  }
}

/** Message for a resolved binary that's older than `SUPPORTED_CLI_VERSION`,
 *  worded per source for the same reason as `nonNativeCliMessage`. */
function outdatedCliMessage(binary: ResolvedBinary, version: string): string {
  const behind = `is ${version}, older than the ${SUPPORTED_CLI_VERSION} this extension expects — some features (e.g. project examples) may be missing`;
  switch (binary.source) {
    case "cliPath":
      return `The tan CLI at alpSdk.cliPath ${behind}. Update that binary, or clear the override to use the managed CLI.`;
    case "bundled":
      return `The tan binary bundled with this extension install (${binary.command}) ${behind}. Reinstall from a current .vsix to refresh it.`;
    case "localBuild":
      return `The local tan-cli build (${binary.command}) ${behind}. Rebuild the sibling tan-cli checkout.`;
    default:
      return `The tan CLI ${behind}.`;
  }
}

/** Message for a `path`-source tan that's NEWER than `SUPPORTED_CLI_VERSION`
 *  (only meaningful for `path`, under `alpSdk.preferGlobalCli`: a bundled/
 *  cached/local-build binary is the version this extension shipped or
 *  fetched itself, so it can never be ahead of what this build targets —
 *  only a PATH `tan` the user installed independently can be). */
function aheadCliMessage(binary: ResolvedBinary, version: string): string {
  return `The tan CLI on PATH (${binary.command}) is ${version}, newer than the ${SUPPORTED_CLI_VERSION} this extension was built/tested against — some flags or envelope fields may differ from what this extension expects.`;
}

/**
 * Probe the resolved `tan` binary's version and, when it's older than the
 * version this extension targets (or isn't the native CLI at all), warn once
 * with whichever action actually fixes it — the silent cause of missing
 * features (e.g. project examples) when a stale CLI is pinned via
 * `alpSdk.cliPath` or left cached from an older extension build.
 * Never throws: an unresolvable binary is a no-op; a `--version` spawn
 * failure (ENOENT/EACCES/timeout — the probe couldn't even exec the binary)
 * tells us nothing about the binary's identity, so it's logged and NOT
 * treated as "not the native CLI".
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
  const preferGlobalCli = vscode.workspace
    .getConfiguration("alpSdk")
    .get<boolean>("preferGlobalCli", false);
  // Probe directly (not runAlpCommand, which appends `--format json`). A 5s
  // cap so a hung binary can't block the extension host main thread forever.
  const probe = cp.spawnSync(binary.command, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (probe.error) {
    // Couldn't even exec it (ENOENT, EACCES, or — on Windows — a `.cmd`/
    // `.bat` wrapper spawnSync can't run without a shell): that's not
    // evidence the binary is the retired CLI or corrupted, just that this
    // probe failed. Log it and stay silent rather than accuse.
    log(
      `[cli] --version probe failed for ${binary.command} (status ${probe.status}): ${probe.error.message}`,
    );
    return;
  }
  const version = parseTanVersion(probe.stdout ?? "");

  if (version === null) {
    // `isCliBehind(null, …)` treats an unparseable version as "unknown, not
    // behind" and stays silent — but a resolved binary that ran and printed
    // something that isn't the native `tan <MAJOR.MINOR.PATCH>` line is a
    // real signal, not a probe hiccup. Warn explicitly instead of silently
    // running it forever.
    const found =
      (probe.stdout ?? "").trim().split(/\r?\n/, 1)[0] ||
      "(no --version output)";
    log(
      `[cli] resolved binary at ${binary.command} is not the native tan CLI (found: ${found}; source: ${binary.source})`,
    );
    await warnAboutResolvedBinary(
      binary,
      nonNativeCliMessage(binary, found),
      preferGlobalCli,
    );
    return;
  }

  if (isCliBehind(version, SUPPORTED_CLI_VERSION)) {
    log(
      `[cli] resolved tan ${version} is older than supported ${SUPPORTED_CLI_VERSION} (source: ${binary.source})`,
    );
    await warnAboutResolvedBinary(
      binary,
      outdatedCliMessage(binary, version),
      preferGlobalCli,
    );
    return;
  }

  // Ahead-of-supported is only worth flagging for a `path` source: a bundled/
  // cached/local-build binary is one this extension shipped or fetched
  // itself, so it can't be ahead of what this build targets.
  if (binary.source === "path" && isCliAhead(version, SUPPORTED_CLI_VERSION)) {
    log(
      `[cli] resolved tan ${version} on PATH is newer than supported ${SUPPORTED_CLI_VERSION}`,
    );
    // Reinstalling is never the remedy (the installer fetches an even-newer
    // latest); the fix depends on the flag (see `aheadPathFixAction`). Flag
    // off → download the pinned version into the cache (which outranks PATH
    // when off); flag on → turn the preference off so a managed copy wins.
    const fix = aheadPathFixAction(preferGlobalCli);
    const label = fix === "updateManagedCli" ? "Update" : "Open Settings";
    const choice = await vscode.window.showWarningMessage(
      aheadCliMessage(binary, version),
      label,
    );
    if (choice === label) {
      if (fix === "updateManagedCli") {
        await vscode.commands.executeCommand("alp.updateCli");
      } else {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "alpSdk.preferGlobalCli",
        );
      }
    }
  }
}

/**
 * Force-download the pinned `tan` release into the extension cache and reset
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
      "alpSdk.cliPath is set, so the managed CLI download won't be used. Clear the override to let the extension manage the tan CLI, or update that binary yourself.",
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
        title: `Updating the tan CLI to ${SUPPORTED_CLI_VERSION}…`,
      },
      async () => {
        await downloadCli(deps);
        resetResolvedBinary();
      },
    );
    void vscode.window.showInformationMessage(
      `tan CLI updated to ${SUPPORTED_CLI_VERSION}.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`tan CLI update failed: ${message}`);
  }
}

/**
 * Run the bundled tan-cli install script (`media/tan-install/install.sh` /
 * `install.ps1`, vendored copies of alplabai/tan-cli's own installer — see the
 * README in that directory) in an integrated terminal, so the user gets a
 * `tan` binary on their PATH usable in ANY terminal — distinct from
 * `resolveAlpBinaryForContext`'s managed download above, which stays private
 * to this extension's global storage and is never put on PATH. Runs in a
 * terminal (not a silent child process) so the user sees the download
 * progress and any PATH/sudo notice the script prints.
 */
export function installTanCliGlobally(context: vscode.ExtensionContext): void {
  const scriptDir = path.join(context.extensionPath, "media", "tan-install");
  const isWindows = process.platform === "win32";
  const script = path.join(scriptDir, isWindows ? "install.ps1" : "install.sh");
  // Guard a packaging regression: a missing bundled script would otherwise
  // surface only as a raw "sh: …: No such file" (exit 127) in the terminal.
  if (!fs.existsSync(script)) {
    void vscode.window.showErrorMessage(
      `The bundled tan installer is missing (${script}). Try reinstalling the Alp SDK extension.`,
    );
    return;
  }
  const argv = isWindows
    ? ["powershell", "-ExecutionPolicy", "Bypass", "-File", script]
    : ["sh", script];
  log(`[cli] $ ${argv.join(" ")}  (terminal: Install tan)`);
  runInTerminal({ name: "Install tan", argv });
}

/**
 * Run `tan <args...> --format json`, returning the classified outcome. Surface
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
        message: `tan CLI unavailable: ${message}`,
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
 * Run a `tan` command in a VS Code integrated terminal (terminal mode, per
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
    `tan CLI unavailable: ${message}`,
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

// TODO(preferGlobalCli): capture absolute path to close terminal-vs-ext-host
// PATH divergence — see `warnIfPreferGlobalCliHasNoPath` above.
function commandOnPath(command: string): boolean {
  // A 5s cap so a hung binary on PATH can't block the extension host.
  const probe = cp.spawnSync(command, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (probe.error) {
    return false;
  }
  // A runnable `tan` is not enough: a stale or non-native `tan` on PATH could
  // exit 0 on `--version` yet not emit the JSON envelope — accepting it would
  // make every envelope command silently fail (parseEnvelope → null). Verify
  // identity from `--version` (`tan <MAJOR.MINOR.PATCH>`) so a non-native `tan`
  // is treated as "not on PATH" and resolution falls through to the cached/
  // downloaded native binary.
  if (command === "tan" && !isNativeTanVersionOutput(probe.stdout ?? "")) {
    const found =
      (probe.stdout ?? "").trim().split(/\r?\n/, 1)[0] ||
      "(no --version output)";
    log(
      `tan on PATH is not the native CLI (found: ${found}); ` +
        "using the cached/downloaded binary instead.",
    );
    return false;
  }
  return true;
}
