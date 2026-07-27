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
import { promisify } from "util";
import * as vscode from "vscode";

import {
  ResolveDeps,
  ResolvedBinary,
  SpawnResult,
  downloadCli,
  resolutionInputFromDeps,
  resolveAlpBinary,
  runAlpAsync,
} from "./adapterCore";
import { downloadFile } from "./download";
import { BinarySource, CliOutcome } from "./models";
import {
  SUPPORTED_CLI_VERSION,
  aheadPathFixAction,
  binaryName,
  classifyUnavailable,
  decideBinarySource,
  isCliAhead,
  isCliBehind,
  isNativeTanVersionOutput,
  parseTanVersion,
  releaseAssetForTarget,
  shouldFetchManagedCli,
} from "./service";
import { ActionId, NotifyAction } from "../notify/models";
import { planCliOutcome, planFailure, planSuccess } from "../notify/service";
import { notify, notifyAsync } from "../notify/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import { log, runInTerminal } from "../util";

const execFileAsyncCli = promisify(cp.execFile);

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

/** globalState key holding the SUPPORTED_CLI_VERSION for which stale-cache
 *  self-heal already downloaded the pin and the binary STILL read behind (a
 *  mis-published release, or a pin bumped ahead of the published binary).
 *  Persisted so a futile re-download + toast doesn't repeat on every future
 *  activation; a pin change re-arms the attempt. */
const HEAL_GAVE_UP_KEY = "alp.tanSelfHealGaveUpPin";

/** Best-effort human-readable size of a just-downloaded file, for the transfer
 *  log. Returns "unknown size" when the file can't be stat'd. */
function downloadedBytes(filePath: string): string {
  try {
    return `${fs.statSync(filePath).size} bytes`;
  } catch {
    return "unknown size";
  }
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
 * The installed native `tan` version, or null — WITHOUT ever downloading.
 * Called from state refresh (focus/save/settings), so it must never fetch: if
 * nothing resolves locally (`decideBinarySource === "download"`) it returns
 * null immediately. Otherwise it resolves the already-present binary (no
 * download in a non-download branch) and parses `tan --version`; a non-native
 * `tan` on PATH parses to null (parseTanVersion guards the shape).
 */
export async function probeTanVersion(
  context: vscode.ExtensionContext,
): Promise<string | null> {
  const deps = buildResolveDeps(context);
  // Resolve through the shared seam so this probe honors `preferGlobalCli`
  // exactly like activation-time provisioning (no split-brain on which binary
  // the version is read from).
  const input = resolutionInputFromDeps(deps);
  if (decideBinarySource(input) === "download") return null;
  return readResolvedCliVersion(deps);
}

/**
 * Ensure the managed `tan` binary is present up front (called on activation) so
 * a fresh install feels "installed together" instead of stalling on the first
 * command. Fetches when nothing else resolves (a download would happen on first
 * use anyway), or self-heals a managed *cached* copy that's fallen behind the
 * pinned SUPPORTED_CLI_VERSION; surfaced with a one-time progress notification.
 * User/build-owned sources are never auto-replaced (see shouldFetchManagedCli).
 * Never throws: a failure here is logged and the normal per-command resolution
 * ladder still runs (and can retry the download) later.
 */
export async function ensureTanCliProvisioned(
  context: vscode.ExtensionContext,
): Promise<void> {
  const deps = buildResolveDeps(context);
  const input = resolutionInputFromDeps(deps);

  warnIfPreferGlobalCliHasNoPath(deps.preferGlobalCli, input.onPath);

  const source = decideBinarySource(input);
  // A binary already resolves (cliPath / bundled / local build / cached / PATH)
  // — nothing to fetch, EXCEPT a managed *cached* copy behind the pin, which is
  // the extension's own to self-heal (see shouldFetchManagedCli). Only probe the
  // cached binary's version when it can change the decision. With
  // `preferGlobalCli` on and a PATH `tan` present, source is `path`, so
  // activation does not fetch a shadow managed copy the user didn't ask for.
  const cachedVersion =
    source === "cached" ? await readResolvedCliVersion(deps) : null;
  if (!shouldFetchManagedCli(source, cachedVersion)) {
    return;
  }
  // Reached the fetch: a `download` source is a fresh provision; a `cached`
  // source here means the managed copy is behind the pin — an update.
  const updatingStaleCache = source === "cached";
  // Don't re-attempt a self-heal we already proved futile for this pin (the
  // fetched pin's binary still read behind — a mis-published release). Bounds
  // the download + toast to once per pin across activations; a pin bump re-arms.
  if (
    updatingStaleCache &&
    context.globalState.get<string>(HEAL_GAVE_UP_KEY) === SUPPORTED_CLI_VERSION
  ) {
    return;
  }
  // No prebuilt binary for this host: skip silently (a command will surface the
  // "set alpSdk.cliPath" guidance if the user actually invokes one).
  if (!releaseAssetForTarget(deps.platform, deps.arch)) {
    return;
  }
  let cancelled = false;
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: updatingStaleCache
          ? `Updating the tan CLI to ${SUPPORTED_CLI_VERSION}…`
          : "Downloading the tan CLI…",
        // A binary fetch over a slow link is the longest thing that can happen
        // on first activation; without Cancel it reads as a hung window.
        cancellable: true,
      },
      async (_progress, token) => {
        const controller = new AbortController();
        const sub = token.onCancellationRequested(() => {
          cancelled = true;
          controller.abort();
        });
        try {
          const asset = releaseAssetForTarget(deps.platform, deps.arch);
          log(`[cli] downloading tan CLI: ${asset?.url ?? "unknown asset"}`);
          await downloadCli(deps, controller.signal);
          log(
            `[cli] tan CLI downloaded (${downloadedBytes(deps.cachedBinaryPath)}) to ${deps.cachedBinaryPath}`,
          );
          resetResolvedBinary();
          if (updatingStaleCache) {
            // Verify the freshly-fetched pin actually cleared the skew. If the
            // downloaded binary still reads behind, the published release is
            // mis-tagged (or the pin outran it) — record it so we stop retrying
            // this pin every activation. A correct release clears the flag.
            const healed = await readResolvedCliVersion(deps);
            if (isCliBehind(healed)) {
              log(
                `[cli] tan self-heal fetched ${SUPPORTED_CLI_VERSION} but binary still reports ${healed ?? "unknown"} — giving up until the pin changes`,
              );
              await context.globalState.update(
                HEAL_GAVE_UP_KEY,
                SUPPORTED_CLI_VERSION,
              );
            } else {
              await context.globalState.update(HEAL_GAVE_UP_KEY, undefined);
            }
          }
        } finally {
          sub.dispose();
        }
      },
    );
  } catch (error) {
    // A user-pressed Cancel aborts the request, which surfaces here as an
    // AbortError. That is not a failure and must not raise a failure toast —
    // the customer already knows, they asked for it. `downloadFile` removes its
    // temp file on the way out, so nothing partial is left behind.
    if (cancelled) {
      log("[cli] tan CLI download cancelled by the user");
      return;
    }
    // This only runs on a failed download — either a fresh install with no
    // resolvable binary, or a stale-cache self-update. Not on every activation,
    // so a failure toast is a real, non-naggy signal (previously log-only). On
    // an update failure the existing (older) cached binary still works, so the
    // wording differs: don't imply commands are broken.
    // The raw failure (HTTP status, the asset URL, ENOTFOUND/EACCES) rides on
    // `detail`: the presenter logs it to the "Alp SDK" channel and never puts
    // it in the toast, where it read as noise instead of a remedy.
    const detail = error instanceof Error ? error.message : String(error);
    notifyAsync(
      planFailure({
        operation: "Provisioning the tan CLI",
        cause: updatingStaleCache
          ? `Couldn't update the tan CLI to ${SUPPORTED_CLI_VERSION}. The installed version still works — retry when you're back online.`
          : "Couldn't download the tan CLI. Build and validate commands need it — retry when you're back online, or point alpSdk.cliPath at a local build.",
        detail,
        // `alp.updateCli` re-runs exactly this download, so the presenter can
        // execute the retry itself; a caller-handled `retry` id would be a dead
        // button here because nothing awaits this plan.
        actions: updatingStaleCache
          ? [{ id: "updateCli", title: "Retry" }]
          : [
              { id: "updateCli", title: "Retry" },
              { id: "openSettings", arg: "alpSdk.cliPath" },
            ],
      }),
    );
  }
}

/** Resolve the tan binary and read its parsed `--version`, or null on any
 *  spawn/parse hiccup. Does NOT guard against a `download` source — callers that
 *  must never fetch (e.g. probeTanVersion) check decideBinarySource first. */
async function readResolvedCliVersion(
  deps: ResolveDeps,
): Promise<string | null> {
  try {
    const bin = await resolveAlpBinary(deps);
    const { stdout } = await execFileAsyncCli(bin.command, ["--version"], {
      timeout: 3000,
    });
    return parseTanVersion(stdout);
  } catch {
    return null;
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
  notifyAsync(
    planFailure({
      operation: "Resolving the tan CLI",
      cause:
        "alpSdk.preferGlobalCli is on, but no tan CLI was found on PATH from " +
        "this window. Install a global tan, or clear alpSdk.preferGlobalCli " +
        "to use the extension's managed copy.",
      severity: "warning",
      // "(global)" is load-bearing in this one toast: the remedy is a `tan` on
      // PATH, not the managed copy the extension already has — so the title
      // overrides the presenter's generic "Install tan CLI".
      actions: [
        { id: "installTanCli", title: "Install tan CLI (global)" },
        { id: "openSettings", arg: "alpSdk.preferGlobalCli" },
      ],
    }),
  );
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
): NotifyAction | null {
  switch (source) {
    case "cliPath":
      return { id: "openSettings", arg: "alpSdk.cliPath" };
    case "bundled":
    case "localBuild":
      return null;
    case "path":
      if (preferGlobalCli) {
        return { id: "installTanCli", title: "Install tan CLI (global)" };
      }
      return { id: "updateCli", title: "Update" };
    default:
      return { id: "updateCli", title: "Update" };
  }
}

/** Warn about the resolved binary with whatever action
 *  `cliFixAction(binary.source, …)` offers. A `bundled`/`localBuild` source has
 *  no one-click fix, so its plan carries no action of its own — the presenter's
 *  appended "Show Output" is then the button, which is exactly what that branch
 *  lacked: the probe detail (the resolved path, the line `--version` actually
 *  printed, the source) is already in the channel, one click away, instead of
 *  the toast being a bare dismiss. */
async function warnAboutResolvedBinary(
  binary: ResolvedBinary,
  message: string,
  preferGlobalCli: boolean,
): Promise<void> {
  const fix = cliFixAction(binary.source, preferGlobalCli);
  await notify(
    planFailure({
      operation: "Checking the tan CLI",
      cause: message,
      severity: "warning",
      actions: fix ? [fix] : [],
    }),
  );
}

/** Message for a resolved binary whose `--version` output isn't the native
 *  `tan <MAJOR.MINOR.PATCH>` line at all — worded per source since the cause
 *  (and the fix) differs: a leftover retired `alp` binary pinned via
 *  `alpSdk.cliPath`, a stale bundled/local build, or a managed binary
 *  corrupted by an old non-atomic download.
 *
 *  The resolved path and the line `--version` actually printed are NOT in the
 *  sentence: an unknown binary's first stdout line is unbounded, and both facts
 *  are already logged by the caller — "Show Output" is the click that reveals
 *  them. */
function nonNativeCliMessage(binary: ResolvedBinary): string {
  const notTan = "doesn't look like the native tan CLI";
  switch (binary.source) {
    case "cliPath":
      return `The binary at alpSdk.cliPath ${notTan}. This may be the retired alp CLI or a corrupted binary. Point the setting at a tan build, or clear the override to use the managed CLI.`;
    case "bundled":
      return `The tan binary bundled with this extension install ${notTan}. Reinstall from a current .vsix to refresh it.`;
    case "localBuild":
      return `The local tan-cli build ${notTan}. Rebuild the sibling tan-cli checkout.`;
    default:
      return `The managed tan CLI ${notTan}. It may be corrupted from an old download.`;
  }
}

/** Message for a resolved binary that's older than `SUPPORTED_CLI_VERSION`,
 *  worded per source for the same reason as `nonNativeCliMessage` (and, for the
 *  same reason, without the resolved path — the caller logs it). The version
 *  numbers stay: they are the fact the user needs, not raw diagnostics. */
function outdatedCliMessage(binary: ResolvedBinary, version: string): string {
  const behind = `is ${version}, older than the ${SUPPORTED_CLI_VERSION} this extension expects — some features (e.g. project examples) may be missing`;
  switch (binary.source) {
    case "cliPath":
      return `The tan CLI at alpSdk.cliPath ${behind}. Update that binary, or clear the override to use the managed CLI.`;
    case "bundled":
      return `The tan binary bundled with this extension install ${behind}. Reinstall from a current .vsix to refresh it.`;
    case "localBuild":
      return `The local tan-cli build ${behind}. Rebuild the sibling tan-cli checkout.`;
    default:
      return `The tan CLI ${behind}.`;
  }
}

/** Message for a `path`-source tan that's NEWER than `SUPPORTED_CLI_VERSION`
 *  (only meaningful for `path`, under `alpSdk.preferGlobalCli`: a bundled/
 *  cached/local-build binary is the version this extension shipped or
 *  fetched itself, so it can never be ahead of what this build targets —
 *  only a PATH `tan` the user installed independently can be). */
function aheadCliMessage(version: string): string {
  return `The tan CLI on PATH is ${version}, newer than the ${SUPPORTED_CLI_VERSION} this extension was built/tested against — some flags or envelope fields may differ from what this extension expects.`;
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
      nonNativeCliMessage(binary),
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
    // The PATH binary's absolute path belongs in the channel, not in the toast
    // sentence — this is the only place it is recorded for this branch.
    log(
      `[cli] resolved tan ${version} on PATH (${binary.command}) is newer than supported ${SUPPORTED_CLI_VERSION}`,
    );
    // Reinstalling is never the remedy (the installer fetches an even-newer
    // latest); the fix depends on the flag (see `aheadPathFixAction`). Flag
    // off → download the pinned version into the cache (which outranks PATH
    // when off); flag on → turn the preference off so a managed copy wins.
    const fix = aheadPathFixAction(preferGlobalCli);
    await notify(
      planFailure({
        operation: "Checking the tan CLI",
        cause: aheadCliMessage(version),
        severity: "warning",
        actions: [
          fix === "updateManagedCli"
            ? { id: "updateCli", title: "Update" }
            : { id: "openSettings", arg: "alpSdk.preferGlobalCli" },
        ],
      }),
    );
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
    // The warning is the whole point of this guard — the `return` below is a
    // refusal the user has to be told about, never a silent no-op.
    await notify(
      planFailure({
        operation: "Updating the tan CLI",
        cause:
          "alpSdk.cliPath is set, so the managed CLI download won't be used. Clear the override to let the extension manage the tan CLI, or update that binary yourself.",
        severity: "warning",
        actions: [{ id: "openSettings", arg: "alpSdk.cliPath" }],
      }),
    );
    return;
  }
  let cancelled = false;
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Updating the tan CLI to ${SUPPORTED_CLI_VERSION}…`,
        // The existing binary keeps working while this runs, so a cancel is
        // always safe — and a slow link must never look like a hung window.
        cancellable: true,
      },
      async (_progress, token) => {
        const controller = new AbortController();
        const sub = token.onCancellationRequested(() => {
          cancelled = true;
          controller.abort();
        });
        try {
          const asset = releaseAssetForTarget(deps.platform, deps.arch);
          log(
            `[cli] downloading tan CLI ${SUPPORTED_CLI_VERSION}: ${asset?.url ?? "unknown asset"}`,
          );
          await downloadCli(deps, controller.signal);
          log(
            `[cli] tan CLI ${SUPPORTED_CLI_VERSION} downloaded (${downloadedBytes(deps.cachedBinaryPath)}) to ${deps.cachedBinaryPath}`,
          );
          resetResolvedBinary();
        } finally {
          sub.dispose();
        }
      },
    );
    if (cancelled) {
      log(`[cli] tan CLI update to ${SUPPORTED_CLI_VERSION} cancelled`);
      notifyAsync(planSuccess("tan CLI update cancelled."));
      return;
    }
    // Status bar, not a toast: the progress notification above already showed
    // the update running, and nothing here needs a dismissal click.
    notifyAsync(planSuccess(`tan CLI updated to ${SUPPORTED_CLI_VERSION}.`));
  } catch (error) {
    // A cancel aborts the request and lands here as an AbortError; the customer
    // asked for it, so it is reported as a status-bar note, never a failure.
    if (cancelled) {
      log(`[cli] tan CLI update to ${SUPPORTED_CLI_VERSION} cancelled`);
      notifyAsync(planSuccess("tan CLI update cancelled."));
      return;
    }
    notifyAsync(
      planFailure({
        operation: "Updating the tan CLI",
        cause: "The tan CLI update failed.",
        // HTTP status / errno / asset URL — logged, never rendered.
        detail: error instanceof Error ? error.message : String(error),
        // Almost always transient (network), so offer the retry; `alp.updateCli`
        // IS this command, so the presenter can run it without this plan being
        // awaited.
        actions: [{ id: "updateCli", title: "Retry" }],
      }),
    );
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
    notifyAsync(
      planFailure({
        operation: "Installing the tan CLI",
        cause:
          "The bundled tan installer is missing from this extension install. Reinstalling the Alp SDK extension restores it.",
        // The expected script path is a local absolute path: channel only.
        detail: `expected installer at ${script}`,
        // The stated remedy now has the button it never had. The id is spelled
        // exactly as package.json publishes it (`AlpLabAI.alp-sdk`).
        actions: [{ id: "openExtensions", arg: "AlpLabAI.alp-sdk" }],
      }),
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
 *
 * `source` carries how the run binary was resolved (`ResolvedBinary.source`)
 * so a caller that wants that for diagnostics (e.g. `bootstrap.ts`'s win32
 * pre-flight log) doesn't need a second, redundant `resolveAlpBinaryForContext`
 * call — resolution is memoized per window anyway, but the second call was
 * still a needless extra async round trip and try/catch just to read a field
 * this function already has in hand.
 */
export async function runAlpCommand(
  context: vscode.ExtensionContext,
  args: string[],
  cwd?: string,
  options?: { signal?: AbortSignal },
): Promise<{
  outcome: CliOutcome;
  raw: SpawnResult;
  source: BinarySource | "unresolved";
}> {
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
        // The raw resolver text (`No prebuilt tan CLI for win32/x64…`, an HTTP
        // status, an errno) rides on `unavailable.detail`, which the
        // notification planner logs and never renders — it used to be
        // interpolated straight into a buttonless toast.
        message: "tan CLI unavailable.",
        envelope: null,
        unavailable: {
          reason: classifyUnavailable(message),
          detail: message,
        },
      },
      raw: {
        status: null,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error : new Error(message),
      },
      source: "unresolved",
    };
  }
  const finalArgs = withSdkRoot(args);
  log(
    `[cli] $ ${binaryLabel(binary.command)} ${finalArgs.join(" ")} --format json` +
      (cwd ? `  (cwd: ${cwd})` : ""),
  );
  const result = await runAlpAsync(
    binary.command,
    finalArgs,
    (command, spawnArgs, spawnCwd) =>
      spawnAlpAsync(command, spawnArgs, spawnCwd, options?.signal),
    cwd,
  );
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
  return { ...result, source: binary.source };
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
    // "Retry" is caller-handled by the seam's contract, so it has to be
    // honoured here or the button is a dead end: resolution threw, so nothing
    // is memoized and a second attempt really does re-resolve (and can
    // re-download). One extra frame per user click, no loop.
    if ((await surfaceResolutionError(error, options.name)) === "retry") {
      await runAlpInTerminal(context, args, options);
    }
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

/**
 * Present a binary-resolution failure through the seam's CLI-unavailable plan.
 * `classifyUnavailable` turns the raw resolver text into the discriminant, so
 * "tan was never installed here" offers Install/Retry while "a binary is there
 * but broken/mispointed" offers Settings/Doctor — the previous single toast
 * read identically for both and offered `alpSdk.cliPath` to a first-run user
 * who has no binary to point it at. The raw text stays on `unavailable.detail`
 * (channel only). Returns the caller-handled pick, i.e. "retry".
 */
async function surfaceResolutionError(
  error: unknown,
  operation: string,
): Promise<ActionId | undefined> {
  const detail = error instanceof Error ? error.message : String(error);
  return notify(
    planCliOutcome(
      {
        exitCode: -1,
        kind: "unknown",
        ok: false,
        severity: "error",
        message: "tan CLI unavailable.",
        envelope: null,
        unavailable: { reason: classifyUnavailable(detail), detail },
      },
      { operation },
    ),
  );
}

// ── real seams ───────────────────────────────────────────────────────────────

const ALP_SPAWN_TIMEOUT_MS = 60_000;
const ALP_SPAWN_MAX_OUTPUT = 16 * 1024 * 1024;

/**
 * Async twin of the former `spawnAlp`: runs a `tan` envelope command off the
 * extension-host event loop via `cp.spawn`, so a slow or network-bound command
 * (e.g. `sdk list`) — and any webview waiting on it — never freezes the editor.
 * Preserves the sync path's guards: utf8 output, a 16 MB cap, and a 60s timeout,
 * each surfaced as `SpawnResult.error` so `runAlpAsync` maps it to an error
 * outcome (caller's spinner-clear / error toast still fires). An optional
 * `signal` (from a command's CancellationToken) kills the child on user cancel.
 */
function spawnAlpAsync(
  command: string,
  args: string[],
  cwd?: string,
  signal?: AbortSignal,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = cp.spawn(command, args, { cwd, signal });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    const finish = (result: SpawnResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({
        status: null,
        stdout,
        stderr,
        error: new Error(
          `tan CLI timed out after ${ALP_SPAWN_TIMEOUT_MS / 1000}s`,
        ),
      });
    }, ALP_SPAWN_TIMEOUT_MS);

    // Cap BOTH streams (spawnSync's maxBuffer applied per-stream) so a runaway
    // tan can't grow ext-host memory unbounded.
    const capGuard = (): void => {
      if (stdout.length + stderr.length > ALP_SPAWN_MAX_OUTPUT) {
        child.kill();
        finish({
          status: null,
          stdout,
          stderr,
          error: new Error("tan CLI output exceeded 16 MB"),
        });
      }
    };
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      capGuard();
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      capGuard();
    });
    // `error` fires on ENOENT and on abort (AbortError when `signal` is aborted).
    child.on("error", (err) =>
      finish({ status: null, stdout, stderr, error: err }),
    );
    // A stdio stream error (rare, e.g. EPIPE) emits on the stream itself; with no
    // listener Node re-throws it as an uncaught exception that can crash the
    // extension host, so route it through finish like any other spawn failure.
    const onStreamError = (err: Error): void =>
      finish({ status: null, stdout, stderr, error: err });
    child.stdout?.on("error", onStreamError);
    child.stderr?.on("error", onStreamError);
    child.on("close", (code) => finish({ status: code, stdout, stderr }));
  });
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
