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
import {
  ChecksumError,
  CliInUseError,
  ProxyConfig,
  ProxyError,
  downloadFile,
} from "./download";
import { BinarySource, CliOutcome } from "./models";
import {
  SUPPORTED_CLI_VERSION,
  aheadPathFixAction,
  binaryName,
  classifyUnavailable,
  cliSkew,
  decideBinarySource,
  isCliBehind,
  isNativeTanVersionOutput,
  parseTanVersion,
  proxyEnvOverrides,
  releaseAssetForTarget,
  shouldFetchManagedCli,
  shouldWarnCliAhead,
} from "./service";
import { ActionId, NotificationPlan, NotifyAction } from "../notify/models";
import {
  isCancellation,
  planCliOutcome,
  planFailure,
  planSuccess,
} from "../notify/service";
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
 *
 * The fallthrough is LOGGED, because it is not a no-op from tan's side: with no
 * `--sdk-root` tan discovers an SDK itself, and from tan 0.4.0 that discovery
 * walks UP to an enclosing checkout — so a cwd that used to fail cleanly can
 * instead resolve to an ancestor SDK nobody selected, and every downstream
 * result (validation, generation, the build plan) silently comes from it.
 * Channel only: this happens on every unpinned invocation, so a toast would
 * nag. It is deliberately a LOG and not a second resolution rule here — the
 * extension must READ tan's answer, never compute a competing one (a
 * TypeScript copy of tan's walk-up would drift from it). Reporting the SDK
 * root tan actually used is a tan-side envelope ask.
 */
function withSdkRoot(args: string[]): string[] {
  if (args.includes("--sdk-root")) return args;
  const sdkRoot = collectProjectContext().sdkRoot;
  if (!sdkRoot) {
    log(
      "[cli] no active SDK resolved — running without --sdk-root; tan will " +
        "discover an SDK from the working directory (0.4.0+ searches parent " +
        "directories too, so it may pick an enclosing checkout). Set alpSdk.path " +
        "to pin one.",
    );
    return args;
  }
  return ["--sdk-root", sdkRoot, ...args];
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

/** globalState key holding the installed tan version an "ahead of the pin"
 *  warning was already raised for. Persisted (not a module flag) so the warning
 *  is one-shot ACROSS activations, not once per window — a customer running a
 *  newer tan on purpose must not be re-toasted every time VS Code starts. A
 *  further upgrade stores a different version and so warns again. */
const AHEAD_WARNED_KEY = "alp.tanAheadWarnedVersion";

/** Best-effort human-readable size of a just-downloaded file, for the transfer
 *  log. Returns "unknown size" when the file can't be stat'd. */
function downloadedBytes(filePath: string): string {
  try {
    return `${fs.statSync(filePath).size} bytes`;
  } catch {
    return "unknown size";
  }
}

/**
 * The plan for the ONE download failure whose remedy is not "try again": the
 * installed binary is pinned open by a live process (`CliInUseError`), so both
 * rename-aside names failed. Returns null for every other failure, leaving each
 * call site its own network wording.
 *
 * Owned here rather than duplicated at the two catch sites below, and branched
 * on the TYPE rather than the sentence. Three things it fixes at once:
 *
 * - the customer sentence reaches the TOAST as `cause`. It used to ride on
 *   `detail`, which the presenter writes only to the output channel, so the one
 *   instruction that resolves this was behind a "Show Output" click;
 * - the toast no longer says "retry when you're back online". The network was
 *   never the problem, and reading a lock as an outage sends the customer to
 *   their Wi-Fi;
 * - no "Retry" button. `alp.updateCli` re-runs the identical rename against the
 *   identical holder and fails identically — a button that cannot work. Reload
 *   Window is the click that DOES: it drops this window's own handles (the
 *   `runAlpInTerminal` mid-build collision `moveAside` documents), and
 *   activation re-runs `ensureTanCliProvisioned`, so the update retries itself
 *   once the holder is gone. The presenter appends "Show Output" for the errno.
 */
function cliInUsePlan(
  error: unknown,
  operation: string,
): NotificationPlan | null {
  if (!(error instanceof CliInUseError)) {
    return null;
  }
  return planFailure({
    operation,
    cause: error.message,
    // The raw `EBUSY/EPERM … rename '<path>' -> '<path>.old'` — channel only,
    // and the reason the sentence above carries neither.
    detail: error.detail,
    actions: [{ id: "reloadWindow" }],
  });
}

/**
 * The plan for a download that never got past the PROXY. Returns null for every
 * other failure, so the two catch sites below keep their own network wording.
 *
 * Split out from them for the same reason as `cliInUsePlan` and branched on the
 * TYPE, not the sentence. Without it a blocked CONNECT — a 407, a proxy that
 * can't be resolved, a TLS-inspecting proxy this download won't trust — reads
 * as "Couldn't download the tan CLI … retry when you're back online", which
 * sends the customer to their Wi-Fi for a problem the proxy caused and makes
 * the CLI look broken. `ProxyError.message` says "proxy", names its host:port,
 * and never carries the `user:password@`; the errno/status rides on `detail`,
 * which the presenter writes to the channel only.
 */
/**
 * The plan for a download that was REFUSED rather than failed: the bytes did not
 * match the checksum the release publishes, or that checksum could not be
 * obtained at all (`ChecksumError`). Returns null for every other failure.
 *
 * Split out on the TYPE, like `cliInUsePlan` and `proxyFailurePlan` above, and
 * for a sharper reason than either: without it a refused binary falls into
 * "Couldn't download the tan CLI … retry when you're back online", which is a
 * flatly wrong account of what happened. The transfer worked. The customer is
 * being told to blame their network for bytes that arrived intact and were not
 * the published ones — the single most important thing this check can say would
 * be the one thing it never said.
 *
 * `ChecksumError.message` states which of the three refusals it was and carries
 * no digest or URL; the digests ride on `detail` (channel only). "Retry" is
 * still offered — it is safe by construction, since the retry re-verifies and a
 * mismatching binary can never be installed by it, and the common cause of a
 * one-off mismatch really is a corrupted transfer. `alpSdk.cliPath` is NOT
 * offered: pointing at a hand-placed binary is precisely the workaround this
 * refusal exists to prevent, and must not be suggested as the remedy.
 */
function checksumFailurePlan(
  error: unknown,
  operation: string,
): NotificationPlan | null {
  if (!(error instanceof ChecksumError)) {
    return null;
  }
  return planFailure({
    operation,
    cause: error.message,
    detail: error.detail,
    actions: [{ id: "updateCli", title: "Retry" }],
  });
}

function proxyFailurePlan(
  error: unknown,
  operation: string,
): NotificationPlan | null {
  if (!(error instanceof ProxyError)) {
    return null;
  }
  return planFailure({
    operation,
    cause: error.message,
    detail: error.detail,
    // Settings first: the remedy is nearly always a proxy URL (or credentials
    // in it), not another attempt at the same blocked hop.
    actions: [
      { id: "openSettings", arg: "http.proxy" },
      { id: "updateCli", title: "Retry" },
    ],
  });
}

function cacheDirFor(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "cli");
}

/**
 * VS Code's OWN proxy settings, read here because `src/alpCli/download.ts` must
 * stay `vscode`-free (its tests run under plain `node --test`). Read per call,
 * not memoized, so changing `http.proxy` takes effect on the next download
 * without a reload. The `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` environment
 * variables are deliberately NOT forwarded from here — `download.ts` reads
 * `process.env` itself, which is not a `vscode` dependency.
 */
function proxySettings(): ProxyConfig {
  const httpConfig = vscode.workspace.getConfiguration("http");
  return {
    proxy: httpConfig.get<string>("proxy", "").trim(),
    strictSSL: httpConfig.get<boolean>("proxyStrictSSL", true),
  };
}

/** One-shot per window: `http.proxyStrictSSL: false` cannot be forwarded to a
 *  spawned `tan`, and saying nothing would leave the user believing a switch
 *  they flipped is in effect. See `warnIfStrictSSLNotForwardable`. */
let strictSSLNotForwardableWarned = false;

/**
 * `http.proxyStrictSSL: false` says "a TLS-intercepting middlebox re-signs my
 * traffic, accept it". Examined and NOT representable in the spawn environment:
 * `tan` has no environment knob (nor a flag) that relaxes certificate
 * verification — the only env vars it reads for the network are the proxy names
 * in `proxyEnvOverrides`, and its rustls config is built unconditionally
 * (tan-cli `crates/tan-cli/src/http.rs` `tls_config`).
 *
 * It also should not need one. That same `tls_config` trusts the bundled webpki
 * roots MERGED WITH THE OS TRUST STORE, so a middlebox CA installed in
 * Windows/macOS/Linux system trust is already accepted. The remedy for this
 * user is to install their proxy's CA there — one place that fixes tan, git,
 * pip and west at once — not a per-tool "skip verification" switch we would
 * have to invent. Inventing one is also the wrong trade: it would turn a
 * verified download of an executable we then run into an unverified one.
 *
 * So this logs the honest answer once instead of silently doing nothing.
 */
function warnIfStrictSSLNotForwardable(strictSSL: boolean | undefined): void {
  if (strictSSL !== false || strictSSLNotForwardableWarned) {
    return;
  }
  strictSSLNotForwardableWarned = true;
  log(
    "[cli] http.proxyStrictSSL is off, but that setting does not reach the " +
      "tan CLI — tan always verifies TLS, against the bundled roots plus your " +
      "OS trust store. If a TLS-inspecting proxy is breaking tan, install its " +
      "CA certificate into the OS trust store (that also fixes git, pip and " +
      "west); there is no way to disable the check for tan alone.",
  );
}

/**
 * The proxy variables to ADD to a spawned `tan`'s environment — VS Code's
 * `http.proxy` filling gaps the inherited environment left, never overwriting
 * it. The precedence rule and why it is this way round live on
 * `proxyEnvOverrides`; read that before changing anything here.
 *
 * Returns ADDITIONS ONLY, which is what `runInTerminal` wants:
 * `vscode.ProcessExecution` merges its `env` into the parent's. Callers using
 * `child_process` (which REPLACES the environment when `env` is passed) go
 * through `spawnEnv()` below instead.
 *
 * Exported because the extension's other two NETWORK-bound child processes are
 * not `tan` and so cannot reach this through the `tan` spawn seams: `west
 * update` (`src/west/vscodeAdapter.ts`) and the SDK-install `git clone`
 * (`src/ideHub/sdkManagerMessages.ts`). They fail on a proxied machine for the
 * identical reason, and `proxySettings()` above must stay the ONE reader of
 * `http.proxy` in this extension.
 */
export function proxyEnvAdditions(): Record<string, string> {
  const settings = proxySettings();
  warnIfStrictSSLNotForwardable(settings.strictSSL);
  return proxyEnvOverrides(settings.proxy ?? "", process.env);
}

/** The full environment for a `child_process` spawn of `tan`: everything the
 *  extension host inherited (so `NO_PROXY`, `PATH`, `ZEPHYR_BASE` and the rest
 *  survive) plus the proxy gap-fillers. */
function spawnEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ...proxyEnvAdditions() };
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
    // Settings read at call time (see `proxySettings`) so the seam's signature
    // carries only what the caller knows. `verify` reaches `downloadFile`
    // alongside the SAME `proxySettings()` the binary uses — the checksum file
    // is fetched over the same proxy, because a machine that needs a proxy to
    // reach the release host needs it for both or it can install nothing.
    download: (url, dest, signal, verify) =>
      downloadFile(url, dest, signal, proxySettings(), verify),
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
    // The OTHER cancellation: not the user's Cancel button but the window
    // going away. This runs on activation, and it awaits `withProgress` plus
    // two `globalState.update` writes — all main-thread RPCs, all rejected with
    // a CancellationError at teardown. Provisioning was abandoned, not failed;
    // the next activation retries it, and a "couldn't download the tan CLI"
    // toast for a window the customer just closed is the confusion this guard
    // exists to keep out.
    if (isCancellation(error)) {
      log("[cli] tan CLI provisioning abandoned, window closing");
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
      // A pinned-open binary is neither of the two sentences below: it is not
      // an outage, and the installed CLI is not what's broken. Nor is a proxy
      // that blocked the transfer — "retry when you're back online" is the
      // wrong advice when the network is fine and the proxy said no.
      cliInUsePlan(error, "Provisioning the tan CLI") ??
        proxyFailurePlan(error, "Provisioning the tan CLI") ??
        // …nor is a binary that was REFUSED. It downloaded fine; it just
        // wasn't the published binary, and "retry when you're back online"
        // would bury the only fact that matters here.
        checksumFailurePlan(error, "Provisioning the tan CLI") ??
        planFailure({
          operation: "Provisioning the tan CLI",
          cause: updatingStaleCache
            ? `Couldn't update the tan CLI to ${SUPPORTED_CLI_VERSION}. The installed version still works — retry when you're back online.`
            : "Couldn't download the tan CLI. Build and validate commands need it — retry when you're back online, or point alpSdk.cliPath at a local build.",
          detail,
          // `alp.updateCli` re-runs exactly this download, so the presenter can
          // execute the retry itself; a caller-handled `retry` id would be a
          // dead button here because nothing awaits this plan.
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
    // `--version` touches no network, so the proxy env changes nothing here —
    // it is passed anyway so there is exactly ONE answer to "what environment
    // does this extension run tan in", rather than a seam a future networked
    // probe could be added to without anyone noticing the gap.
    const { stdout } = await execFileAsyncCli(bin.command, ["--version"], {
      timeout: 3000,
      env: spawnEnv(),
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

/** The CLI-side remedy for an ahead-of-the-pin tan: fetch the version this
 *  extension build pins. That is a DOWNGRADE, so it is titled by what it does
 *  — `cliFixAction` titles the same `updateCli` id "Update", which is correct
 *  when the CLI is behind the pin and actively misleading when it is ahead. */
const usePinnedCli: NotifyAction = {
  id: "updateCli",
  title: `Use tan ${SUPPORTED_CLI_VERSION}`,
};

/** Message for a tan that's a MINOR/MAJOR release NEWER than
 *  `SUPPORTED_CLI_VERSION`. Not scoped to a `path` source any more: a sibling
 *  `localBuild` checkout tracking tan-cli's dev branch, and any binary pinned
 *  via `alpSdk.cliPath`, run ahead of the pin just as easily as a global
 *  install does. Says what to do; carries no exit code and no resolved path
 *  (the caller logs those to the channel).
 *
 *  DELIBERATELY SHORT (~135 chars). VS Code clips a toast to about two lines
 *  and hides the rest behind a chevron, so whatever leads is the whole message
 *  most customers read: fact, then remedy. The previous 283-char version led
 *  with the version facts and put "Renamed issue codes or envelope fields …
 *  would silently skip checks" in the visible middle — internal contract
 *  vocabulary, unactionable, and it read as "something is broken" rather than
 *  "your CLI is newer than this was tested against". That rationale now rides
 *  on the channel line in `checkCliVersion`, where a support thread can find
 *  it and a customer is never shown it. */
function aheadCliMessage(version: string): string {
  return (
    `The tan CLI is ${version}, newer than the ${SUPPORTED_CLI_VERSION} this ` +
    `extension was tested against. Update the extension, or use the pinned CLI.`
  );
}

/**
 * Probe the resolved `tan` binary's version and warn once, with whichever
 * action actually fixes it, when it is NOT the version this extension targets:
 *
 * - older (or not the native CLI at all) — the silent cause of missing features
 *   (e.g. project examples) when a stale CLI is pinned via `alpSdk.cliPath` or
 *   left cached from an older extension build;
 * - a MINOR/MAJOR release NEWER than the pin — the skew that can rename an
 *   issue code or an envelope field this extension matches on exactly, all of
 *   which fail open (see `shouldWarnCliAhead`). One-shot per newer version via
 *   globalState, so it cannot repeat on every activation.
 *
 * A PATCH-newer tan is deliberately silent (channel only): it cannot move the
 * envelope contract, so there is nothing for the customer to do.
 *
 * Never throws — and this wrapper is what makes that true. The body awaits a
 * toast and a `globalState.update`, both main-thread RPCs, and BOTH call sites
 * are `void checkCliVersion(context)` (activation, and the cliPath/
 * preferGlobalCli config listener). Unguarded, a window closing mid-check
 * became an unhandled rejection in the extension host naming nothing —
 * `Canceled: Canceled` with no operation and no cause. An unresolvable binary
 * is a no-op; a `--version` spawn failure (ENOENT/EACCES/timeout — the probe
 * couldn't even exec the binary) tells us nothing about the binary's identity,
 * so it's logged and NOT treated as "not the native CLI".
 */
export async function checkCliVersion(
  context: vscode.ExtensionContext,
): Promise<void> {
  try {
    await runCliVersionCheck(context);
  } catch (error) {
    if (isCancellation(error)) {
      log("[cli] version check abandoned, window closing");
      return;
    }
    // The STACK, not just the message: this wrapper is new, and everything it
    // now catches used to surface with a full stack as an unhandled rejection.
    // A blanket catch that keeps only `error.message` turns a genuine bug into
    // a one-line warn with nothing to debug from.
    log(
      `[cli] version check failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      "warn",
    );
  }
}

async function runCliVersionCheck(
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
    env: spawnEnv(),
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

  const skew = cliSkew(version, SUPPORTED_CLI_VERSION);

  if (skew === "behind") {
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

  // ONE decision for whether the customer sees this warning, deliberately.
  // There used to be an `if (skew === "ahead-patch") return;` early return
  // ABOVE this gate as well — two decision points for one question, and
  // widening that one to `|| skew === "ahead-minor"` made everything below
  // dead code with the whole suite still green (pure-function tests never
  // reach this branch, and a source grep cannot see that a call became
  // unreachable). `test/alpCli.aheadWarning.test.js` drives this function.
  if (
    !shouldWarnCliAhead(
      version,
      context.globalState.get<string>(AHEAD_WARNED_KEY),
    )
  ) {
    // Silent — and logged, so the silence is explainable in a support thread.
    // A PATCH release can't move the envelope contract this extension parses,
    // so a toast on every activation would carry no action worth taking.
    if (skew === "ahead-patch") {
      log(
        `[cli] resolved tan ${version} is a patch ahead of supported ${SUPPORTED_CLI_VERSION} (source: ${binary.source}) — contract unchanged, staying quiet`,
      );
    }
    return;
  }
  // The resolved absolute path belongs in the channel, never in the toast —
  // and so does WHY a minor bump matters at all (issue codes and envelope
  // fields are contract vocabulary a customer cannot act on; see
  // `aheadCliMessage`).
  log(
    `[cli] resolved tan ${version} (${binary.command}, source: ${binary.source}) is newer than supported ${SUPPORTED_CLI_VERSION} — this extension matches exact issue codes and unversioned envelope data fields, all of which fail open, so a rename in that release skips a check instead of erroring`,
  );
  await context.globalState.update(AHEAD_WARNED_KEY, version);
  // For a PATH tan, reinstalling is never the remedy (the installer fetches an
  // even-newer latest); the fix depends on the flag (see `aheadPathFixAction`).
  // Flag off → download the pinned version into the cache (which outranks PATH
  // when off); flag on → turn the preference off so a managed copy wins. Every
  // other source takes the same fix as any other bad-binary warning.
  const fix: NotifyAction | null =
    binary.source === "path"
      ? aheadPathFixAction(preferGlobalCli) === "updateManagedCli"
        ? usePinnedCli
        : { id: "openSettings", arg: "alpSdk.preferGlobalCli" }
      : cliFixAction(binary.source, preferGlobalCli);
  await notify(
    planFailure({
      operation: "Checking the tan CLI",
      cause: aheadCliMessage(version),
      severity: "warning",
      // Order matches the sentence: "Update the extension, or use the pinned
      // CLI." `openExtensions` is what makes the first half clickable — it was
      // advice with no button, while the only button ran `alp.updateCli`.
      actions: [
        { id: "openExtensions" },
        // `cliFixAction` titles `updateCli` "Update", which is right when the
        // CLI is BEHIND the pin. HERE it downloads an OLDER tan, so the same
        // title would offer a silent downgrade to a customer who just read
        // "update the extension". Retitled to what it actually does.
        ...(fix ? [fix.id === "updateCli" ? usePinnedCli : fix] : []),
      ],
    }),
  );
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
    // A closing window rejects the pending `withProgress` RPC the same way.
    // Silent: the existing binary is untouched, so there is nothing to retry
    // and nobody left to read the toast.
    if (isCancellation(error)) {
      log(`[cli] tan CLI update abandoned, window closing`);
      return;
    }
    notifyAsync(
      // The one failure a retry cannot clear — a live process is holding the
      // installed binary, so the same rename fails the same way until it exits.
      cliInUsePlan(error, "Updating the tan CLI") ??
        // …and the one a retry cannot clear either until the proxy changes.
        proxyFailurePlan(error, "Updating the tan CLI") ??
        // …and the one that is not a failure at all but a refusal: the bytes
        // arrived and were rejected. The existing binary is untouched.
        checksumFailurePlan(error, "Updating the tan CLI") ??
        planFailure({
          operation: "Updating the tan CLI",
          cause: "The tan CLI update failed.",
          // HTTP status / errno / asset URL — logged, never rendered.
          detail: error instanceof Error ? error.message : String(error),
          // Almost always transient (network), so offer the retry;
          // `alp.updateCli` IS this command, so the presenter can run it
          // without this plan being awaited.
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
  // Stated, not omitted: the bundled installer writes to a fixed per-user
  // install location and never to its working directory, so it is the one
  // run here with nothing project-specific to run in — and it is reachable
  // with no folder open, so there would be no root to pass anyway.
  // The installer's whole job is to DOWNLOAD tan from GitHub, so it needs the
  // proxy more than tan itself does. Effective on the POSIX script (curl and
  // wget both read HTTPS_PROXY); on Windows the argv is `powershell`, i.e.
  // 5.1, whose `Invoke-WebRequest` takes its proxy from the system/IE config
  // and ignores the environment — harmless there, not a reason to withhold it
  // from the platform where it works.
  runInTerminal({
    name: "Install tan",
    argv,
    cwd: undefined,
    env: proxyEnvAdditions(),
  });
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
 *
 * `cwd` is a REQUIRED key (its value may still be `undefined`), and that is a
 * data-safety guard, not tidiness. Several `tan` subcommands WRITE where they
 * run — `bootstrap` and `doctor --build --fix` create a venv and a west
 * workspace in the working directory. An OMITTED `cwd` reached
 * `new vscode.ProcessExecution(…, { cwd: undefined })`, so the child inherited
 * the extension host's own directory — on Windows the VS Code install
 * directory — and bootstrapped THERE. Two call sites shipped that way
 * (`bootstrap.ts`, `toolchain.ts`); requiring the key is what makes the
 * compiler, not a reviewer, find the next one. It is a required key rather
 * than `cwd: string` because `west.ts` and `ideHub/buildPlanPanel.ts`
 * legitimately resolve a `string | undefined` — what must never happen again
 * is a site that never considered the question at all. A caller with no folder
 * open has no cwd to pass and must refuse the run instead
 * (`planPrecondition("noWorkspace", …)`), which is what both now do.
 */
export async function runAlpInTerminal(
  context: vscode.ExtensionContext,
  args: string[],
  options: { name: string; cwd: string | undefined },
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
  // The terminal gets the proxy too. A `ProcessExecution` task is not a login
  // shell — it inherits the EXTENSION HOST's environment, not the user's
  // profile — so `tan bootstrap` (which downloads Zephyr and pip packages) is
  // exactly as blind to `http.proxy` here as the `cp.spawn` seam is. Additions
  // only: ProcessExecution merges its `env` into the parent's.
  runInTerminal({
    name: options.name,
    argv: [binary.command, ...finalArgs],
    cwd: options.cwd,
    env: proxyEnvAdditions(),
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
    // `env` REPLACES the environment for `cp.spawn` (unlike ProcessExecution,
    // which merges), so this is the whole inherited environment plus the proxy
    // gap-fillers — see `spawnEnv`. This is the seam `tan sdk list` runs on, the
    // one a proxied machine notices first.
    const child = cp.spawn(command, args, { cwd, signal, env: spawnEnv() });
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
    env: spawnEnv(),
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
