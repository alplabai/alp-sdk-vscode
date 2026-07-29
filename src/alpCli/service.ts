// SPDX-License-Identifier: Apache-2.0
//
// Pure logic for the tan-CLI integration: binary-source decision, envelope
// parsing, exit-code classification, and release-asset resolution. No `vscode`,
// `fs`, `child_process`, or network here — all of that lives in the adapter.

import {
  AlpEnvelope,
  AlpIssue,
  BinaryResolutionInput,
  BinarySource,
  CliExitKind,
  CliOutcome,
  CliUnavailableReason,
  ReleaseAsset,
} from "./models";

/** The `tan` CLI version this extension build targets for download-on-demand.
 *  Must match a published `v<version>` release tag in `alplabai/tan-cli`
 *  (aligned with tan-cli's `[workspace.package] version`).
 *
 *  v0.4.0 publishes `envelope-contract.json`, which is what
 *  `scripts/fetch-tan-contract.mjs` downloads for THIS pin — so the pin is what
 *  turns the envelope-contract gate from "skipped, loudly" into a check that
 *  verifies something. (v0.4.0-rc1 was the first tag to carry the asset; v0.4.0
 *  is the first NON-rc one, and the pin.) Which releases carry it is declared
 *  below, in `RELEASES_PREDATING_CONTRACT_ASSET`, rather than in this prose.
 *
 *  It is also the first release carrying what this extension now REQUIRES, not
 *  merely prefers: `tan debug-config --core` and its `data.configuration`
 *  (tan-cli#67 — `writeLaunchProfile` has no second draft to fall back to), and
 *  the `bootstrap.python-*` refusal codes `prerequisitesMissingIssue` reads
 *  (tan-cli#78/#81). Against v0.3.1 `--core` is `error: unexpected argument`,
 *  exit 2. Native (non-WSL-only) Windows bootstrap arrived earlier, in v0.3.1. */

export const SUPPORTED_CLI_VERSION = "0.4.0";

/**
 * Every published `alplabai/tan-cli` tag that does NOT carry an
 * `envelope-contract.json` release asset. `alplabai/tan-cli#106` wired the
 * asset into `release.yml`, and every tag from v0.4.0-rc1 on carries it — so
 * this list is CLOSED: no release cut from here on can predate the producer,
 * and nothing will ever be added to it. Checked against the live releases
 * rather than inferred from the issue: v0.3.1, the last tag before v0.4.0-rc1,
 * publishes nine assets and this is not one of them.
 *
 * The default is therefore "the pinned release IS expected to carry it", which
 * is the point. `scripts/fetch-tan-contract.mjs` and `test/tanContract.test.js`
 * both read this to tell a LEGITIMATE absence (the pin predates the asset)
 * from a BROKEN fetch (the pin publishes one and we did not get it). Only the
 * first may skip; the second is a failure. Before this list existed, both
 * exited 0 and the contract test SKIPPED, so a pin bump to a release without
 * the asset was green CI with zero contract verification.
 *
 * It lives next to `SUPPORTED_CLI_VERSION`, and holds versions rather than a
 * floor, so that a pin bump cannot quietly re-enter the skip path: an unlisted
 * version is expected to publish the asset, full stop.
 */
export const RELEASES_PREDATING_CONTRACT_ASSET: readonly string[] = [
  "0.1.0",
  "0.1.1",
  "0.2.0",
  "0.3.0",
  "0.3.1",
];

/** The repo whose GitHub releases host the prebuilt `tan` binaries. */
const RELEASE_REPO = "alplabai/tan-cli";

/** The checksum manifest every tagged tan release publishes alongside its
 *  binaries (verified against the live v0.4.0 release). */
const CHECKSUMS_ASSET = "checksums.txt";

/** Host platform/arch → rust target triple (the six targets tan-cli publishes a
 *  raw binary for). Windows ships BOTH x64 and arm64, picked by `process.arch`. */
const TARGETS: Readonly<Record<string, string>> = {
  "win32/x64": "x86_64-pc-windows-msvc",
  "win32/arm64": "aarch64-pc-windows-msvc",
  // musl (static), not gnu: the -gnu assets carry a glibc floor and break on
  // older distros. -musl is fully static, so it runs on any distro/libc.
  //
  // Two numbers, and they are NOT the same one (this comment used to conflate
  // them and both figures were wrong — see #370):
  //   - zigbuild PIN, from tan-cli's release.yml:  x86_64-unknown-linux-gnu.2.31
  //   - MEASURED floor of the shipped v0.3.1 -gnu asset (`readelf -V`): GLIBC_2.30
  // The pin caps which symbols may be used; the binary needs nothing above 2.30.
  // Measured: runs on debian:11 (2.31), ubuntu:22.04 (2.35), ubuntu:24.04 (2.39);
  // fails on ubuntu:18.04 (2.27) with `version 'GLIBC_2.30' not found`. So the
  // break is roughly pre-Ubuntu-20.04 / pre-Debian-11, NOT at 2.31, and the error
  // never says 2.39. -musl ran on all four.
  //
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
 *
 * ── A CACHED BINARY WITH NO RECORDED DIGEST IS NOT A RESOLUTION (#386) ──
 * `cachedExists` alone no longer picks `cached`; `cachedDigestRecorded` must
 * hold too. The cache is the one source that is written once and then spawned
 * on every activation forever, so it is the one that has to be re-checked — and
 * it can only be checked against the digest recorded when it was fetched. With
 * no record the ladder simply CONTINUES past it, exactly as if the file were
 * not there, which lands on PATH if a verified-native `tan` is installed and
 * otherwise on `download`, where it is re-acquired through the verified path.
 *
 * The decision is HERE, in the pure function everyone reads to answer "which
 * binary runs", rather than as a second gate inside the resolver — a caller
 * that must never fetch (`probeTanVersion`) branches on this answer, and would
 * silently start fetching on window focus if the rule lived downstream of it.
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
  if (input.cachedExists && input.cachedDigestRecorded) {
    return "cached";
  }
  if (input.onPath) {
    return "path";
  }
  return "download";
}

/**
 * True when a cached binary is on disk that this extension cannot vouch for:
 * it was downloaded before the digest was recorded (#386). `decideBinarySource`
 * has already skipped it, so the ladder is about to re-acquire it — this says
 * so, and it exists as one named rule because BOTH the resolver
 * (`adapterCore.ts`) and the activation-time provisioner (`vscodeAdapter.ts`)
 * have to word their failure differently for it, and a second copy of the
 * expression in either is how the two start disagreeing.
 *
 * Not reachable together with a `cached` source: `cachedExists &&
 * cachedDigestRecorded` returns `cached` above, so inside the `download` arm
 * `cachedExists` already implies the record is missing.
 */
export function isUnverifiableCache(
  // A `Pick`, not the whole input, for one concrete reason: `downloadCli` asks
  // this question and building a full `BinaryResolutionInput` there would call
  // `commandOnPath`, which SPAWNS `tan --version`. A process spawn per download
  // to answer a question about two booleans.
  input: Pick<BinaryResolutionInput, "cachedExists" | "cachedDigestRecorded">,
): boolean {
  return input.cachedExists && !input.cachedDigestRecorded;
}

/**
 * True when resolution lands on ladder RUNG 6 — the `path` FALLBACK nobody
 * chose, reached only because no managed copy resolved above it.
 *
 * `path` is reached at TWO rungs and both collapse to the same `BinarySource`
 * value after resolution, so the distinction can only be re-derived from the
 * flag: rung 2 is `preferGlobalCli && onPath`, so `!preferGlobalCli` identifies
 * rung 6 exactly. ONE named rule rather than that expression re-typed per
 * consumer — the two questions that ask it (`unverifiedCacheCause` and
 * `shouldNoticeUnverifiedPath`) must never disagree about which rung they are
 * describing, and telling a rung-2 user their own explicit choice is a
 * "fallback" is a mistake this file has already had to correct once.
 */
export function isUnverifiedPathFallback(
  input: BinaryResolutionInput,
): boolean {
  return decideBinarySource(input) === "path" && !input.preferGlobalCli;
}

/**
 * The sentence for the ONE-TIME #386 migration: a binary cached before this
 * extension recorded digests, which therefore has to be fetched again, and the
 * fetch failed (offline, in practice).
 *
 * It must NOT read as a generic download failure, which is what it fell into
 * before: "Couldn't download the tan CLI … retry when you're back online, or
 * point alpSdk.cliPath at a local build" describes a machine with no CLI at
 * all, tells the customer nothing about why the working copy they already have
 * stopped being used, and offers `alpSdk.cliPath` — the one resolution source
 * that is never verified.
 *
 * Front-loaded on purpose: VS Code clips a toast to about two lines, so the
 * fact leads and the remedy follows (same constraint `aheadCliMessage` in
 * `vscodeAdapter.ts` documents). No path, no URL, no errno — `planFailure`
 * demotes a `cause` carrying any of those into the output channel and replaces
 * the toast with a generic "<operation> failed.".
 */
export const CACHED_CLI_UNVERIFIED =
  "This extension's copy of the tan CLI was downloaded before downloads were " +
  "checked against the checksum Alp Lab publishes, so nothing can vouch for " +
  "it and it will not be run. Downloading it once more settles this for good " +
  "— reconnect and retry.";

/**
 * `CACHED_CLI_UNVERIFIED` for the machine that ALSO has a global `tan` — the
 * residual offline window of #396. The un-digested cache is skipped by
 * `decideBinarySource`, so the ladder has ALREADY fallen through to the `path`
 * rung and commands are running that binary right now. "It will not be run" is
 * true and useless there; the customer's question is what IS being run, and the
 * honest answer is a binary nothing here verified.
 *
 * Reached ONLY by a heal that failed while a prebuilt for this host exists —
 * offline, in practice — which is what makes "reconnect and retry" true here.
 * An online machine on a published target re-acquires the cache before this can
 * matter; a host with no published prebuilt gets the pair below instead,
 * because on that host reconnecting settles nothing, ever.
 *
 * Same shape rules as the sentence above: the fact leads (VS Code clips a toast
 * to about two lines), no path/URL/errno (`planFailure` demotes a `cause`
 * carrying any of those into the output channel), and no mention of
 * `alpSdk.cliPath` — pointing at a hand-placed binary is the bypass this
 * refusal exists to prevent, and here a verified binary really is one
 * reconnection away.
 */
export const CACHED_CLI_UNVERIFIED_ON_PATH =
  "This extension's copy of the tan CLI predates the checksum check, so it " +
  "will not be run — commands are falling back to the tan on your PATH, which " +
  "nothing here verified. Reconnect and retry to settle this for good.";

/**
 * The two sentences above, for the host tan-cli publishes NO binary for
 * (`releaseAssetForTarget` → null). Both of those end in "reconnect and retry",
 * and on this host that instruction is not merely unhelpful, it is FALSE: there
 * is nothing to fetch, ever, so reconnecting settles nothing and the same toast
 * returns on every activation for good.
 *
 * These NAME `alpSdk.cliPath`, which the two above deliberately withhold, and
 * that is a decision rather than an oversight. The suppression is #389's:
 * offering `cliPath` as the escape from a CHECKSUM REFUSAL routes the user off
 * a verified binary they could have had and onto one nothing checks. The reason
 * does not survive the trip to this host — no verified binary is obtainable
 * here at all, so `cliPath` is not an escape from verification, it is the only
 * way to have a `tan`. It is also already the remedy `downloadCli` names when
 * it throws for this same missing asset. Withholding it would leave a permanent
 * notice with no remedy in it, pointing at a Retry that cannot work.
 */
export const CACHED_CLI_UNVERIFIED_NO_PREBUILT =
  "This extension's copy of the tan CLI predates the checksum check, so it " +
  "will not be run, and Alp Lab publishes no tan build for this OS and CPU to " +
  "replace it with. Point alpSdk.cliPath at a tan you build yourself.";

/**
 * `CACHED_CLI_UNVERIFIED_NO_PREBUILT` for the machine that ALSO has a global
 * `tan`: same permanence, plus the fall-through named as in
 * `CACHED_CLI_UNVERIFIED_ON_PATH`, because commands are running that binary
 * right now and "it will not be run" answers the wrong question.
 */
export const CACHED_CLI_UNVERIFIED_NO_PREBUILT_ON_PATH =
  "This extension's copy of the tan CLI predates the checksum check, so it " +
  "will not be run — commands are falling back to the tan on your PATH, which " +
  "nothing here verified. Alp Lab publishes no tan build for this OS and CPU, " +
  "so point alpSdk.cliPath at a tan you build yourself.";

/**
 * Which of the four un-digested-cache sentences a machine gets, or `undefined`
 * when its cache is not in that state at all — every other refusal then keeps
 * its own wording.
 *
 * One rule rather than a condition per call site, because the four are chosen
 * on two INDEPENDENT axes and picking three by hand is how the fourth goes
 * wrong: the no-prebuilt host was handed the "reconnect and retry" pair, which
 * instructs it to do the one thing that cannot work there.
 *
 *  - IS THE LADDER RUNNING THE PATH BINARY RIGHT NOW? `decideBinarySource` has
 *    already stepped over the cache, so a resolved `path` means commands are on
 *    a binary nothing verified and the sentence has to say so. Rung 2 — the
 *    `preferGlobalCli` opt-in — is excluded: that user chose their global `tan`,
 *    and telling them their own choice is suspicious is not this heal's
 *    business. Activation never asks about them at all (`shouldFetchManagedCli`
 *    leaves rung 2 alone entirely), but `updateAlpCli` does when such a user
 *    runs the palette command themselves — and they get the plain sentence,
 *    which describes the extension's own cache and nothing about their binary.
 *  - CAN A HEAL EVER RUN? `prebuiltAvailable` is `releaseAssetForTarget` being
 *    non-null, and false turns "reconnect and retry" from unhelpful into false.
 */
export function unverifiedCacheCause(
  input: BinaryResolutionInput,
  prebuiltAvailable: boolean,
): string | undefined {
  if (!isUnverifiableCache(input)) return undefined;
  const onPathFallback = isUnverifiedPathFallback(input);
  if (prebuiltAvailable) {
    return onPathFallback
      ? CACHED_CLI_UNVERIFIED_ON_PATH
      : CACHED_CLI_UNVERIFIED;
  }
  return onPathFallback
    ? CACHED_CLI_UNVERIFIED_NO_PREBUILT_ON_PATH
    : CACHED_CLI_UNVERIFIED_NO_PREBUILT;
}

/**
 * The sentence for a cached binary that no longer hashes to the digest recorded
 * when it was downloaded. REFUSES the spawn; see `resolveAlpBinary`'s `cached`
 * arm for why this is not a warning.
 *
 * Points at the palette command that fixes it (`alp.updateCli`, published as
 * "Alp: Reinstall the pinned tan CLI") because that is the remedy that goes
 * through the verified download path. It deliberately does NOT mention
 * `alpSdk.cliPath`: pointing at a hand-placed binary is exactly the bypass this
 * refusal exists to prevent, and #389 had to remove that same button from the
 * download refusal for the same reason.
 *
 * @quotes package.json "Alp: Reinstall the pinned tan CLI"
 *
 * The word "checksum" is load-bearing in both of these, not decoration:
 * `classifyUnavailable` below matches it to reach `checksumRefused`. That is a
 * backstop — `unavailableOutcome` (`vscodeAdapter.ts`) classifies a
 * `ChecksumError` by TYPE — but the two must not be allowed to disagree.
 */
export const CACHED_CLI_MISMATCH =
  "The tan CLI installed for this extension no longer matches the checksum " +
  "that was verified when it was downloaded, so it was not run. Something " +
  "replaced or corrupted the file — reinstall the pinned tan CLI from the " +
  "command palette, and do not work around this check.";

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
 * Extract the version from `tan --version` stdout — `MAJOR.MINOR.PATCH` plus a
 * SemVer pre-release suffix when the binary carries one (`tan 0.4.0-rc.1` →
 * `"0.4.0-rc.1"`) — or `null` when the output is not the native CLI's version
 * line.
 *
 * The suffix is KEPT, not discarded. Dropping it parsed `tan 0.4.0-rc.1` to
 * `"0.4.0"`, so a release candidate compared EQUAL to the finished release and
 * every skew check went silent on a binary that predates it. Build metadata
 * after a space (a future `tan 0.4.0 (abc1234)`) is still ignored — it carries
 * no SemVer precedence.
 */
export function parseTanVersion(stdout: string): string | null {
  const firstLine = stdout.trim().split(/\r?\n/, 1)[0] ?? "";
  const match = /^tan (\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?/.exec(firstLine);
  return match ? `${match[1]}.${match[2]}.${match[3]}${match[4] ?? ""}` : null;
}

/**
 * How the INSTALLED `tan` relates to the version this extension build pins.
 * `ahead-minor` covers a newer MAJOR too — the distinction that matters is
 * "patch (contract can't have moved)" vs "minor/major (it can)", not the
 * position of the digit.
 */
export type CliSkew =
  | "behind"
  | "same"
  | "ahead-patch"
  | "ahead-minor"
  | "unknown";

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parseVersion(
  version: string | null | undefined,
): { nums: number[]; pre: string | null } | null {
  const m = version ? VERSION_RE.exec(version.trim()) : null;
  return m
    ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null }
    : null;
}

/**
 * Compare the installed tan against the pinned `supported` version — the ONE
 * comparison every version-skew decision in this repo routes through (tuple
 * compare over numeric `MAJOR.MINOR.PATCH` + SemVer pre-release rule, no semver
 * dep). An unparseable/`null` version on either side is `"unknown"`, which every
 * caller treats as "stay quiet": a probe hiccup must never nag the user.
 *
 * A pre-release is strictly OLDER than the same `MAJOR.MINOR.PATCH` without one
 * (`0.4.0-rc.1` < `0.4.0`), per SemVer §11 — that is the rule that stops an rc
 * from passing as the finished release.
 */
export function cliSkew(
  installed: string | null,
  supported: string = SUPPORTED_CLI_VERSION,
): CliSkew {
  const a = parseVersion(installed);
  const b = parseVersion(supported);
  if (!a || !b) return "unknown";
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] < b.nums[i]) return "behind";
    // i 0/1 = MAJOR/MINOR (the axis that can move the envelope contract),
    // i 2 = PATCH (it can't).
    if (a.nums[i] > b.nums[i]) return i < 2 ? "ahead-minor" : "ahead-patch";
  }
  if (a.pre === b.pre) return "same";
  if (a.pre && !b.pre) return "behind";
  // `!a.pre || !b.pre` rather than `!a.pre && b.pre`: the two are equivalent
  // here (the previous line already returned for `a.pre && !b.pre`), but this
  // form narrows BOTH to `string` for the comparison below — the other does
  // not, and TS18047 rejects it.
  if (!a.pre || !b.pre) return "ahead-patch";
  // ponytail: two DIFFERENT pre-releases on the same tuple compare as plain
  // strings (so `rc.10` sorts before `rc.9`). Nothing pins a pre-release as
  // SUPPORTED_CLI_VERSION, so this only picks between two silent branches;
  // upgrade to identifier-wise SemVer compare if a pin ever carries a suffix.
  return a.pre < b.pre ? "behind" : "ahead-patch";
}

/**
 * True when the `installed` version is strictly older than `supported`.
 * Thin reading of `cliSkew` so there is exactly one comparison in the repo.
 */
export function isCliBehind(
  installed: string | null,
  supported: string = SUPPORTED_CLI_VERSION,
): boolean {
  return cliSkew(installed, supported) === "behind";
}

/**
 * Whether activation should (re)fetch the managed `tan` binary. Three triggers,
 * one per resolved source that can want one:
 *
 *  - `download` — nothing resolves yet. A fresh install, which would download
 *    on first use anyway.
 *  - `path` — but ONLY the UNCHOSEN fallback (rung 6, i.e. `!preferGlobalCli`),
 *    and only when an un-digested copy sits in the cache
 *    (`isUnverifiableCache`): the #386 migration population, on a machine that
 *    also has a global `tan`. `decideBinarySource` SKIPS an un-digested copy,
 *    so the ladder has already stepped over it onto a binary nothing verified —
 *    a refusal falling through onto an unverified arm, the zero-click form of
 *    the one-click bypass #389 removed. This is the #396 trigger, and the old
 *    `source === "cached"` could never fire it: the source is never `cached` for
 *    exactly the machines the heal was written for.
 *  - `cached` — the managed copy is behind the pinned `supported`: the
 *    stale-install self-heal (the "tan shows an old version and never updates"
 *    symptom).
 *
 * THE #396 TRIGGER IS NARROW ON PURPOSE — never a user/build-owned source, and
 * `alpSdk.preferGlobalCli` makes rung 2 exactly that. Firing on whatever
 * resolved would hand a `cliPath` user, a `localBuild` developer and a
 * platform-VSIX `bundled` install one "this extension's copy … will not be run"
 * plan on EVERY activation (and, online, a ~3 MB download they never asked for)
 * while their commands run fine on a binary they chose. It buys nothing: the
 * heal fires when the un-digested cache would otherwise be silently STEPPED
 * OVER, and a user running their own binary is left alone until they stop —
 * clear `cliPath`, delete the local build, install the universal VSIX, and the
 * ladder reaches the `path` FALLBACK or `download` and heals then.
 *
 * RUNG 2 IS IN THAT SAME CLASS, and gets the same treatment for the same
 * argument. `preferGlobalCli` is an explicit user choice, and healing under it
 * changes nothing about what runs: resolution still answers `path` afterwards,
 * so online the heal is a silent ~3 MB fetch of dead weight, and offline it is
 * a per-activation error toast telling that user the extension's copy "will not
 * be run" — about a copy they opted out of running. Their cache heals the
 * moment they stop insisting, exactly like the other three. Withholding only
 * the notice, and fetching anyway, stopped one rung short of the rule this
 * function already states.
 *
 * Where it does fire, replacing the cache is safe because it replaces the
 * EXTENSION'S OWN STORAGE, so it overrides nobody's choice, and the ladder's
 * precedence is untouched: once the digest is recorded, `cached` outranks the
 * `path` FALLBACK again and the effective source snaps back with no reordering
 * ever made.
 *
 * `cachedVersion` is the parsed cached-binary version (null when
 * unknown/unprobed → not behind).
 */
export function shouldFetchManagedCli(
  // The whole input, not a `BinarySource`: the `path` arm has to ask whether
  // the copy the ladder just stepped over is un-digested, and that is
  // unanswerable from the resolved source.
  input: BinaryResolutionInput,
  cachedVersion: string | null,
  supported: string = SUPPORTED_CLI_VERSION,
): boolean {
  const source = decideBinarySource(input);
  if (source === "download") return true;
  // The UNCHOSEN fallback only. `source === "path"` with `preferGlobalCli` set
  // is ladder rung 2 — a user/build-owned source by the rule above — and
  // `decideBinarySource` reaches rung 2 only with the flag on, so this one
  // negation separates the two rungs exactly.
  if (source === "path") {
    return isUnverifiableCache(input) && !input.preferGlobalCli;
  }
  if (source === "cached") return isCliBehind(cachedVersion, supported);
  return false;
}

/**
 * The ONE sentence for the rung-6 PATH fallback (#393). INFORMATIONAL — nothing
 * failed, nothing is broken, and the customer's setup keeps working, which is
 * why the call site plans it at severity `info` and why it names no error.
 *
 * It says only what is true. `commandOnPath`'s `isNativeTanVersionOutput` is a
 * FORMAT PROBE on the stdout of a binary about to be run, so nothing here may
 * suggest that binary's identity or integrity was established — only that this
 * extension did not check it. "Whichever one your shell resolves" is the honest
 * description: PATH order, not a choice this extension made.
 *
 * Same shape rules as the four cache sentences above: the fact leads (VS Code
 * clips a toast to about two lines) and no path, URL or errno — `planFailure`
 * demotes a `cause` carrying any of those into the output channel and replaces
 * the toast with a bare "<operation> failed.", which here would be a lie as
 * well as a loss.
 *
 * `alpSdk.cliPath` is NOT named, for the reason #389 established: that arm is
 * never verified either, so pointing at it as the response to "this one is not
 * verified" moves the customer sideways. The action offered instead is the
 * managed download, which really does end this state — with `preferGlobalCli`
 * off, a digested `cached` copy outranks the rung-6 fallback.
 */
export const UNVERIFIED_PATH_IN_USE =
  "Alp is running the tan CLI from your PATH — whichever one your shell " +
  "resolves, which nothing here verified. Nothing is wrong; the copy this " +
  "extension manages is the one it checks.";

/**
 * Whether this activation should say the sentence above — that the `tan` being
 * run is the one the shell resolves and is not one this extension verified.
 *
 * Three clauses, one per way the notice would otherwise be wrong:
 *
 *  - RUNG 6 ONLY (`isUnverifiedPathFallback`). `alpSdk.preferGlobalCli` must
 *    keep winning SILENTLY: that user chose their global `tan`, and a standing
 *    note about the binary they opted into is noise they cannot act on without
 *    reversing their own decision. This is the trap #396 hit one rung earlier —
 *    there the `!preferGlobalCli` gate withheld the SENTENCE but not the FETCH,
 *    so an opted-in user still got a recurring error about a copy they had
 *    opted out of running, plus a ~3 MB download resolution then ignored. Same
 *    rung, so the same rule, checked in one place.
 *  - NOT THE MIGRATING MACHINE (`isUnverifiableCache`). That machine is #396's:
 *    activation re-acquires the stepped-over cache through the verified
 *    channel, so the PATH binary is not what it goes on running; and when the
 *    re-acquire fails, `CACHED_CLI_UNVERIFIED_ON_PATH` already says this same
 *    thing plus the fact that a verified copy is one reconnection away. Two
 *    notices about one situation, one of them about to be false, is worse than
 *    either alone. (With the flag off a DIGESTED cache outranks rung 6, so this
 *    clause narrows the notice to exactly "no managed copy at all" — the
 *    residual population, and the steady state for anyone with `tan` on PATH.)
 *  - ONCE PER INSTALL. `noticed` is persisted by the adapter, exactly like
 *    `shouldWarnCliAhead`'s `warnedForVersion`. There is no second state worth
 *    keying on — a `tan` on PATH is a steady state, not an event — so the
 *    record is a bare "this was said".
 *
 * NOT a refusal, and deliberately not a demotion. Demoting to a download breaks
 * an offline machine whose only `tan` is the global one, and displaces a
 * deliberate global install with a copy that buys that user nothing.
 * Verify-to-refuse cannot work either: a self-built or distro `tan` legitimately
 * will not match the pinned digest, so a mismatch there cannot mean refuse — and
 * a check that can never act on its own result is theatre. Saying it once, and
 * offering the managed copy to whoever wants it, is the whole remedy.
 */
export function shouldNoticeUnverifiedPath(
  input: BinaryResolutionInput,
  noticed: boolean,
): boolean {
  return (
    !noticed && isUnverifiedPathFallback(input) && !isUnverifiableCache(input)
  );
}

/**
 * Whether this activation should raise the "the installed tan is newer than
 * the version this extension was built against" warning.
 *
 * Only a MINOR/MAJOR bump qualifies (`cliSkew === "ahead-minor"`). A PATCH
 * bump is deliberately SILENT: it cannot move the envelope contract, and a
 * toast on every activation is precisely the nagging the notification seam
 * exists to prevent.
 *
 * Why MINOR is the breaking axis: tan is pre-1.0 and this extension matches on
 * EXACT issue-code strings that all FAIL OPEN — `bootstrap.windows-unsupported`,
 * `bootstrap.yocto-host`, the three `BOOTSTRAP_PREREQUISITE_CODES` (below) and
 * `presets.sdk-root-unresolved` (`ideHub/newProjectFlowPanel.ts`) — plus
 * unversioned `data.*` field names read with `?? []` fallbacks. A renamed code
 * or field produces no error and no log line, just a dead guard or an empty
 * catalogue, so the version number is the only warning the customer can get.
 *
 * `warnedForVersion` is the installed version a warning was already raised for
 * (persisted by the adapter), which makes this one-shot ACROSS activations, not
 * just per window. Keyed on the installed version, not on the pin: a further
 * upgrade (0.4.0 → 0.5.0) is news again, while a pin bump that closes the gap
 * lands on `same`/`behind` and says nothing.
 */
export function shouldWarnCliAhead(
  installed: string | null,
  warnedForVersion: string | undefined,
  supported: string = SUPPORTED_CLI_VERSION,
): boolean {
  return (
    cliSkew(installed, supported) === "ahead-minor" &&
    warnedForVersion !== installed
  );
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

/**
 * Deliberately checks FOUR of the seven top-level keys. `project` and `data`
 * are unchecked because a command may legitimately carry either as `null`, and
 * `sdk` because tan omits it entirely whenever no SDK resolved — see
 * `AlpSdkInfo` in models.ts. Requiring any of the three would turn a valid
 * envelope into `null`, which every caller reads as "tan produced no envelope"
 * and falls back on silently.
 */
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

/**
 * Classify the raw failure text produced one layer down (the resolver's
 * throws, a spawn error, the download seam) into the reason the notification
 * planner branches on. Pure so the mapping is unit-testable and lives in ONE
 * place instead of being re-sniffed at every surface.
 *
 * ponytail: string-sniffs messages this repo constructs itself
 * (`adapterCore.ts`'s resolver throws, `spawnAlpAsync`'s timeout/cap errors,
 * Node's errno text). Upgrade path if it gets fragile: typed error classes in
 * `adapterCore.ts` / `download.ts` — one pure function plus its test today.
 */
export function classifyUnavailable(raw: string): CliUnavailableReason {
  if (/^No prebuilt tan CLI/.test(raw)) return "noPrebuilt";
  if (/did not produce a binary|Downloaded 0 bytes/.test(raw)) return "corrupt";
  // Every `ChecksumError` sentence (`download.ts`) says "checksum". Matched
  // AHEAD of both `corrupt` and `downloadFailed`, and mapped to neither:
  // `downloadFailed` offers "retry when you're back online" for bytes that were
  // served fine and simply weren't the published ones, and `corrupt` claims an
  // installed copy is broken when nothing was installed — then hands the
  // customer `alpSdk.cliPath`, the ONE resolution source with no checksum path
  // at all. See `checksumRefused` in `models.ts`.
  if (/checksum/i.test(raw)) return "checksumRefused";
  if (
    /Download failed|Timed out downloading|Too many redirects|ENOTFOUND|ECONNRESET|ECONNREFUSED|getaddrinfo/.test(
      raw,
    )
  ) {
    return "downloadFailed";
  }
  if (/timed out after/.test(raw)) return "timeout";
  if (/\bENOENT\b/.test(raw)) return "notInstalled";
  if (/\bEACCES\b|\bEPERM\b/.test(raw)) return "corrupt";
  return "spawnFailed";
}

/**
 * One-line summary of an envelope for the output channel and for callers that
 * still read `CliOutcome.message` directly.
 *
 * Reports the first issue PLUS how many more there are: the previous version
 * returned `issues[0].message` alone, so on a multi-issue envelope every issue
 * after the first was invisible at every surface. The full array stays on
 * `envelope.issues` — `src/notify/service.ts` copies it onto the plan and
 * attaches a "Show All Issues" action, which is what actually makes them
 * reachable; this count is the honest hint that there is more to see.
 */
function summarize(kind: CliExitKind, envelope: AlpEnvelope | null): string {
  const issues = envelope?.issues ?? [];
  const firstIssue = issues[0]?.message;
  if (firstIssue) {
    const more = issues.length - 1;
    return more > 0 ? `${firstIssue} (+${more} more)` : firstIssue;
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
 *  Unix, `tan-<triple>.exe` on Windows; the release tag is `v<version>`.
 *  `checksumsUrl` is the same release's `checksums.txt`, which every tagged tan
 *  release publishes next to the binaries — resolved HERE, from the same `tag`,
 *  so the digest a download is checked against always belongs to the release the
 *  bytes came from. The asset names are contract-frozen on the producer side
 *  (tan-cli's `release.yml` names this function), which is what makes the
 *  filename lookup in that file reliable. */
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
  const releaseBase = `https://github.com/${RELEASE_REPO}/releases/download/${tag}`;
  return {
    target,
    assetName,
    tag,
    url: `${releaseBase}/${assetName}`,
    checksumsUrl: `${releaseBase}/${CHECKSUMS_ASSET}`,
  };
}

/**
 * The sha256 `checksums.txt` publishes for `assetName`, lowercased, or null when
 * the file carries no line for that exact name.
 *
 * The file is `sha256sum` output — `<64 hex><two spaces><filename>` per line,
 * LF-terminated (confirmed byte-for-byte against the published v0.4.0 file).
 * Parsed tolerantly around that: any run of whitespace as the separator, CRLF
 * accepted, and the `*` binary-mode marker `sha256sum -b` writes before the
 * filename stripped — none of which weakens the check, because the DIGEST is
 * still matched exactly and the filename still has to be exactly `assetName`.
 *
 * Filename matching is case-SENSITIVE on purpose: the release assets are
 * lowercase rust triples and a case-folded match could pair a digest with a
 * different asset on a release that ever published two names differing only in
 * case. Returning null (no line) is a REFUSAL at the caller, not a pass — see
 * `ChecksumError` in `download.ts`.
 */
export function expectedSha256(
  checksums: string,
  assetName: string,
): string | null {
  for (const line of checksums.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (match && match[2] === assetName) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

/** The on-disk binary filename for a platform. */
export function binaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "tan.exe" : "tan";
}

/** The variables `tan` consults for an `https://` request, in ITS precedence
 *  order (`tan_core::select_https_proxy`). `HTTP_PROXY` is deliberately absent
 *  from tan's https list — it, git, curl and pip all read that one as
 *  http-only. */
const HTTPS_PROXY_ENV_VARS = [
  "ALL_PROXY",
  "all_proxy",
  "HTTPS_PROXY",
  "https_proxy",
] as const;

/** The variables the subprocesses `tan` itself spawns (`git clone`, `pip`,
 *  `west update`) consult for a plain-`http://` request. */
const HTTP_PROXY_ENV_VARS = [
  "ALL_PROXY",
  "all_proxy",
  "HTTP_PROXY",
  "http_proxy",
] as const;

/**
 * The proxy environment variables to ADD when spawning `tan`, given VS Code's
 * `http.proxy` and the environment the extension host inherited. Returns `{}`
 * when there is nothing to add.
 *
 * `tan` takes no `--proxy` flag: it reads the environment (see tan-cli
 * `crates/tan-cli/src/http.rs`), so handing VS Code's setting to the child is
 * the whole mechanism. Both variables are set because they reach different
 * things — `HTTPS_PROXY` is what tan's own in-process GitHub call honours, and
 * `HTTP_PROXY` is for the `git`/`pip`/`west` subprocesses tan spawns, which
 * inherit this environment and would otherwise have no http-side proxy at all.
 *
 * ── PRECEDENCE: AN ALREADY-SET ENVIRONMENT VARIABLE WINS OVER THE IDE SETTING ──
 * A variable exported in the shell VS Code was launched from is left exactly as
 * it is; the setting only FILLS A GAP. Two reasons, and the second is the one
 * that makes the other order unimplementable rather than merely unfriendly:
 *
 *  1. The shell export is the machine's own answer and is shared with every
 *     other tool the user runs; a stale `http.proxy` silently overriding it
 *     would break a box that worked, for a setting the user may not remember.
 *  2. The child picks its own proxy, and `ALL_PROXY` beats `HTTPS_PROXY` in
 *     tan's order. "The setting always wins" would therefore require also
 *     overwriting the user's `ALL_PROXY` — deleting a deliberate machine-wide
 *     configuration to impose an IDE one. Filling gaps is the only rule that
 *     stays consistent with how the child actually chooses.
 *
 * This is the OPPOSITE order from `proxyForUrl` in `download.ts`, on purpose:
 * that path picks the proxy ITSELF for an in-process request, so "setting wins"
 * there is both implementable and what VS Code's own `http.proxy` documents.
 * Here the child picks, and we can only seed it.
 *
 * Presence, not truthiness, is what counts as "the user set it": exporting
 * `HTTPS_PROXY=` is the conventional way to DISABLE an inherited proxy, and tan
 * reads an empty value as unset — so an empty export means "go direct", and
 * filling it from the setting would override exactly the wish it expresses.
 *
 * `NO_PROXY` / `no_proxy` are never written here. VS Code has no setting for a
 * bypass list, so the environment is its only source and it must pass through
 * untouched — a caller that spreads this over `process.env` carries it along.
 */
export function proxyEnvOverrides(
  proxy: string,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const setting = proxy.trim();
  if (!setting) {
    return {};
  }
  const overrides: Record<string, string> = {};
  // NOTE on Windows: `process.env` is case-insensitive, so `"https_proxy" in
  // env` is already true when `HTTPS_PROXY` is set. That only makes this
  // check MORE conservative there, which is the safe direction.
  if (!HTTPS_PROXY_ENV_VARS.some((name) => name in env)) {
    overrides.HTTPS_PROXY = setting;
  }
  if (!HTTP_PROXY_ENV_VARS.some((name) => name in env)) {
    overrides.HTTP_PROXY = setting;
  }
  return overrides;
}

/**
 * Verdict from a `tan bootstrap --no-pip --no-west --format json` pre-flight
 * call: whether `src/bootstrap.ts` must refuse to spawn the real bootstrap
 * terminal on this host, and the reason to show the user.
 *
 * tan resolves each core's runtime from the SoM topology in the SDK metadata
 * (`som.sku` -> `<sdkRoot>/metadata/e1m_modules/<sku>.yaml` `topology:`) —
 * `board.yaml` alone does not carry that (a per-core `os:` there is only an
 * OVERRIDE, mostly used as `os: "off"`), so re-deriving this verdict from a
 * parsed `board.yaml` here would miss every real Yocto-only project. This
 * reads tan's own answer instead of re-guessing it (`crates/tan-core/src/
 * bootstrap/runtime.rs`'s `yocto_gate`, single-sourced in tan-cli).
 *
 * `--no-pip --no-west` makes the call side-effect-free while running the
 * IDENTICAL gate a real `tan bootstrap` invocation would hit: tan-cli's
 * `bootstrap/mod.rs` never creates the venv when both flags are set, and the
 * gate itself runs (and can return before) any prerequisite check.
 *
 * Two DISTINCT refusal shapes, both from real tan-cli releases:
 *
 * - `bootstrap.yocto-host` at severity `error` (current tan, `>= v0.3.1`,
 *   `YoctoGate::Refuse`, exit 2): every core in the project targets Yocto,
 *   which is Linux-only. tan's own message already explains this and is used
 *   verbatim. The SAME code at severity `warning` (`YoctoGate::Warn`, `ok:
 *   true`, exit 0) is a MIXED board — it can still bootstrap its non-Yocto
 *   core(s) here, so that shape must NOT be treated as a refusal.
 * - `bootstrap.windows-unsupported` at severity `error` (an OLD tan, `v0.3.0`
 *   and earlier — see tan-cli's now-retired `commands/bootstrap.rs`): that
 *   release refuses ALL bootstrapping on native Windows, full stop, because
 *   it still shells the SDK's POSIX `bootstrap.sh`. Anyone pinned to that old
 *   binary via `alpSdk.cliPath` needs this branch forever, not just until
 *   they upgrade — so this is a permanent compatibility case, not
 *   transitional scaffolding. tan's own message there doesn't mention
 *   updating tan, so a clearer message is used here instead.
 *
 * A `null` envelope (the pre-flight call itself failed/couldn't resolve/
 * wasn't JSON) is never a refusal either — never block a working setup on a
 * failed probe.
 */
export function bootstrapHostVerdict(
  envelope: AlpEnvelope | null,
): { refuse: false } | { refuse: true; message: string } {
  const issues = envelope?.issues ?? [];

  const tooOld = issues.find(
    (issue) =>
      issue.code === "bootstrap.windows-unsupported" &&
      issue.severity === "error",
  );
  if (tooOld) {
    return {
      refuse: true,
      message:
        "This tan CLI is too old to bootstrap on Windows. Update tan " +
        "(native Windows bootstrap shipped in tan-cli v0.3.1), or reopen " +
        "this project in WSL to bootstrap there now.",
    };
  }

  const yoctoOnly = issues.find(
    (issue) =>
      issue.code === "bootstrap.yocto-host" && issue.severity === "error",
  );
  return yoctoOnly
    ? { refuse: true, message: yoctoOnly.message }
    : { refuse: false };
}

/**
 * Every code tan raises when its own prerequisite pre-flight refuses to
 * bootstrap (tan-core `bootstrap/prerequisites.rs`). All three are the same
 * verdict to a consumer: tan already decided, and re-running would reproduce
 * it verbatim.
 *
 * The two python codes are NOT redundant with the first. tan's source is
 * explicit that they carry NO missing-tool list at all — a consumer keying
 * only on `prerequisites-missing` "would get an empty array against a fully
 * actionable message", which is precisely what happened here: both fell
 * through the win32 pre-flight, the real bootstrap was spawned anyway, and the
 * customer watched the identical refusal a second time with tan's guidance
 * lost in the terminal.
 *
 * The pinned CLI (`SUPPORTED_CLI_VERSION`) emits only the first — the other
 * two landed in tan after that tag. Matching a code the pinned binary never
 * emits costs nothing and lands the fix BEFORE the pin bump instead of after.
 */
const BOOTSTRAP_PREREQUISITE_CODES: ReadonlySet<string> = new Set([
  "bootstrap.prerequisites-missing",
  "bootstrap.python-not-runnable",
  "bootstrap.python-too-old",
]);

/**
 * The pre-flight envelope's prerequisite-refusal issue, if tan explicitly
 * refused because a required tool (ninja/cmake/west/…) isn't on PATH, or
 * because the python it found cannot run or is too old — an EXPLICIT, PARSED
 * verdict distinct from `bootstrapHostVerdict`'s host-level refusals (those
 * want a WSL reopen; this wants an install action). Spawning the real
 * bootstrap terminal after one of these is present just repeats the exact
 * failure tan already reported.
 *
 * Deliberately narrow, mirroring `bootstrapHostVerdict`: only an issue whose
 * code is one of `BOOTSTRAP_PREREQUISITE_CODES` AND whose severity is
 * `"error"` counts. A probe that could not run, could not resolve a binary,
 * timed out, or returned an envelope with no such issue is NOT a verdict — it
 * is `null` here, and callers must let it fall through to the real run (never
 * block a working setup on a failed probe). Conflating "no verdict" with
 * "refuse" would re-break every working host on a flaky/failed probe.
 */
export function prerequisitesMissingIssue(
  envelope: AlpEnvelope | null,
): AlpIssue | null {
  const issues = envelope?.issues ?? [];
  return (
    issues.find(
      (issue) =>
        BOOTSTRAP_PREREQUISITE_CODES.has(issue.code) &&
        issue.severity === "error",
    ) ?? null
  );
}

/** The `debug-config` envelope fields the extension consumes.
 *
 *  `configuration` is the launch configuration itself, added in tan-cli#67 —
 *  before that the envelope described the write without carrying the object.
 *  An older `tan` therefore returns `ok:true` with no `configuration` at all,
 *  which is why this is a shape check and not an `ok` check.
 */
export interface DebugConfigData {
  launchJsonPath: string;
  replaced: boolean;
  notes: string[];
  configuration: { name: string } & Record<string, unknown>;
}

/**
 * Whether an envelope `data` really carries a usable launch configuration.
 *
 * `name` is asserted as a NON-EMPTY string, not merely present: it is the one
 * field the caller actually consumes, and an empty one silently degrades —
 * `requiredDebugExtension("")` matches no target pattern and prompts for the
 * wrong adapter, then `startDebugging(folder, "")` fails with `VS Code
 * declined to start ""`. Every `notes` element is checked too, since they are
 * logged verbatim and a non-string prints as `[object Object]`.
 */
export function isDebugConfigData(value: unknown): value is DebugConfigData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  if (typeof data.launchJsonPath !== "string") return false;
  if (typeof data.replaced !== "boolean") return false;
  if (
    !Array.isArray(data.notes) ||
    !data.notes.every((note) => typeof note === "string")
  ) {
    return false;
  }
  const configuration = data.configuration;
  if (typeof configuration !== "object" || configuration === null) return false;
  const name = (configuration as Record<string, unknown>).name;
  return typeof name === "string" && name.length > 0;
}

/**
 * Every unresolved `<…>` placeholder left in a launch configuration, if any.
 *
 * `tan debug-config` resolves what the build recorded and leaves a placeholder
 * for what it could not — a board that registers no OpenOCD runner still ships
 * `configFiles: ["<resolved-openocd-board-cfg>"]`. It reports `ok` either way,
 * by design, because a draft is still worth writing before the first build. So
 * "the command succeeded" does NOT mean "this configuration can launch", and
 * the caller must look at the object rather than the exit code — otherwise the
 * user is told the profile is ready and the session dies inside the adapter.
 *
 * THE TEST IS ANY `<…>` TOKEN, NOT a `<resolved-` prefix. `${…}` is VS Code's
 * own variable substitution (`${workspaceFolder}`): VS Code expands it at
 * launch, it carries no angle bracket, and it is resolved as far as this
 * extension is concerned. `<…>` is ours and nothing expands it — handed to a
 * debug adapter verbatim it is a literal device name, path or TCP address. The
 * prefix test this replaced did not see `<host>:<port>`, which EVERY
 * `yocto-userspace` draft carries, so a Yocto profile reported launchable with
 * a gdbserver address no adapter can dial. tan closed the same hole on its own
 * side in v0.4.0 and its predicate names this regex as its twin
 * (`is_unresolved_placeholder`, crates/tan-core/src/debug_launch.rs:
 * "Equivalent to the TS `/<[^<>]*>/`").
 *
 * This is the repo's ONE unresolved-value predicate. The orphan rescue in
 * `src/debug/service.ts` decides "concrete or placeholder" by calling it
 * rather than re-typing the rule, because three divergent copies of exactly
 * this test is a defect this repo has already shipped once and removed.
 *
 * EACH FINDING CARRIES ITS KEY, because it is the only thing that can name it.
 * `foldLaunchConfigPlaceholders` turns each into a preflight check named after
 * the key, and the toast is built from failing check names — so a customer is
 * told to "resolve: device", the field cortex-debug will choke on, instead of
 * "resolve: launchConfig", the name of a check that is in nothing they own
 * (#339). `key` is the path from the configuration root (`device`,
 * `configFiles[0]`, `setupCommands[0].text`) and is `""` for a bare string
 * handed in with no surrounding object — the rescue's `isConcrete` does that
 * and reads the length only.
 */
export function launchConfigPlaceholders(
  value: unknown,
): { key: string; value: string }[] {
  const found: { key: string; value: string }[] = [];
  const walk = (node: unknown, key: string): void => {
    if (typeof node === "string") {
      if (/<[^<>]*>/.test(node)) found.push({ key, value: node });
    } else if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${key}[${index}]`));
    } else if (typeof node === "object" && node !== null) {
      for (const [name, item] of Object.entries(node)) {
        walk(item, key ? `${key}.${name}` : name);
      }
    }
  };
  walk(value, "");
  return found;
}
