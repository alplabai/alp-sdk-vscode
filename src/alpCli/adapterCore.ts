// SPDX-License-Identifier: Apache-2.0
//
// IO orchestration for the tan-CLI integration, written against injected seams
// (filesystem / process / network) so it is unit-testable without `vscode`.
// The thin `vscodeAdapter` wires the real implementations.

import { ChecksumError, CliInUseError, ProxyError } from "./download";
import {
  BinaryResolutionInput,
  BinarySource,
  ChecksumSpec,
  CliOutcome,
  ReleaseAsset,
} from "./models";
import {
  CACHED_CLI_MISMATCH,
  CACHED_CLI_UNVERIFIED,
  classifyOutcome,
  classifyUnavailable,
  decideBinarySource,
  isUnverifiableCache,
  parseEnvelope,
  releaseAssetForTarget,
  TAN_CLI_DOWNLOAD_CONSENT_NEEDED,
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

export type SpawnAsyncFn = (
  command: string,
  args: string[],
  cwd?: string,
) => Promise<SpawnResult>;

/** Seams the resolver needs; the adapter supplies real fs/net/process impls. */
export interface ResolveDeps {
  cliPathSetting: string;
  platform: NodeJS.Platform;
  arch: string;
  /** Directory under global storage that holds the cached binary + archive. */
  cacheDir: string;
  /** Absolute path the cached binary would live at (cacheDir + binaryName). */
  cachedBinaryPath: string;
  /** Absolute path a `bin/tan[.exe]` staged in the extension install would
   *  live at — only present in a platform-specific VSIX. */
  bundledBinaryPath: string;
  /** Whether `bundledBinaryPath` exists on disk. */
  bundledExists: boolean;
  /** Absolute path of a locally-built sibling
   *  `tan-cli/target/{release,debug}/tan[.exe]`, or null when none exists
   *  (running from a source checkout with a built tan resolves the CLI here
   *  instead of a network download). */
  localBuildBinaryPath: string | null;
  /** The `alpSdk.preferGlobalCli` setting value (see `models.ts`). */
  preferGlobalCli: boolean;
  fileExists: (path: string) => boolean;
  commandOnPath: (command: string) => boolean;
  ensureDir: (dir: string) => void;
  /** `verify` is REQUIRED, not optional: the managed binary is executed, so
   *  every fetch of it must be checked against the digest the release
   *  publishes.
   *
   *  What this type buys is the CALLER: omitting the argument in `downloadCli`
   *  is a `TS2554`. It does NOT constrain the PROVIDER — several spellings of
   *  an unverifying implementation assign to it cleanly (a 3-parameter arrow, a
   *  hard-coded `null`, a cast, a spread over the deps object). Those are
   *  pinned behaviourally by `test/alpCli.downloadSeamWiring.test.js`, which
   *  drives the `download` each real entry point ends up with against a
   *  tampered release. Do not read this as "the compiler refuses"; it refuses
   *  half. */
  download: (
    url: string,
    destFile: string,
    signal: AbortSignal | undefined,
    verify: ChecksumSpec,
  ) => Promise<void>;
  chmodExec: (path: string) => void;
  /** Lowercase hex sha256 of a file, or null when it cannot be read. Injected
   *  (rather than hashed here) so the tests can drive a mismatch without
   *  writing 3 MB to disk, and so the real implementation can memoize — see
   *  `sha256File` in `vscodeAdapter.ts` for the measured cost. */
  sha256File: (path: string) => string | null;
  /** The sha256 this extension recorded for the file now at
   *  `cachedBinaryPath`, or undefined when there is none.
   *
   *  Backed by `context.globalState`, NOT a sidecar file in `cacheDir`. Two
   *  reasons: it is already this extension's pattern for cross-activation state
   *  (`HEAL_GAVE_UP_KEY`, `AHEAD_WARNED_KEY`), and it lives in a different
   *  directory from the binary, so something that merely drops a file into the
   *  cache directory does not thereby also control the record it is checked
   *  against.
   *
   *  WHAT THIS DOES AND DOES NOT BUY, stated plainly because the tempting word
   *  here is "tamper-proof" and that would be false: an attacker who already
   *  has write access to this user account can rewrite the binary AND the
   *  record, and nothing here stops them. What it does detect is corruption, a
   *  partial or interrupted write, a half-restored backup, and replacement by
   *  anything that does not know to update the record. */
  recordedCachedDigest: () => string | undefined;
  /** Record the digest of the binary just installed at `cachedBinaryPath`.
   *  Async because the real implementation is `globalState.update`. */
  recordCachedDigest: (digest: string) => Promise<void>;
  /**
   * Whether a tan CLI download may proceed — ADR 0021 Tier A's
   * one-consent-click rule. Called from `resolveAlpBinary`'s `download` arm
   * UNCONDITIONALLY, not only for a from-scratch install: `input.onPath` is
   * false by construction on every path that reaches the `download` arm
   * (`decideBinarySource` returns `path` first whenever `onPath` holds), so
   * there is no state inside this arm where a binary is actually in use — the
   * #396 un-digested-cache heal (moving a customer OFF a binary they are
   * running and unverified) cannot happen here no matter how the arm was
   * reached. Gating unconditionally is therefore not "widening" the gate onto
   * the heal; it closes a hole a review found after #434 merged, where a
   * stale un-digested file left in global storage (with nothing on PATH)
   * made `decideBinarySource` skip straight to `download` and this consent
   * check was excluded on the mistaken belief that it was excluding the heal.
   * See `isUnverifiableCacheInUse` (`service.ts`) for the corrected predicate
   * — it is `false` in every state this arm can be in, which is the proof.
   *
   * Never called for `cliPath`/`bundled`/`localBuild`/`cached`/`path` — those
   * never reach `downloadCli` at all.
   *
   * The real implementation (`vscodeAdapter.ts`) reads the SAME stored
   * answer / `alpSdk.tanCliDownloadConsent` setting the activation-time gate
   * does (`resolveTanCliDownloadConsent`, `service.ts`) — one decision, one
   * place. It prompts when unanswered ONLY for an INTERACTIVE resolution
   * (`buildResolveDeps`'s `interactive` option); a background resolution
   * (today: the activation-time version probe, and every non-user-triggered
   * `runAlpCommand` caller) never shows a dialog and simply refuses when
   * nothing is on record. */
  ensureFreshDownloadConsent: (asset: ReleaseAsset) => Promise<boolean>;
}

export interface ResolvedBinary {
  command: string;
  source: BinarySource;
}

/**
 * Build the pure resolver's input from the injected deps. This is the single
 * seam both `resolveAlpBinary` (below) and `ensureTanCliProvisioned`
 * (vscodeAdapter's activation-time provisioning) go through, so the fields
 * fed to `decideBinarySource` — in particular `preferGlobalCli` — can never
 * diverge between provisioning and per-command resolution.
 */
export function resolutionInputFromDeps(
  deps: ResolveDeps,
): BinaryResolutionInput {
  return {
    cliPathSetting: deps.cliPathSetting,
    cliPathExists:
      Boolean(deps.cliPathSetting) && deps.fileExists(deps.cliPathSetting),
    onPath: deps.commandOnPath("tan"),
    bundledExists: deps.bundledExists,
    localBuildExists: Boolean(deps.localBuildBinaryPath),
    cachedExists: deps.fileExists(deps.cachedBinaryPath),
    cachedDigestRecorded: deps.recordedCachedDigest() !== undefined,
    preferGlobalCli: deps.preferGlobalCli,
  };
}

/**
 * Resolve the `tan` command to invoke, downloading on demand when nothing else
 * is available. Throws when the host has no prebuilt binary and none is
 * configured/on PATH, when a download fails, or when the cached binary fails
 * verification — the surface maps each to its own action (see
 * `classifyUnavailable` / `planCliOutcome`).
 *
 * This is the ONE chokepoint every spawn of `tan` goes through. Verified by
 * enumeration, not by assumption: `resolveAlpBinaryForContext` (whose memo
 * feeds `runAlpCommand`, `runAlpInTerminal` and `runCliVersionCheck`) and
 * `readResolvedCliVersion` (which feeds `probeTanVersion` and
 * `ensureTanCliProvisioned`) are its only two callers, the `alp` task provider
 * delegates to `runAlpInTerminal` rather than spawning `tan` itself, and the
 * only other file in `src/` that names `cachedBinaryPath` is
 * `vscodeAdapter.ts` — which BUILDS the path into `ResolveDeps` and logs it,
 * never spawns from it. If that stops being true, the check below stops
 * covering the extension.
 *
 * @callers 2 resolveAlpBinary
 *
 * ── WHAT IS VERIFIED, AND WHY THE REST IS NOT — THE REASONS DIFFER ──
 * TWO OF THE SIX ARMS ARE VERIFIED: `download` and `cached`, i.e. the MANAGED
 * ACQUISITION CHANNEL. The count is stated out loud because "the tan we run is
 * verified" is what this section gets read as otherwise, and that reading is
 * false on four arms out of six. Those four execute what the user's environment
 * offers, which is the same trust boundary as their terminal — and their reasons
 * must not be flattened into one, because they are not the same statement:
 *
 *   - `download` — verified at write time (#389): the bytes are checked against
 *     the release's own `checksums.txt` before anything lands at
 *     `cachedBinaryPath`. `downloadCli` below then RECORDS that digest.
 *   - `cached`   — verified here, on every resolution, against that record
 *     (#386). This is the arm that actually gets reached: the download happens
 *     once, the cache is read forever.
 *
 *   - `cliPath` / `localBuild` — the user pointed at this binary deliberately,
 *     or built it themselves. There is no reference digest for either anywhere,
 *     and manufacturing one would be theatre: it would check a binary against
 *     itself and dress up "the user chose this" as an integrity guarantee.
 *   - `bundled` — staged inside the VSIX by `vsce package --target`, so it is
 *     covered by the signature on the extension package itself. Already checked
 *     upstream, which is a different claim from the two above, not a weaker one.
 *   - `path`, BOTH RUNGS — the `preferGlobalCli` opt-in above the managed
 *     copies, and the unchosen fallback below them. This executes whatever the
 *     environment offers and NOTHING about it is verified. `commandOnPath`'s
 *     `isNativeTanVersionOutput` is a FORMAT PROBE on the stdout of a binary we
 *     are about to run — attacker-controllable text, matched by a regex. It
 *     answers "does this look like the native clap CLI", never "is this what
 *     Alp Lab published". No wording anywhere may claim INTEGRITY for a PATH
 *     binary — that it is what Alp Lab published, or that anything checked it;
 *     a `package.json` description already had to be corrected for exactly that.
 *     The house compound `verified-native` (`service.ts`, `models.ts`, this
 *     file's callers, CLAUDE.md) is the one carve-out and stays: it names the
 *     format probe's verdict — this is the native clap CLI and not the retired
 *     `alp` — which is the only claim `commandOnPath` makes and the only one
 *     `input.onPath` carries. Do not read the noun as the adjective.
 *
 *     Since #393 the FALLBACK rung SAYS SO to the customer, once per install:
 *     an informational notice (`shouldNoticeUnverifiedPath` /
 *     `UNVERIFIED_PATH_IN_USE`), never a refusal and never a demotion — see
 *     that rule for why both were rejected. Rung 2 stays completely silent,
 *     because `preferGlobalCli` is that user telling us which `tan` to run.
 *     Note also who CREATES this state: the extension's own "Install tan CLI
 *     (global)" button runs `media/tan-install/install.{sh,ps1}`, vendored
 *     copies of tan's own installer that download a release asset and install
 *     it with no checksum step at all (verified by reading both scripts:
 *     neither names sha256/shasum/Get-FileHash). Filed upstream as
 *     alplabai/tan-cli#176 — patching the vendored copies locally would diverge
 *     them from the installer they mirror, which is worse.
 *
 * A refusal must never fall through onto one of those arms, which is what #396
 * closed — and the mechanism upstream is a SKIP, not a refusal, which is the
 * only reason the ladder continues at all. `decideBinarySource` steps over an
 * un-digested cache BEFORE this function runs (the `cached` arm's `unrecorded`
 * throw below is unreachable through it, and a refusal there would throw rather
 * than reach `path`), so on a machine that also had a global `tan` the next rung
 * was `path` — a zero-click route onto an unverified binary. The fix is upstream
 * too, in `shouldFetchManagedCli`: activation re-acquires the cache through the
 * verified channel whenever the ladder would otherwise step over it onto `path`
 * or `download`, and precedence puts `cached` back above the `path` fallback on
 * its own. Neither the ladder's order nor either `path` rung's meaning changed.
 *
 * ponytail: after resolution both `path` rungs collapse to the same
 * `BinarySource` value `"path"`, so a consumer needing the opt-in/fallback
 * distinction re-derives it from `preferGlobalCli`. #393 would have been the
 * FIFTH site to re-type that expression — the point this note named as "split
 * the resolved label instead" — so it was given a NAME rather than a fifth
 * copy: `isUnverifiedPathFallback` (`service.ts`), which `unverifiedCacheCause`
 * and `shouldNoticeUnverifiedPath` both call. Four sites still ask the question:
 * `cliFixAction` and `aheadPathFixAction` (post-resolution, they hold a
 * `BinarySource` and a flag, not an input, so they cannot call it),
 * `shouldFetchManagedCli` (already inside a `source === "path"` branch), and
 * that one shared rule. Split the label if a consumer appears that this rule
 * cannot serve.
 */
export async function resolveAlpBinary(
  deps: ResolveDeps,
): Promise<ResolvedBinary> {
  const input = resolutionInputFromDeps(deps);
  const source = decideBinarySource(input);
  switch (source) {
    case "cliPath":
      return { command: deps.cliPathSetting, source };
    case "path":
      return { command: "tan", source };
    case "bundled":
      if (deps.platform !== "win32") {
        deps.chmodExec(deps.bundledBinaryPath);
      }
      return { command: deps.bundledBinaryPath, source };
    case "localBuild":
      if (deps.platform !== "win32") {
        deps.chmodExec(deps.localBuildBinaryPath!);
      }
      return { command: deps.localBuildBinaryPath!, source };
    case "cached": {
      const recorded = deps.recordedCachedDigest();
      if (recorded === undefined) {
        // Not reachable through `decideBinarySource`, which only answers
        // "cached" when `cachedDigestRecorded` holds — and kept anyway, because
        // this function is exported and takes its `deps` from the caller. The
        // alternative to throwing is returning a path nobody checked, which is
        // #386 itself.
        throw new ChecksumError(
          "unrecorded",
          CACHED_CLI_UNVERIFIED,
          `no recorded digest for ${deps.cachedBinaryPath}`,
        );
      }
      const actual = deps.sha256File(deps.cachedBinaryPath);
      if (actual !== recorded) {
        // REFUSES, and must stay a refusal rather than a warning: the next
        // thing that happens to this path is a spawn. A warning would mean
        // "we noticed this binary is not the one we verified, and ran it".
        throw new ChecksumError(
          "mismatch",
          CACHED_CLI_MISMATCH,
          // Both digests and the path are channel-only — `ChecksumError.detail`
          // is what `planFailure` logs and never renders.
          `sha256 on disk is ${actual ?? "unreadable"}, recorded digest is ` +
            `${recorded} (${deps.cachedBinaryPath})`,
        );
      }
      return { command: deps.cachedBinaryPath, source };
    }
    case "download": {
      // The #386 re-acquire is re-framed inside `downloadCli`, not here: this
      // is one of THREE routes into a download, and the other two
      // (`ensureTanCliProvisioned`, `updateAlpCli`) call `downloadCli`
      // directly. A wrapper here would have covered the one route a unit test
      // reaches first and left the activation path — the one the customer
      // actually hits — on the generic sentence.
      //
      // ADR 0021 Tier A gate — UNCONDITIONAL in this arm, not "unless the #396
      // security heal applies". `isUnverifiableCache` alone used to exclude
      // the gate here, on the theory that it marked that heal — but
      // `decideBinarySource` returns `"path"` BEFORE it ever reaches
      // `"download"` whenever `input.onPath` holds (see the switch above), so
      // `input.onPath` is false on every path that lands in this arm and
      // `isUnverifiableCacheInUse(input)` (`service.ts`) is therefore
      // PROVABLY always false here — there is no live state this arm can be
      // in where a binary is actually running, un-digested cache or not, so
      // there is no one to strand by asking. That is the review finding this
      // closes (a stale un-digested file plus nothing on PATH used to make
      // `deny` silently ignored) and it is why the call below is no longer
      // guarded by that check: a guard that can never be false is not a
      // safety net, it is a second unconditional gate wearing a costume, and
      // the costume is where a later change routing into this arm from a
      // state where `onPath` DOES hold could silently un-gate consent again
      // with no test catching it. The activation-time heal in
      // `ensureTanCliProvisioned` (`vscodeAdapter.ts`) is the one place the
      // un-digested-cache exclusion is real (its `path`-sourced re-acquire
      // DOES have a binary in use); this arm never reaches that state.
      const asset = releaseAssetForTarget(deps.platform, deps.arch);
      // No prebuilt binary for this host: let `downloadCli`'s own throw name
      // that (it re-derives the same `asset`) rather than asking for consent
      // to a download that could never happen anyway.
      if (asset && !(await deps.ensureFreshDownloadConsent(asset))) {
        throw new Error(TAN_CLI_DOWNLOAD_CONSENT_NEEDED);
      }
      await downloadCli(deps);
      if (!deps.fileExists(deps.cachedBinaryPath)) {
        throw new Error("The tan CLI download did not produce a binary.");
      }
      return { command: deps.cachedBinaryPath, source };
    }
  }
}

/**
 * Re-frame a failure that happened while RE-ACQUIRING a cached binary that
 * predates the digest record (#386), or null to let `error` travel unchanged.
 *
 * This customer has a working `tan` on disk and is being told it will not be
 * used. Every sentence they would otherwise get — "couldn't download the tan
 * CLI, retry when you're back online", "the checksum file could not be fetched"
 * — is accurate about the fetch and silent about the only thing they need to
 * know: that the copy they already had predates verification and this is a
 * one-time step. So the migration sentence LEADS and the precise cause is kept
 * on `detail`, which the presenter logs to the channel and never renders.
 *
 * Three things travel unchanged, and each for its own reason:
 *
 *   - a `mismatch` — the release served bytes that are not the published ones.
 *     That outranks the migration framing and must never be softened into
 *     "reconnect and retry", which is #389's whole lesson about not flattening
 *     distinct refusals into one sentence;
 *   - a CANCEL, and `cancelled` is the CALLER'S OWN `AbortSignal` having fired
 *     — the customer pressed Cancel, or the window is closing. Not a failure.
 *     Only two of the three routes into `downloadCli` pass a signal at all
 *     (`ensureTanCliProvisioned` and `updateAlpCli`), and each branches on its
 *     own `cancelled` flag before it reaches any wording; the third, the
 *     per-command `resolveAlpBinary` `download` arm, passes none and branches
 *     on nothing.
 *
 *     Decided STRUCTURALLY rather than by the error's `name`, which is what
 *     this used to do and what made it wrong. `downloadFile` races the caller's
 *     signal against `AbortSignal.timeout(WALL_CLOCK_TIMEOUT_MS)`, so a stalled
 *     link throws a bare `TimeoutError` — abort-SHAPED, and a failure. Nothing
 *     branched on that: `isCancellation` (`src/notify/service.ts`) requires
 *     `name === message === "Canceled"`. On the per-command route it therefore
 *     escaped un-reframed, reached `unavailableOutcome` as a
 *     non-`ChecksumError`, classified `spawnFailed`, and the toast offered that
 *     plan's default "Install tan CLI" button (`src/notify/vscodeAdapter.ts`) —
 *     which puts a `tan` on PATH, one of the four arms `resolveAlpBinary` never
 *     verifies. A one-click route onto an unverified binary, the exact class
 *     #389 had to remove. No caller signal, no cancel;
 *   - a `CliInUseError` / `ProxyError` — already presented backwards from a
 *     network failure by their own plan, and a proxy that said no is a fact the
 *     migration framing would bury.
 */
function migrationRefusal(
  error: unknown,
  cancelled: boolean,
): ChecksumError | null {
  if (cancelled) {
    return null;
  }
  if (error instanceof ChecksumError) {
    return error.kind === "mismatch"
      ? null
      : new ChecksumError(
          "unrecorded",
          CACHED_CLI_UNVERIFIED,
          `${error.message} — ${error.detail}`,
        );
  }
  if (error instanceof CliInUseError || error instanceof ProxyError) {
    return null;
  }
  return new ChecksumError(
    "unrecorded",
    CACHED_CLI_UNVERIFIED,
    error instanceof Error ? error.message : String(error),
  );
}

export async function downloadCli(
  deps: ResolveDeps,
  signal?: AbortSignal,
): Promise<void> {
  const asset = releaseAssetForTarget(deps.platform, deps.arch);
  if (!asset) {
    throw new Error(
      `No prebuilt tan CLI for ${deps.platform}/${deps.arch}. ` +
        "Set alpSdk.cliPath to a local build (tan-cli/target/release/tan).",
    );
  }
  // Read BEFORE the transfer: afterwards a success has written the record, so
  // the same question would answer differently and the wording would depend on
  // where in the function it was asked.
  const migrating = isUnverifiableCache({
    cachedExists: deps.fileExists(deps.cachedBinaryPath),
    cachedDigestRecorded: deps.recordedCachedDigest() !== undefined,
  });
  deps.ensureDir(deps.cacheDir);
  // tan-cli ships a RAW binary per target (not an archive): download it straight
  // to the cached binary path. `download` itself chmods +x before the rename
  // that makes it appear at `cachedBinaryPath` (closes the race where a
  // concurrent window resolves "cached" and spawns a not-yet-executable
  // file); this call is now a harmless idempotent safety net.
  //
  // `asset` is passed as the verification spec as well as the source URL: it
  // already carries `assetName` and `checksumsUrl` for the SAME release tag, so
  // the digest can never be looked up against a different release than the
  // bytes came from. Nothing lands at `cachedBinaryPath` unless it matches.
  try {
    await deps.download(asset.url, deps.cachedBinaryPath, signal, asset);
  } catch (error) {
    throw (
      (migrating ? migrationRefusal(error, signal?.aborted === true) : null) ??
      error
    );
  }
  if (deps.platform !== "win32") {
    deps.chmodExec(deps.cachedBinaryPath);
  }
  // Record what `resolveAlpBinary`'s `cached` arm will check on every later
  // activation (#386). Hashed off the file that LANDED rather than plumbed out
  // of the transfer: it costs one read of a file that was written moments ago,
  // it needs no change to the `download` seam's contract, and it also catches
  // the (unlikely) case of the rename itself producing something different from
  // what was verified.
  //
  // Written LAST, and a failure to write it is not swallowed. The download
  // itself already succeeded, so this leaves a good binary on disk with no
  // record — which the next resolution treats as the migration case and
  // re-acquires. Fail-closed: the alternative is a binary nothing will ever
  // check again.
  //
  // ALL THREE download routes reach this, because they all call this function:
  // `resolveAlpBinary`'s `download` arm, `ensureTanCliProvisioned`, and
  // `updateAlpCli` (`test/alpCli.downloadSeamWiring.test.js` enumerates them
  // for the same reason).
  const digest = deps.sha256File(deps.cachedBinaryPath);
  if (!digest) {
    throw new Error(
      "The tan CLI download did not produce a binary that could be read back.",
    );
  }
  await deps.recordCachedDigest(digest);
}

/**
 * Run an envelope-mode command: `tan <args...> --format json`. Parses the
 * envelope and classifies the outcome. A spawn failure (e.g. ENOENT) yields an
 * `unknown`/error outcome rather than throwing.
 */
export function runAlp(
  command: string,
  args: string[],
  spawn: SpawnFn,
  cwd?: string,
): { outcome: CliOutcome; raw: SpawnResult } {
  return classifyAlpSpawn(spawn(command, [...args, "--format", "json"], cwd));
}

/**
 * Async twin of {@link runAlp}: the injected spawner returns a promise so the
 * extension host's event loop is never blocked on the CLI subprocess. Same
 * envelope parsing + classification; a spawn failure (ENOENT, timeout, or a
 * user-cancelled abort) still yields an error outcome rather than throwing.
 */
export async function runAlpAsync(
  command: string,
  args: string[],
  spawnAsync: SpawnAsyncFn,
  cwd?: string,
): Promise<{ outcome: CliOutcome; raw: SpawnResult }> {
  return classifyAlpSpawn(
    await spawnAsync(command, [...args, "--format", "json"], cwd),
  );
}

/** Shared post-spawn classification for {@link runAlp} / {@link runAlpAsync}. */
function classifyAlpSpawn(raw: SpawnResult): {
  outcome: CliOutcome;
  raw: SpawnResult;
} {
  if (raw.error) {
    // The errno/timeout text stays OFF `message` and travels on `unavailable.
    // detail` instead: `src/notify/service.ts` logs it to the output channel
    // and never renders it, so `spawn tan ENOENT` can't reach a toast.
    return {
      outcome: {
        exitCode: -1,
        kind: "unknown",
        ok: false,
        severity: "error",
        message: "Could not run the tan CLI.",
        envelope: null,
        unavailable: {
          reason: classifyUnavailable(raw.error.message),
          detail: raw.error.message,
        },
      },
      raw,
    };
  }
  const envelope = parseEnvelope(raw.stdout);
  // Prefer the process exit code; fall back to the envelope's own field.
  const exitCode = raw.status ?? envelope?.exitCode ?? 1;
  return { outcome: classifyOutcome(exitCode, envelope), raw };
}
