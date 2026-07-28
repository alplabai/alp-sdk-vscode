// SPDX-License-Identifier: Apache-2.0
//
// VS Code wiring for the tan-CLI integration: resolve the binary (setting →
// bundled/local-build/cached → PATH (verified native, last resort by default;
// promoted above bundled/local-build/cached when alpSdk.preferGlobalCli is
// on) → download into global storage) and run envelope-mode commands.
// All fs/process/network seams are implemented here; the testable logic lives
// in `service.ts` + `adapterCore.ts`.

import * as cp from "child_process";
import { createHash } from "crypto";
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
  downloadSeam,
} from "./download";
import { BinaryResolutionInput, BinarySource, CliOutcome } from "./models";
import {
  CACHED_CLI_UNVERIFIED,
  CACHED_CLI_UNVERIFIED_NO_PREBUILT,
  SUPPORTED_CLI_VERSION,
  UNVERIFIED_PATH_IN_USE,
  aheadPathFixAction,
  binaryName,
  classifyUnavailable,
  cliSkew,
  decideBinarySource,
  isCliBehind,
  isNativeTanVersionOutput,
  isUnverifiableCache,
  parseTanVersion,
  posixLoginShellCommand,
  proxyEnvOverrides,
  releaseAssetForTarget,
  shouldFetchManagedCli,
  shouldNoticeUnverifiedPath,
  shouldWarnCliAhead,
  unverifiedCacheCause,
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
import {
  appendOutput,
  isStreamedRunActive,
  log,
  releaseStreamedRun,
  reserveStreamedRun,
  runInTerminal,
  showOutput,
  signalStreamedFinished,
} from "../util";

const execFileAsyncCli = promisify(cp.execFile);

/** How long a cancelled streamed run may ignore SIGTERM before it is SIGKILLed.
 *  Generous on purpose — `tan` gets a real chance to unwind (closing a probe,
 *  finishing a write) — but bounded, because the run name stays reserved until
 *  the process is actually gone. */
const CANCEL_GRACE_MS = 10_000;

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
 *
 * Exported for the `alp` task provider (`src/tasks/vscodeAdapter.ts`), which
 * spawns `tan build` itself rather than through `runAlpCommand`/
 * `runAlpInTerminal` and must not re-derive this rule — a second copy is how a
 * task-driven build silently starts using a different SDK than every other
 * command in the window.
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

/** globalState key holding the sha256 this extension verified for the binary it
 *  installed at `cachedBinaryPath`. Read on EVERY resolution that lands on the
 *  `cached` source and compared against the file on disk (#386) — see
 *  `ResolveDeps.recordedCachedDigest` for what that does and does not buy, and
 *  why the record lives here rather than beside the binary. */
const CACHED_DIGEST_KEY = "alp.tanCachedBinarySha256";

/** globalState key set once the rung-6 PATH notice has been shown (#393).
 *
 *  Persisted, like `AHEAD_WARNED_KEY`, because the state it describes is
 *  PERMANENT: a customer with `tan` on PATH and no managed copy is in it on
 *  every activation forever, so a per-window flag would nag every window.
 *  A bare marker rather than a version/fingerprint — there is no second version
 *  of this fact to report.
 *
 *  RECORDED ON SHOW, which is the opposite of the ruling
 *  `src/ideHub/setupOrchestrator.ts` made for its setup nudge (an auto-dismissed
 *  toast stays unrecorded and is retried; only an explicit "Don't show again"
 *  records). That ruling is about a nudge gating a BROKEN environment, where
 *  losing the toast strands the customer with the remedy unsaid. Here nothing is
 *  broken and there is no remedy to lose: the notice reports a steady state, the
 *  customer's setup works either way, and the only cost of a missed impression
 *  is that they were not told a thing they can look up. The cost of the other
 *  policy is a recurring info toast about a machine that is behaving correctly,
 *  which is the nag both files exist to prevent. Different question, so a
 *  different answer — deliberately, not by oversight. */
const PATH_NOTICED_KEY = "alp.tanUnverifiedPathNoticed";

/** Last `sha256File` answer, keyed by path + size + mtime.
 *
 *  MEASURED, not guessed: hashing the 3.2 MB `tan` binary (readFileSync +
 *  sha256) takes ~2.5-3.2 ms on this machine, and `statSync` ~0.08 ms. Without
 *  the memo that cost is per STATE REFRESH, not per-window:
 *  `resolveAlpBinaryForContext` memoizes into `resolved`, but `probeTanVersion`
 *  builds its OWN deps and hands them to `readResolvedCliVersion`, which calls
 *  `resolveAlpBinary` directly — so that path never sees the `resolved` memo,
 *  and it runs on every state refresh: window focus, board.yaml save, BOOTSTRAP
 *  task start (`src/extension.ts` filters `onDidStartTask` on
 *  `def.run === BOOTSTRAP_RUN_NAME`, so a user's own tasks do not sweep),
 *  terminal finish, any `alpSdk` settings edit.
 *  That is a synchronous multi-millisecond hash on the extension-host main
 *  thread per focus event.
 *
 *  ponytail: size + mtime, so a rewrite that preserves BOTH within one window
 *  reuses the memo. That is a real ceiling and it is stated rather than papered
 *  over — though it is inside the limit the record itself already has (an
 *  attacker who can rewrite the binary and forge its mtime can equally rewrite
 *  the globalState record). Upgrade path if that changes: drop the memo and hash
 *  per resolution, or key it on the file handle. */
let hashMemo: { key: string; digest: string } | undefined;

/** Lowercase hex sha256 of `filePath`, or null when it can't be read (missing,
 *  locked, a directory). Null is a REFUSAL at the caller, never a pass. */
function sha256File(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    const key = `${filePath}|${stat.size}|${stat.mtimeMs}`;
    if (hashMemo?.key === key) {
      return hashMemo.digest;
    }
    const digest = createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex");
    hashMemo = { key, digest };
    return digest;
  } catch {
    return null;
  }
}

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
 * The plan for an acquisition that was REFUSED rather than failed
 * (`ChecksumError`). Returns null for every other failure.
 *
 * Not download-only, despite the name's history: `downloadCli` re-frames an
 * unverifiable CACHED copy (#386) into a `ChecksumError` too, so the migration
 * refusal arrives here as well — which is what the `unavailableOutcome`
 * paragraph below means when it says this plan already caught those.
 *
 * Split out on the TYPE, like `cliInUsePlan` and `proxyFailurePlan` above, and
 * for a sharper reason than either: without it a refused binary falls into
 * "Couldn't download the tan CLI … retry when you're back online", which is a
 * flatly wrong account of what happened. The transfer worked. The customer is
 * being told to blame their network for bytes that arrived intact and were not
 * the published ones — the single most important thing this check can say would
 * be the one thing it never said.
 *
 * `ChecksumError.message` states which of the five refusal sentences it was
 * (four kinds; `mismatch` has one wording for a download and another for a
 * cached copy) and carries no digest or URL; the digests ride on `detail`
 * (channel only). "Retry" is
 * still offered — it is safe by construction, since the retry re-verifies and a
 * mismatching binary can never be installed by it, and the common cause of a
 * one-off mismatch really is a corrupted transfer. `alpSdk.cliPath` is NOT
 * offered: pointing at a hand-placed binary is precisely the workaround this
 * refusal exists to prevent, and must not be suggested as the remedy.
 */
function checksumFailurePlan(
  error: unknown,
  operation: string,
  /** Replaces the sentence for the ONE refusal whose wording depends on things
   *  `downloadCli` cannot see: which arm the ladder fell through to while the
   *  re-acquire was failing, and whether this host has a published binary to
   *  retry at all (#396 — `unverifiedCacheCause` in `service.ts` picks between
   *  the four). Applied to `unrecorded` ONLY — a `mismatch` says the release
   *  served bytes that are not the published ones, which outranks any framing
   *  and must arrive verbatim. Branching on `kind` rather than on the sentence,
   *  like everything else here. */
  unrecordedCause?: string,
): NotificationPlan | null {
  if (!(error instanceof ChecksumError)) {
    return null;
  }
  return planFailure({
    operation,
    cause:
      unrecordedCause && error.kind === "unrecorded"
        ? unrecordedCause
        : error.message,
    detail: error.detail,
    actions: [{ id: "updateCli", title: "Retry" }],
  });
}

/**
 * The `CliOutcome` a binary-RESOLUTION failure becomes, so `planCliOutcome`
 * picks the remedy from `unavailable.reason` instead of each call site
 * guessing. Shared by the two lazy-download surfaces — `runAlpCommand` (which
 * returns the outcome for its caller to present) and `surfaceResolutionError`
 * (which presents it itself) — so they cannot drift apart on the one path where
 * they must not.
 *
 * That path is `resolveAlpBinary`'s live `case "download"`: activation fires
 * `ensureTanCliProvisioned` un-awaited, so a command issued before or instead of
 * provisioning downloads inline, and a `ChecksumError` surfaces HERE rather than
 * through `checksumFailurePlan`. Branching on the TYPE — same discipline as
 * `cliInUsePlan` / `proxyFailurePlan` / `checksumFailurePlan` — is what carries
 * each refusal through as its own sentence instead of flattening them into one.
 * There are five: the three download refusals (mismatch, unfetchable manifest,
 * asset unlisted) plus the two CACHED ones (#386) — an unrecorded migrating
 * copy and a digest mismatch on disk. The sentence goes to the toast; the
 * digests ride on `detail`, which the presenter logs and never renders.
 */
function unavailableOutcome(error: unknown): CliOutcome {
  const raw = error instanceof Error ? error.message : String(error);
  return {
    exitCode: -1,
    kind: "unknown",
    ok: false,
    severity: "error",
    // The raw resolver text (`No prebuilt tan CLI for win32/x64…`, an HTTP
    // status, an errno) rides on `unavailable.detail`, which the notification
    // planner logs and never renders — it used to be interpolated straight into
    // a buttonless toast.
    message:
      error instanceof ChecksumError ? error.message : "tan CLI unavailable.",
    envelope: null,
    unavailable: {
      // TYPE first, string-sniff second. `classifyUnavailable` reaches
      // `checksumRefused` by matching the word "checksum" in the sentence,
      // which is fine for the three download refusals but would make the
      // wording of the two CACHED refusals (#386) load-bearing for their
      // classification — an edit to a customer sentence would silently
      // reclassify a refusal as `spawnFailed` and hand it a "Run doctor"
      // button. The type cannot be edited by accident.
      reason:
        error instanceof ChecksumError
          ? "checksumRefused"
          : classifyUnavailable(raw),
      detail: error instanceof ChecksumError ? error.detail : raw,
    },
  };
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
 * user is to install their proxy's CA there — not a per-tool "skip
 * verification" switch we would have to invent. Inventing one is also the wrong
 * trade: it would turn a verified download of an executable we then run into an
 * unverified one.
 *
 * The OS trust store is NOT claimed to fix the subprocesses, because it does
 * not. tan's own module doc is explicit that `git clone`, `pip` and `west
 * update` "do their own networking with their own trust stores" (tan-cli
 * `crates/tan-cli/src/http.rs`): pip verifies against `certifi`'s bundled CA
 * and never consults the Windows/macOS store (it needs `PIP_CERT` /
 * `REQUESTS_CA_BUNDLE` / `--trusted-host`), and Git for Windows built against
 * OpenSSL uses its own `ca-bundle.crt`. Promising them here is how a user
 * installs the CA as told, watches tan start working, then hits
 * `CERTIFICATE_VERIFY_FAILED` on the pip step and concludes the extension lied.
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
      "CA certificate into the OS trust store; there is no way to disable the " +
      "check for tan alone. Note that this fixes tan itself only — the tools " +
      "it runs (git, pip, west) each verify against their own trust store, so " +
      "a TLS-inspecting proxy may still need PIP_CERT / REQUESTS_CA_BUNDLE " +
      "for pip and http.sslCAInfo for git.",
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
    // NOT an inline arrow, deliberately — but the reason is narrower than it
    // looks, and two review rounds got it wrong, so it is worth stating
    // exactly. `downloadFile`'s signature stops an arrow reaching the transfer
    // without SAYING what it wants: `downloadFile(url, dest, signal, …)` is
    // TS2739 ("Type 'AbortSignal' is missing the following properties from
    // type 'ChecksumSpec': assetName, checksumsUrl") and omitting the argument
    // is TS2554 — both pinned by test/fixtures/comment-claims.ts. What it
    // cannot stop is an arrow that says `null` —
    // `downloadFile(url, dest, null, { signal, proxy })` compiles, and ships
    // unverified bytes to `cachedBinaryPath`.
    //
    // So the compiler is half of it and `test/alpCli.downloadSeamWiring.test.js`
    // is the other half: it captures the `ResolveDeps` this function builds and
    // drives THIS `download` against a tampered release server. (Earlier
    // comments here claimed no unit test could load this file because it
    // imports `vscode`. That was never true — several tests load it behind a
    // `Module._load` stub.) Settings are read at call time (see
    // `proxySettings`), so the seam's signature carries only what the caller
    // knows.
    download: downloadSeam(proxySettings),
    chmodExec: (p) => fs.chmodSync(p, 0o755),
    sha256File,
    // `globalState`, not a sidecar in `cacheDir` — see
    // `ResolveDeps.recordedCachedDigest` for why the record deliberately does
    // not live next to the thing it vouches for.
    recordedCachedDigest: () =>
      context.globalState.get<string>(CACHED_DIGEST_KEY),
    recordCachedDigest: async (digest) => {
      await context.globalState.update(CACHED_DIGEST_KEY, digest);
    },
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
 * use anyway), self-heals a managed *cached* copy that's fallen behind the
 * pinned SUPPORTED_CLI_VERSION, and re-acquires an UN-DIGESTED cached copy
 * whatever else resolved (#396 — see shouldFetchManagedCli for why that one
 * cannot key on the resolved source); surfaced with a one-time progress
 * notification. User/build-owned sources are never auto-replaced. Never throws:
 * a failure here is logged and the normal per-command resolution ladder still
 * runs (and can retry the download) later.
 */
export async function ensureTanCliProvisioned(
  context: vscode.ExtensionContext,
): Promise<void> {
  const deps = buildResolveDeps(context);
  const input = resolutionInputFromDeps(deps);

  warnIfPreferGlobalCliHasNoPath(deps.preferGlobalCli, input.onPath);
  // Both notices sit above the fetch decision and neither influences it: this
  // one is about which binary is ALREADY going to run, and it excludes the
  // machine the fetch below is for (an un-digested cache — see
  // `shouldNoticeUnverifiedPath`), so its position relative to the heal cannot
  // make it say something the heal is about to falsify.
  noticeUnverifiedPathFallback(context, input);

  const source = decideBinarySource(input);
  // A binary already resolves (cliPath / bundled / local build / cached / PATH)
  // — nothing to fetch, EXCEPT the two things in the extension's OWN cache that
  // are its own to heal: a copy behind the pin, and a copy with no recorded
  // digest the ladder just stepped over onto PATH (see shouldFetchManagedCli).
  //
  // Only probe when the answer can change the decision, i.e. on the stale-pin
  // arm alone. Not because an un-digested copy would refuse the probe — it
  // would not: `decideBinarySource` SKIPS that copy, so `readResolvedCliVersion`
  // would resolve something else entirely and answer a question about the
  // cached binary with the PATH binary's version (or take the `download` arm and
  // fetch from a function whose contract is "decide, don't fetch").
  const cachedVersion =
    source === "cached" ? await readResolvedCliVersion(deps) : null;
  // Asked with the whole INPUT, not with `source`: the un-digested-cache heal
  // has to key on the state of the cache, and `source` cannot express it (see
  // shouldFetchManagedCli). Passing `source` here is what left the heal unable
  // to fire on the very machines it was written for (#396).
  if (!shouldFetchManagedCli(input, cachedVersion)) {
    return;
  }
  // Reached the fetch: a `download` source is a fresh provision; a `cached`
  // source here means the managed copy is behind the pin — an update.
  const updatingStaleCache = source === "cached";
  // …and a THIRD case that looks like the first: a binary is already sitting at
  // `cachedBinaryPath`, but it predates the digest record, so it was skipped by
  // `decideBinarySource` and this fetch is re-acquiring it through the verified
  // path (#386). Worth separating because the failure sentence differs — this
  // customer HAS a tan CLI, and telling them it "couldn't be downloaded, build
  // and validate need it" explains nothing about why the one they have stopped
  // being used.
  //
  // True here implies `source` is `path` or `download`: `shouldFetchManagedCli`
  // only reaches the fetch on those two when the cache is un-digested, and a
  // `cached` source means a digest was recorded. A `cliPath`/`bundled`/
  // `localBuild` machine returned above and never sees any of this.
  const reacquiringUnverifiedCache = isUnverifiableCache(input);
  // Resolved ONCE, because it decides two things that must not disagree:
  // whether the fetch below can happen at all, and whether the sentence for a
  // heal that did not happen may say "reconnect and retry" — on a host with no
  // published binary that instruction is false, not merely unhelpful.
  const asset = releaseAssetForTarget(deps.platform, deps.arch);
  // The ONE sentence that depends on the machine rather than on the failure:
  // which arm the ladder fell through to, and whether a re-acquire is possible
  // here at all. `undefined` when the cache is not un-digested, so every other
  // refusal keeps its own wording. Hoisted above the two early returns below
  // because BOTH ways a heal can fail to happen have to be able to say it.
  const migrationCause = unverifiedCacheCause(input, Boolean(asset));
  // Don't re-attempt a self-heal we already proved futile for this pin (the
  // fetched pin's binary still read behind — a mis-published release). Bounds
  // the download + toast to once per pin across activations; a pin bump re-arms.
  //
  // GATED ON `updatingStaleCache` ONLY, and that is load-bearing rather than
  // incidental. The un-digested-cache heal must NOT adopt this latch: its
  // common failure is being offline, which is transient, and one latched
  // activation would disable the heal until the pin moved — leaving the machine
  // on the unverified PATH binary permanently, i.e. #396 with a marker written
  // on top of it. The only failure that would justify giving up is a heal that
  // COMPLETES and still cannot record a digest, and that one is unlatchable by
  // construction: the record and this marker are both `globalState` writes, so
  // whatever stopped the first stops the second.
  if (
    updatingStaleCache &&
    context.globalState.get<string>(HEAL_GAVE_UP_KEY) === SUPPORTED_CLI_VERSION
  ) {
    return;
  }
  // No prebuilt binary for this host. A fresh install skips SILENTLY — a
  // command will surface the "set alpSdk.cliPath" guidance if the user actually
  // invokes one. A RE-ACQUIRE may not: the un-digested cache has already been
  // stepped over, so a bare return here is the same zero-click fall-through onto
  // the PATH binary this heal exists to close — it just never reaches the
  // network to fail. Narrow (a host with no published target) and permanent,
  // which is exactly why it must say so rather than repeat the silence every
  // activation forever.
  //
  // No Retry, and that is not an oversight: `alp.updateCli` re-enters
  // `downloadCli`, which throws on this same missing asset, so the button is
  // dead by construction here — which is also why the sentence may not be one
  // of the "reconnect and retry" pair (`unverifiedCacheCause` picks the
  // no-prebuilt wording off the same `asset` this branch tests).
  //
  // The button IS `alpSdk.cliPath`, the setting the two "reconnect" sentences
  // withhold. That suppression is #389's and does not survive the trip here:
  // it exists because `cliPath` lets a user escape a checksum refusal onto an
  // unverified binary when a verified one was one download away, and on this
  // host no verified binary is obtainable at all. `downloadCli`'s own throw for
  // this same missing asset already names it. The alternative is a permanent
  // per-activation toast whose only click is "Show Output".
  if (!asset) {
    if (reacquiringUnverifiedCache) {
      log(
        `[cli] no prebuilt tan CLI for ${deps.platform}/${deps.arch}, so the ` +
          `un-digested cached binary cannot be re-acquired on this host`,
      );
      notifyAsync(
        planFailure({
          operation: "Provisioning the tan CLI",
          // The `??` is the type's, not a real branch: `migrationCause` is
          // defined exactly when `isUnverifiableCache(input)` holds, which is
          // the enclosing `if`. The default is still the no-prebuilt sentence
          // rather than the plain one, because the plain one ends "reconnect
          // and retry" — the clause this whole branch exists to keep off a host
          // where there is nothing to fetch, ever.
          cause: migrationCause ?? CACHED_CLI_UNVERIFIED_NO_PREBUILT,
          // Logged to the channel by the presenter whether or not a button
          // opens it, so the host string is never lost by naming a remedy.
          detail: `no prebuilt tan CLI for ${deps.platform}/${deps.arch}`,
          actions: [{ id: "openSettings", arg: "alpSdk.cliPath" }],
        }),
      );
    }
    return;
  }
  let cancelled = false;
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: updatingStaleCache
          ? `Updating the tan CLI to ${SUPPORTED_CLI_VERSION}…`
          : reacquiringUnverifiedCache
            ? "Verifying the tan CLI (one-time re-download)…"
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
          log(`[cli] downloading tan CLI: ${asset.url}`);
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
        checksumFailurePlan(
          error,
          "Provisioning the tan CLI",
          migrationCause,
        ) ??
        planFailure({
          operation: "Provisioning the tan CLI",
          cause: reacquiringUnverifiedCache
            ? // NOT the generic sentence below: this machine has a tan CLI, it
              // just isn't one anything can vouch for (#386). Narrow by the
              // time it is reached — `downloadCli` re-frames every TRANSPORT
              // failure of a re-acquire into a `ChecksumError` (the wall-clock
              // `TimeoutError` included: it used to escape that re-framing, and
              // reached this branch on a transfer that had NOT succeeded), and
              // `checksumFailurePlan` above already caught those. A cancel and
              // a closing window returned further up. So what lands here is the
              // residue of a transfer that DID succeed: the binary could not be
              // read back, or its digest not stored.
              (migrationCause ?? CACHED_CLI_UNVERIFIED)
            : updatingStaleCache
              ? `Couldn't update the tan CLI to ${SUPPORTED_CLI_VERSION}. The installed version still works — retry when you're back online.`
              : "Couldn't download the tan CLI. Build and validate commands need it — retry when you're back online, or point alpSdk.cliPath at a local build.",
          detail,
          // `alp.updateCli` re-runs exactly this download, so the presenter can
          // execute the retry itself; a caller-handled `retry` id would be a
          // dead button here because nothing awaits this plan.
          //
          // `alpSdk.cliPath` is offered on the FIRST-INSTALL failure only. It is
          // withheld from the re-acquire, for the reason #389 withdrew it from
          // the checksum refusal: that setting is the one resolution source
          // never checked against anything, so offering it as the way out of a
          // verification failure is a one-click route to running the unverified
          // binary permanently.
          actions:
            updatingStaleCache || reacquiringUnverifiedCache
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

/**
 * Say ONCE, plainly, that the `tan` being run is the one the customer's shell
 * resolves and is not one this extension verified (#393). Never a refusal and
 * never a demotion — see `shouldNoticeUnverifiedPath` for why both were
 * rejected, and `UNVERIFIED_PATH_IN_USE` for why the sentence is worded the way
 * it is.
 *
 * Fires for the rung-6 FALLBACK only. `alpSdk.preferGlobalCli` (rung 2) gets
 * NOTHING here — no toast, no log line, no fetch — which is the constraint #396
 * got wrong at this exact rung by gating only the sentence.
 *
 * `info` severity, so the presenter shows an information message and appends no
 * "Show Output": there is no failure to diagnose. The action is the managed
 * download, which genuinely ends the state (a digested `cached` copy outranks
 * the rung-6 fallback), and it is an OFFER — nothing happens unless it is
 * clicked.
 *
 * Synchronous, and the record is fire-and-forget for the reason
 * `setupOrchestrator.record` documents: `Memento.update` is a main-thread RPC
 * that rejects at window teardown, and awaiting it here would take
 * `ensureTanCliProvisioned`'s "never throws" down with it. The write is
 * idempotent; the worst case is the notice repeating on the next activation,
 * which is the safe direction for a notice whose whole job is to be seen.
 */
function noticeUnverifiedPathFallback(
  context: vscode.ExtensionContext,
  input: BinaryResolutionInput,
): void {
  if (
    !shouldNoticeUnverifiedPath(
      input,
      context.globalState.get<boolean>(PATH_NOTICED_KEY, false),
    )
  ) {
    return;
  }
  void Promise.resolve(context.globalState.update(PATH_NOTICED_KEY, true)).then(
    undefined,
    (error: unknown) => {
      if (isCancellation(error)) return;
      log(`[cli] could not record the PATH notice: ${String(error)}`, "warn");
    },
  );
  log(
    "[cli] resolved tan from PATH (rung-6 fallback: no managed copy resolved) " +
      "— nothing here verified that binary; the format probe on `tan --version` " +
      "is not an integrity check",
  );
  notifyAsync(
    planFailure({
      operation: "Resolving the tan CLI",
      cause: UNVERIFIED_PATH_IN_USE,
      // Not a failure and not a warning: the setup works, and rendering this
      // red or yellow would send the customer looking for a break that isn't
      // there.
      severity: "info",
      // `alpSdk.cliPath` is deliberately not offered — see the sentence's own
      // doc comment. This button downloads the pinned copy into the extension's
      // storage, where `cached` outranks this fallback on the next resolution.
      actions: [{ id: "updateCli", title: "Use the managed copy" }],
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
 *
 * @callers 2 checkCliVersion
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
 * resolution so the next command uses it. An `alpSdk.cliPath` that points at a
 * file which EXISTS wins over the download, so guide that user to Settings
 * instead of fetching a binary that won't be used — but a setting that does not
 * resolve is not a refusal: the ladder skips it, the download does win, and
 * this command must run it (see the guard below).
 */
export async function updateAlpCli(
  context: vscode.ExtensionContext,
): Promise<void> {
  const deps = buildResolveDeps(context);
  // Asks the SAME question `decideBinarySource` does — the setting must point
  // at a file that EXISTS, not merely be non-empty. A `cliPath` left over from
  // a moved checkout or arriving via settings sync does not resolve, the ladder
  // skips it, and a download DOES win, so refusing on the bare string was a
  // refusal that wasn't true.
  //
  // It also dead-ended the one thing this command exists to unblock: the #396
  // notice's only button is this command, and on such a machine it answered
  // "alpSdk.cliPath is set …" with an `openSettings → alpSdk.cliPath` button —
  // two clicks from a verification refusal to the arm that is never verified,
  // the exact button #389 removed.
  if (deps.cliPathSetting && deps.fileExists(deps.cliPathSetting)) {
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
    // This command is the Retry on the #396 notice, so it lands here on the
    // machine that notice was raised for — still offline, still stepping over
    // an un-digested cache onto PATH. Without this the click one hop earlier
    // said "commands are falling back to the tan on your PATH", and one hop
    // later said only "downloading it once more settles this for good": the
    // same defect, on the route this branch created. Built from the same pure
    // rule as activation's, off the state on disk, which a failed download
    // leaves exactly as it found it (`downloadCli` writes to a temp file and
    // records the digest only on success).
    const migrationCause = unverifiedCacheCause(
      resolutionInputFromDeps(deps),
      Boolean(releaseAssetForTarget(deps.platform, deps.arch)),
    );
    notifyAsync(
      // The one failure a retry cannot clear — a live process is holding the
      // installed binary, so the same rename fails the same way until it exits.
      cliInUsePlan(error, "Updating the tan CLI") ??
        // …and the one a retry cannot clear either until the proxy changes.
        proxyFailurePlan(error, "Updating the tan CLI") ??
        // …and the one that is not a failure at all but a refusal: the bytes
        // arrived and were rejected. The existing binary is untouched.
        checksumFailurePlan(error, "Updating the tan CLI", migrationCause) ??
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
      outcome: unavailableOutcome(error),
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

/** Run `command` through the user's LOGIN shell on POSIX, so the child sees the
 *  environment a terminal would — `~/.zshrc` / `~/.bashrc`, venv activation,
 *  every PATH entry a GUI-launched VS Code (macOS `.app`, a Linux desktop
 *  launcher) never sourced into the extension host.
 *
 *  This is the property terminal mode had for free and channel mode loses:
 *  `cp.spawn` inherits the EXTENSION HOST's env, not the shell's. Reconstructing
 *  one PATH entry (the bootstrap venv) instead would both miss everything else
 *  the user put in their profile and fork the venv-resolution logic that already
 *  lives in `tan` itself.
 *
 *  The command string itself — quoting, the `cd` into `cwd`, the `exec` —
 *  comes from `posixLoginShellCommand` in the pure service, where its edge
 *  cases are testable without a VS Code host.
 *
 *  `null` on Windows, where the extension host already inherits the login
 *  session's environment and there is no `-lc` equivalent worth emulating. */
function loginShellInvocation(
  command: string,
  args: string[],
  cwd?: string,
): { file: string; argv: string[] } | null {
  if (process.platform === "win32") return null;
  const shell = process.env.SHELL?.trim() || "/bin/sh";
  return {
    file: shell,
    argv: ["-lc", posixLoginShellCommand(command, args, cwd)],
  };
}

/**
 * Run a `tan` command with its output streamed live into the "Alp SDK" output
 * channel (channel mode). Unlike terminal mode the log PERSISTS after the
 * process exits — the channel does not die with the command, so the outcome and
 * full log stay visible. Forces `--no-color` (the channel renders plain text)
 * and `--non-interactive` (no TTY to answer prompts), so this is for the
 * orchestrator commands that don't need a live console: build/flash/image/clean.
 * Flash matters most here — its per-slice failure reasons (e.g. "backend
 * zephyr_west_flash needs west on PATH") used to vanish with the dying terminal,
 * leaving only "failed to launch". Renode streams for the same reason: its
 * headless smoke refuses a multi-Zephyr-slice manifest BEFORE booting, and that
 * refusal died with the terminal. Bootstrap keeps runAlpInTerminal — it can
 * prompt, so it genuinely needs the TTY. Raises a verdict toast on close.
 *
 * Env: on POSIX the child runs under the user's LOGIN shell
 * (`loginShellInvocation`), so a tool the flash backend shells (`west`) is
 * found via the user's own profile — the venv a `tan bootstrap` activated, not
 * only whatever PATH a GUI-launched VS Code inherited. Windows spawns the
 * binary directly, where the extension host already has the login environment.
 *
 * One run per name, shared with `runInTerminal` (see `reserveStreamedRun`): a
 * second dispatch under a live name is refused, never allowed to terminate the
 * first.
 */
export async function runAlpStreamed(
  context: vscode.ExtensionContext,
  args: string[],
  options: { name: string; cwd?: string },
): Promise<void> {
  // Refuse a same-named re-run; never terminate one. `src/west.ts` routes
  // FLASH through here, and killing a flash mid-write can leave a board
  // unbootable — the hazard `runInTerminal`'s guard was written for (#146).
  // Reserved BEFORE the first await, so two clicks landing back-to-back can't
  // both pass while the binary is still being resolved.
  if (!reserveStreamedRun(options.name)) {
    log(
      `[channel] "${options.name}" refused — a run under that name is still in flight`,
    );
    // The holder may be a TERMINAL run under the same name (one registry), and
    // then there is no channel to show — offer the surface that has the output.
    notifyAsync(
      planFailure({
        severity: "warning",
        operation: options.name,
        cause: `"${options.name}" is still running.`,
        detail: "Wait for it to finish before starting it again.",
        actions: [
          isStreamedRunActive(options.name)
            ? { id: "showOutput" }
            : { id: "showTerminal", arg: options.name },
        ],
      }),
    );
    return;
  }
  try {
    await streamRun(context, args, options);
  } finally {
    releaseStreamedRun(options.name);
  }
}

/** The body of `runAlpStreamed`, split out so its every exit path — including
 *  a failed binary resolution — releases the reservation via one `finally`. */
async function streamRun(
  context: vscode.ExtensionContext,
  args: string[],
  options: { name: string; cwd?: string },
): Promise<void> {
  let binary: ResolvedBinary;
  try {
    binary = await resolveAlpBinaryForContext(context);
  } catch (error) {
    log(
      `[cli] ✗ CLI unavailable (streamed): ${error instanceof Error ? error.message : String(error)}`,
    );
    // NOT awaited: an error notification with a button does not auto-dismiss,
    // so awaiting it would hold this run's reservation for as long as the toast
    // sits unanswered — refusing every later click with "still running" when
    // nothing is running at all.
    void surfaceResolutionError(error, options.name);
    return;
  }
  const finalArgs = [...withSdkRoot(args), "--no-color", "--non-interactive"];
  log(
    `[cli] $ ${binaryLabel(binary.command)} ${finalArgs.join(" ")}  (channel: ${options.name})`,
  );

  showOutput();
  appendOutput(`\n$ ${options.name}\n`);

  const shellRun = loginShellInvocation(binary.command, finalArgs, options.cwd);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.name,
      cancellable: true,
    },
    (_progress, token) =>
      new Promise<void>((resolve) => {
        // `spawnEnv()`, not the inherited environment: `child_process` REPLACES
        // the environment when `env` is passed, so this is the whole of
        // `process.env` plus the proxy gap-fillers (#377). A streamed `tan
        // build` that has to fetch is on a proxied machine's only path to the
        // network, exactly like the envelope-mode runs.
        const child = shellRun
          ? cp.spawn(shellRun.file, shellRun.argv, {
              cwd: options.cwd,
              env: spawnEnv(),
            })
          : cp.spawn(binary.command, finalArgs, {
              cwd: options.cwd,
              env: spawnEnv(),
            });
        // Decode as UTF-8 on the stream, not per chunk: a multi-byte character
        // split across a chunk boundary is mangled by a per-chunk toString().
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (text: string) => appendOutput(text));
        child.stderr?.on("data", (text: string) => appendOutput(text));

        // `settled` guards the racing ends: `error` can fire before the exit
        // events, and a caller chaining off this must not see it resolve twice.
        let settled = false;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(killTimer);
          resolve();
        };
        token.onCancellationRequested(() => {
          // The user's own explicit stop — the ONE kill left on this path.
          // `posixLoginShellCommand` `exec`s the binary, so this signals `tan`
          // itself rather than a wrapper shell that would leave it orphaned.
          log(`[channel] "${options.name}" cancelled by the user`);
          appendOutput(`\n[cancelled] ${options.name}\n`);
          child.kill();
          // Escalate if SIGTERM is not honoured. Without this the run can hang
          // here forever, and since the reservation is released only when this
          // promise settles, the command would stay refused ("still running")
          // until the window is reloaded.
          killTimer = setTimeout(() => {
            if (settled) return;
            log(
              `[channel] "${options.name}" ignored SIGTERM after ${CANCEL_GRACE_MS / 1000}s — sending SIGKILL`,
              "warn",
            );
            child.kill("SIGKILL");
          }, CANCEL_GRACE_MS);
        });
        child.on("error", (err) => {
          notifyAsync(
            planFailure({
              operation: options.name,
              cause: `${options.name} could not start.`,
              detail: err.message,
              actions: [{ id: "showOutput" }],
            }),
          );
          finish();
        });
        // `exit`, not `close`: `close` waits for every inherited stdio pipe to
        // end, and `tan` shells build tools (`west`, `ninja`) that hold those
        // pipes past their parent's death — after a cancel that can be
        // indefinitely. The verdict is known at `exit`, and the reservation
        // must be freed there; late output still reaches the channel because
        // the `data` handlers stay attached.
        child.on("exit", (code, signal) => {
          // A kill (the Cancel button) is not a failure to report as one.
          if (signal) {
            log(`[channel] "${options.name}" stopped (signal=${signal})`);
          } else {
            signalStreamedFinished(options.name, code ?? undefined);
          }
          finish();
        });
        // Backstop for the one case `exit` cannot cover: a spawn that fails
        // without ever producing a process still emits `close`.
        child.on("close", () => finish());
      }),
  );
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
  return notify(planCliOutcome(unavailableOutcome(error), { operation }));
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
