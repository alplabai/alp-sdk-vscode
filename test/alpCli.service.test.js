// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  decideBinarySource,
  isNativeTanVersionOutput,
  parseTanVersion,
  isCliBehind,
  cliSkew,
  shouldWarnCliAhead,
  bootstrapHostVerdict,
  prerequisitesMissingIssue,
  aheadPathFixAction,
  classifyExitCode,
  parseEnvelope,
  classifyOutcome,
  releaseAssetForTarget,
  expectedSha256,
  classifyUnavailable,
  binaryName,
  shouldFetchManagedCli,
  shouldNoticeUnverifiedPath,
  isUnverifiedPathFallback,
  unverifiedCacheCause,
  UNVERIFIED_PATH_IN_USE,
  CACHED_CLI_UNVERIFIED,
  CACHED_CLI_UNVERIFIED_ON_PATH,
  CACHED_CLI_UNVERIFIED_NO_PREBUILT,
  CACHED_CLI_UNVERIFIED_NO_PREBUILT_ON_PATH,
  SUPPORTED_CLI_VERSION,
  isDebugConfigData,
  launchConfigPlaceholders,
} = require("../out/alpCli/service.js");
const { resolutionInputFromDeps } = require("../out/alpCli/adapterCore.js");

/** The adapter source, whitespace-normalised. Two gates below are single
 *  expressions in the adapter (which imports `vscode`, so it can't be loaded
 *  here); reading the source is how they stay pinned. */
const adapterSource = fs
  .readFileSync(
    path.join(__dirname, "..", "src", "alpCli", "vscodeAdapter.ts"),
    "utf8",
  )
  .replace(/\s+/g, " ");

/** The normalised adapter source just after the `index`th `token`, so a gate
 *  can be pinned without pinning Prettier's exact line breaks. */
function sourceAfter(token, index = 1, length = 160) {
  const parts = adapterSource.split(token);
  assert.ok(
    parts.length > index,
    `src/alpCli/vscodeAdapter.ts must contain ${token} (occurrence ${index})`,
  );
  return parts[index].slice(0, length);
}

test("parseTanVersion extracts MAJOR.MINOR.PATCH and tolerates a suffix", () => {
  assert.equal(parseTanVersion("tan 0.1.0"), "0.1.0");
  assert.equal(parseTanVersion("tan 0.1.0 (abc1234)\n"), "0.1.0");
  assert.equal(parseTanVersion("alp 0.1.14"), null); // the retired binary name
  assert.equal(parseTanVersion("tan, version 0.8.1"), null); // click-style output
  assert.equal(parseTanVersion(""), null);
});

test("parseTanVersion KEEPS a pre-release suffix, so an rc is not the final release", () => {
  // The defect this pins: the old regex discarded everything after PATCH, so
  // `tan 0.4.0-rc.1` parsed to "0.4.0" and compared EQUAL to the finished
  // 0.4.0 -- every skew check went silent on a binary that predates it. With
  // tan v0.4.0 being cut, an rc in the wild is a real shape.
  assert.equal(parseTanVersion("tan 0.4.0-rc.1"), "0.4.0-rc.1");
  assert.equal(parseTanVersion("tan 0.4.0-rc.1\r\n"), "0.4.0-rc.1");
  assert.equal(parseTanVersion("tan 1.0.0-alpha.2"), "1.0.0-alpha.2");
  // Build metadata after a space carries no SemVer precedence -- still dropped.
  assert.equal(parseTanVersion("tan 0.4.0 (abc1234)"), "0.4.0");

  // The consequence, end to end: the rc must read as OLDER than the release.
  assert.equal(isCliBehind(parseTanVersion("tan 0.4.0-rc.1"), "0.4.0"), true);
  assert.equal(isCliBehind(parseTanVersion("tan 0.4.0"), "0.4.0"), false);

  // ...while `isNativeTanVersionOutput` still accepts it: an rc IS the native
  // CLI, so it must not be demoted to "not on PATH".
  assert.equal(isNativeTanVersionOutput("tan 0.4.0-rc.1"), true);
});

/** A `BinaryResolutionInput` with every source absent, plus overrides. */
const resolutionInput = (over = {}) => ({
  cliPathSetting: "",
  cliPathExists: false,
  onPath: false,
  bundledExists: false,
  localBuildExists: false,
  cachedExists: false,
  cachedDigestRecorded: false,
  preferGlobalCli: false,
  ...over,
});

/** The inputs that resolve to each NON-download source, whatever the cache
 *  holds. `path` carries `preferGlobalCli` so it resolves via ladder rung 2
 *  (the explicit opt-in) even when a DIGESTED cache is present — the unchosen
 *  rung-6 fallback is exercised separately below, where it is the whole point. */
const OWNED_SOURCES = {
  cliPath: { cliPathSetting: "/x/tan", cliPathExists: true },
  bundled: { bundledExists: true },
  localBuild: { localBuildExists: true },
  path: { onPath: true, preferGlobalCli: true },
};

test("shouldFetchManagedCli fetches when nothing resolves, and self-heals a stale cache", () => {
  // Fresh install: nothing resolves yet → download.
  assert.equal(shouldFetchManagedCli(resolutionInput(), null), true);

  const digestedCache = { cachedExists: true, cachedDigestRecorded: true };
  const cached = resolutionInput(digestedCache);
  assert.equal(decideBinarySource(cached), "cached");
  // Managed cache behind the pin → self-heal (re-fetch the pin).
  assert.equal(shouldFetchManagedCli(cached, "0.1.0", "0.3.0"), true);
  // Managed cache at/ahead of the pin → leave it.
  assert.equal(shouldFetchManagedCli(cached, "0.3.0", "0.3.0"), false);
  assert.equal(shouldFetchManagedCli(cached, "0.4.0", "0.3.0"), false);
  // Cache present but version unprobed/unparseable → not behind, don't thrash.
  assert.equal(shouldFetchManagedCli(cached, null, "0.3.0"), false);

  // User/build-owned sources are NEVER auto-replaced, even when behind — and
  // the cache they sit above is digested, so there is nothing to heal either.
  for (const [source, over] of Object.entries(OWNED_SOURCES)) {
    const input = resolutionInput({ ...digestedCache, ...over });
    assert.equal(decideBinarySource(input), source);
    assert.equal(
      shouldFetchManagedCli(input, "0.1.0", "0.3.0"),
      false,
      `${source} must not auto-fetch`,
    );
  }
});

test("shouldFetchManagedCli heals an UN-DIGESTED cache the ladder steps OVER (#396)", () => {
  // The defect, stated as the pure decision it is: keying this on the RESOLVED
  // SOURCE cannot work, because `decideBinarySource` SKIPS an un-digested copy
  // — so the source is never `cached` on precisely the machines the heal is
  // for. A migrating machine with a global `tan` resolves `path` and runs a
  // binary nothing verified.
  //
  // Re-derive this from a `BinarySource` alone and the `path` rows below flip
  // to false — which IS the defect. (The `download` rows stay true either way:
  // that trigger never depended on the cache. They are here to pin the arm, not
  // to catch that regression.)
  const migrating = { cachedExists: true, cachedDigestRecorded: false };

  // The population the defect is actually about: rung 6, the UNCHOSEN `path`
  // fallback. No opt-in, no other managed copy — the skipped cache is what puts
  // the ladder here.
  const fallback = resolutionInput({ ...migrating, onPath: true });
  assert.equal(decideBinarySource(fallback), "path");
  assert.equal(shouldFetchManagedCli(fallback, null), true);

  // …and with nothing else on the machine it lands on `download` anyway.
  assert.equal(decideBinarySource(resolutionInput(migrating)), "download");
  assert.equal(shouldFetchManagedCli(resolutionInput(migrating), null), true);

  // NARROW ON PURPOSE. A user/build-owned source is not stepping over the
  // cache, so it is not told and not made to fetch — firing here gave each of
  // these one "this extension's copy … will not be run" plan per activation,
  // plus a ~3 MB download online, while their commands ran fine on a binary
  // they chose. Nothing is lost: clear the setting or delete the build and the
  // ladder reaches the `path` FALLBACK or `download`, where the rows above heal.
  //
  // Rung 2 (`preferGlobalCli`) is in that list, and the SAME argument put it
  // there: healing under the flag changes nothing about what runs — resolution
  // still answers `path` — so online it is a ~3 MB fetch of dead weight and
  // offline it is a per-activation toast about a copy the user opted out of
  // running. Withholding only the notice, and fetching anyway, stopped one rung
  // short of the rule this function states.
  for (const source of ["cliPath", "bundled", "localBuild", "path"]) {
    const input = resolutionInput({ ...migrating, ...OWNED_SOURCES[source] });
    assert.equal(decideBinarySource(input), source);
    assert.equal(
      shouldFetchManagedCli(input, null),
      false,
      `${source} must be left alone`,
    );
  }
  // …and the flag is what separates the two `path` rungs, nothing else: drop it
  // from that last row and it becomes the rung-6 fallback, which heals.
  assert.equal(
    shouldFetchManagedCli(
      resolutionInput({ ...migrating, onPath: true, preferGlobalCli: false }),
      null,
    ),
    true,
  );

  // Both halves of `isUnverifiableCache` are load-bearing, proven by breaking
  // each: no cache at all, and a cache that IS digested. Either one alone would
  // make the trigger fire for a fresh install / every verified machine forever.
  const pathOnly = resolutionInput({ onPath: true });
  assert.equal(decideBinarySource(pathOnly), "path");
  assert.equal(shouldFetchManagedCli(pathOnly, null), false);
  // `preferGlobalCli` so the ladder still answers `path` with a cache present —
  // without it a digested cache simply outranks the fallback and resolves
  // `cached`, which is a different arm and would not test this.
  const digested = resolutionInput({
    ...OWNED_SOURCES.path,
    cachedExists: true,
    cachedDigestRecorded: true,
  });
  assert.equal(decideBinarySource(digested), "path");
  assert.equal(shouldFetchManagedCli(digested, null), false);
});

test("unverifiedCacheCause picks the sentence on TWO axes, and never promises a retry that cannot work", () => {
  const migrating = { cachedExists: true, cachedDigestRecorded: false };

  // Axis 1 — is the ladder on the PATH binary right now? Only the UNCHOSEN
  // fallback names it. Rung 2 is the user's own opt-in and is left alone (and
  // never gets here: `shouldFetchManagedCli` does not heal it at all).
  const fallback = resolutionInput({ ...migrating, onPath: true });
  const optIn = resolutionInput({ ...migrating, ...OWNED_SOURCES.path });
  const alone = resolutionInput(migrating);
  assert.equal(decideBinarySource(fallback), "path");
  assert.equal(decideBinarySource(optIn), "path");
  assert.equal(decideBinarySource(alone), "download");
  assert.equal(
    unverifiedCacheCause(fallback, true),
    CACHED_CLI_UNVERIFIED_ON_PATH,
  );
  assert.equal(unverifiedCacheCause(optIn, true), CACHED_CLI_UNVERIFIED);
  assert.equal(unverifiedCacheCause(alone, true), CACHED_CLI_UNVERIFIED);

  // Axis 2 — can a heal EVER run here? `releaseAssetForTarget` null means no,
  // permanently, and that is what makes "reconnect and retry" false rather than
  // merely unhelpful. Both no-prebuilt sentences must therefore drop it and
  // name the one remedy this host has.
  assert.equal(
    unverifiedCacheCause(fallback, false),
    CACHED_CLI_UNVERIFIED_NO_PREBUILT_ON_PATH,
  );
  assert.equal(
    unverifiedCacheCause(alone, false),
    CACHED_CLI_UNVERIFIED_NO_PREBUILT,
  );
  for (const sentence of [
    CACHED_CLI_UNVERIFIED_NO_PREBUILT,
    CACHED_CLI_UNVERIFIED_NO_PREBUILT_ON_PATH,
  ]) {
    assert.doesNotMatch(sentence, /reconnect|retry/i);
    assert.match(sentence, /alpSdk\.cliPath/);
    // `classifyUnavailable` reaches `checksumRefused` by matching this word,
    // and must not be shadowed by its earlier `^No prebuilt tan CLI` row.
    assert.match(sentence, /checksum/);
    assert.equal(classifyUnavailable(sentence), "checksumRefused");
  }
  // …and the two that DO promise a retry keep it, because on a published target
  // a verified binary really is one reconnection away.
  for (const sentence of [
    CACHED_CLI_UNVERIFIED,
    CACHED_CLI_UNVERIFIED_ON_PATH,
  ]) {
    assert.match(sentence, /retry/i);
    assert.doesNotMatch(sentence, /alpSdk\.cliPath/);
  }

  // No un-digested cache → no sentence at all, on either axis, so every other
  // refusal keeps its own wording.
  for (const prebuilt of [true, false]) {
    assert.equal(unverifiedCacheCause(resolutionInput(), prebuilt), undefined);
    assert.equal(
      unverifiedCacheCause(
        resolutionInput({ cachedExists: true, cachedDigestRecorded: true }),
        prebuilt,
      ),
      undefined,
    );
  }
});

test("isUnverifiedPathFallback separates the two `path` rungs, and nothing else answers true", () => {
  // Rung 6: the fallback nobody chose. Nothing else resolved, `tan` is on PATH.
  assert.equal(
    isUnverifiedPathFallback(resolutionInput({ onPath: true })),
    true,
  );
  // Rung 2: the same resolved `BinarySource`, the opposite meaning. The flag is
  // the ONLY thing that tells them apart after resolution, which is why this
  // question has one name instead of a copy per consumer.
  assert.equal(
    isUnverifiedPathFallback(resolutionInput(OWNED_SOURCES.path)),
    false,
  );
  // Every other arm is not `path` at all.
  for (const [source, over] of Object.entries(OWNED_SOURCES)) {
    if (source === "path") continue;
    const input = resolutionInput({ ...over, onPath: true });
    assert.equal(decideBinarySource(input), source);
    assert.equal(isUnverifiedPathFallback(input), false, source);
  }
  for (const over of [
    {},
    { cachedExists: true, cachedDigestRecorded: true },
    { cachedExists: true, cachedDigestRecorded: false },
  ]) {
    const input = resolutionInput(over);
    assert.notEqual(decideBinarySource(input), "path");
    assert.equal(isUnverifiedPathFallback(input), false);
  }
});

test("shouldNoticeUnverifiedPath: the rung-6 fallback is told once; rung 2 and every other arm never (#393)", () => {
  // THE RESIDUAL POPULATION. A machine with a global `tan` and no managed copy
  // never acquires a verified binary — not a migration, the steady state for
  // anyone with `tan` on PATH. It keeps working; it is told what it is running.
  const fallback = resolutionInput({ onPath: true });
  assert.equal(decideBinarySource(fallback), "path");
  assert.equal(shouldNoticeUnverifiedPath(fallback, false), true);
  // ONCE. The state is permanent, so without the persisted flag this is a toast
  // on every activation forever.
  assert.equal(shouldNoticeUnverifiedPath(fallback, true), false);

  // RUNG 2 GETS NOTHING. `preferGlobalCli` is that user naming the binary they
  // want run; a standing note about their own choice is unactionable without
  // reversing it. #396 hit this exact rung by gating the sentence and not the
  // fetch — so the gate is on the rule, not on the wording.
  const optIn = resolutionInput(OWNED_SOURCES.path);
  assert.equal(decideBinarySource(optIn), "path");
  assert.equal(shouldNoticeUnverifiedPath(optIn, false), false);

  // NOT THE MIGRATING MACHINE (#396 owns it): the un-digested cache is about to
  // be re-acquired through the verified channel, and if that fails
  // CACHED_CLI_UNVERIFIED_ON_PATH already says this and more.
  const migrating = resolutionInput({
    onPath: true,
    cachedExists: true,
    cachedDigestRecorded: false,
  });
  assert.equal(decideBinarySource(migrating), "path");
  assert.equal(isUnverifiedPathFallback(migrating), true);
  assert.equal(unverifiedCacheCause(migrating, true), CACHED_CLI_UNVERIFIED_ON_PATH); // prettier-ignore
  assert.equal(shouldNoticeUnverifiedPath(migrating, false), false);

  // Every other arm is silent — including `download`, which has no binary yet
  // to say anything about.
  for (const [source, over] of Object.entries(OWNED_SOURCES)) {
    if (source === "path") continue;
    const input = resolutionInput({ ...over, onPath: true });
    assert.equal(decideBinarySource(input), source);
    assert.equal(shouldNoticeUnverifiedPath(input, false), false, source);
  }
  const cached = resolutionInput({
    cachedExists: true,
    cachedDigestRecorded: true,
  });
  assert.equal(decideBinarySource(cached), "cached");
  assert.equal(shouldNoticeUnverifiedPath(cached, false), false);
  assert.equal(decideBinarySource(resolutionInput()), "download");
  assert.equal(shouldNoticeUnverifiedPath(resolutionInput(), false), false);
});

test("UNVERIFIED_PATH_IN_USE states the fact without claiming a failure or offering the unverified arm", () => {
  // The one claim it must make, and the only one it may: this extension did not
  // check that binary. `isNativeTanVersionOutput` is a format probe on
  // attacker-controllable stdout, so no wording here may imply integrity.
  assert.match(UNVERIFIED_PATH_IN_USE, /nothing here verified/i);
  assert.match(UNVERIFIED_PATH_IN_USE, /PATH/);
  // NOT an error. Nothing failed and the customer's setup works.
  assert.doesNotMatch(UNVERIFIED_PATH_IN_USE, /\bfail(ed|s|ure)?\b|\berror\b/i);
  // #389's rule: `alpSdk.cliPath` is the one arm with no checksum path at all,
  // so it is never the answer to "this one was not verified".
  assert.doesNotMatch(UNVERIFIED_PATH_IN_USE, /alpSdk\.cliPath/);
  // VS Code clips a toast to about two lines.
  assert.ok(
    UNVERIFIED_PATH_IN_USE.length <= 200,
    `too long to read unexpanded (${UNVERIFIED_PATH_IN_USE.length} chars)`,
  );
  // No path, URL or errno — `planFailure` would demote a cause carrying any of
  // those into the channel and replace the toast with "<operation> failed.",
  // which for this notice would be a lie as well as a loss.
  assert.doesNotMatch(UNVERIFIED_PATH_IN_USE, /https?:\/\/|[A-Za-z]:[\\/]/);
});

test("isCliBehind compares numeric version tuples", () => {
  assert.equal(isCliBehind("0.1.11", "0.1.14"), true);
  assert.equal(isCliBehind("0.1.14", "0.1.14"), false);
  assert.equal(isCliBehind("0.2.0", "0.1.14"), false);
  assert.equal(isCliBehind("1.0.0", "0.1.14"), false);
  assert.equal(isCliBehind(null, "0.1.14"), false); // unknown → not behind
});

test("bootstrapHostVerdict: refuses only the error-severity bootstrap.yocto-host issue", () => {
  const envelope = (ok, issues) => ({
    command: "bootstrap",
    ok,
    exitCode: ok ? 0 : 2,
    project: { root: null, boardYaml: null },
    data: {},
    issues,
  });

  // The real refusal shape tan-cli's bootstrap/mod.rs emits (YoctoGate::Refuse).
  const refused = bootstrapHostVerdict(
    envelope(false, [
      {
        code: "bootstrap.yocto-host",
        severity: "error",
        message: "every core in this project targets Yocto. …",
      },
    ]),
  );
  assert.deepEqual(refused, {
    refuse: true,
    message: "every core in this project targets Yocto. …",
  });

  // Same issue CODE, but the mixed-board WARN shape (YoctoGate::Warn, ok:true)
  // -- a mixed board can still bootstrap its non-Yocto core(s) here, so this
  // must NOT be treated as a refusal (the regression this test guards).
  const mixed = bootstrapHostVerdict(
    envelope(true, [
      {
        code: "bootstrap.yocto-host",
        severity: "warning",
        message: "a Yocto core is in play. …",
      },
    ]),
  );
  assert.deepEqual(mixed, { refuse: false });

  // A clean run (no issues at all) never refuses.
  assert.deepEqual(bootstrapHostVerdict(envelope(true, [])), {
    refuse: false,
  });

  // An unrelated failure (e.g. sdk-root-unresolved) never refuses -- the
  // real terminal run surfaces it legibly instead (see util.ts).
  const unrelated = bootstrapHostVerdict(
    envelope(false, [
      {
        code: "bootstrap.sdk-root-unresolved",
        severity: "error",
        message: "alp-sdk root is unresolved.",
      },
    ]),
  );
  assert.deepEqual(unrelated, { refuse: false });

  // A null envelope (the pre-flight call itself failed/unresolvable/not
  // JSON) always proceeds -- never block a working setup on a failed probe.
  assert.deepEqual(bootstrapHostVerdict(null), { refuse: false });
});

test("bootstrapHostVerdict: refuses an old tan's bootstrap.windows-unsupported (permanent, not transitional)", () => {
  // The real shape a pre-v0.3.1 tan (still shelling bootstrap.sh) emits on
  // win32 -- an old binary pinned forever via alpSdk.cliPath must keep
  // hitting this branch, not just until the user upgrades.
  const oldTan = bootstrapHostVerdict({
    command: "bootstrap",
    ok: false,
    exitCode: 1,
    project: { root: null, boardYaml: null },
    data: {},
    issues: [
      {
        code: "bootstrap.windows-unsupported",
        severity: "error",
        message:
          "bootstrap.sh is POSIX-only. On Windows use WSL2 (Ubuntu) or " +
          "follow the native steps in docs/cross-platform-setup.md §4.",
      },
    ],
  });
  assert.equal(oldTan.refuse, true);
  // Own message, not tan's -- tan's wording never mentions updating tan.
  assert.match(oldTan.message, /update/i);
  assert.match(oldTan.message, /WSL/);

  // A warning-severity windows-unsupported (hypothetical/never emitted today)
  // must not refuse -- only "error" gates the run, same rule as yocto-host.
  assert.deepEqual(
    bootstrapHostVerdict({
      command: "bootstrap",
      ok: true,
      exitCode: 0,
      project: { root: null, boardYaml: null },
      data: {},
      issues: [
        {
          code: "bootstrap.windows-unsupported",
          severity: "warning",
          message: "…",
        },
      ],
    }),
    { refuse: false },
  );
});

test("prerequisitesMissingIssue: returns the error-severity issue verbatim, and only that", () => {
  const envelope = (issues) => ({
    command: "bootstrap",
    ok: false,
    exitCode: 1,
    project: { root: null, boardYaml: null },
    data: {},
    issues,
  });

  // Byte-exact real refusal: tan-cli's `failure()` (bootstrap/mod.rs) joins
  // lines with a single space, never `\n` -- confirmed live with ninja absent.
  const prereq = {
    code: "bootstrap.prerequisites-missing",
    severity: "error",
    message:
      "Missing required tools:   ninja  ->  winget install -e --id " +
      "Ninja-build.Ninja Install the tools above (then reopen PowerShell) " +
      "and re-run.",
  };
  assert.equal(prerequisitesMissingIssue(envelope([prereq])), prereq);

  // Same code, but not "error" severity -- must not be treated as a verdict.
  assert.equal(
    prerequisitesMissingIssue(envelope([{ ...prereq, severity: "warning" }])),
    null,
  );

  // An unrelated issue (e.g. a different bootstrap refusal) is not this verdict.
  assert.equal(
    prerequisitesMissingIssue(
      envelope([
        {
          code: "bootstrap.yocto-host",
          severity: "error",
          message: "every core in this project targets Yocto. …",
        },
      ]),
    ),
    null,
  );

  // No issues at all -- not a verdict.
  assert.equal(prerequisitesMissingIssue(envelope([])), null);

  // The fall-through rule: a probe that failed/couldn't resolve/returned
  // nothing parseable is a null envelope here -- MUST NOT be treated as a
  // prerequisites refusal (never block a working setup on a failed probe).
  assert.equal(prerequisitesMissingIssue(null), null);
});

// tan's prerequisite pre-flight (tan-core `bootstrap/prerequisites.rs`) refuses
// with THREE codes, not one. The extension matched only the first, so both
// python refusals fell through the win32 pre-flight, the real bootstrap was
// spawned anyway, and the customer watched the identical refusal a second time
// with tan's guidance lost in the terminal. tan's own source is explicit that
// the two python codes carry NO missing-tool list — a consumer keying on
// `prerequisites-missing` alone "would get an empty array against a fully
// actionable message".
//
// The pinned SUPPORTED_CLI_VERSION emits only `bootstrap.prerequisites-missing`
// (the other two landed in tan after that tag). Matching a code the pinned
// binary never emits is harmless and lands the fix BEFORE the pin bump.
const PREREQUISITE_REFUSAL_CODES = [
  "bootstrap.prerequisites-missing",
  "bootstrap.python-not-runnable",
  "bootstrap.python-too-old",
];

for (const code of PREREQUISITE_REFUSAL_CODES) {
  test(`prerequisitesMissingIssue: "${code}" at error severity is a refusal`, () => {
    const issue = {
      code,
      severity: "error",
      message: "tan's own refusal text, verbatim.",
    };
    const envelope = {
      command: "bootstrap",
      ok: false,
      exitCode: 1,
      project: { root: null, boardYaml: null },
      data: {},
      issues: [issue],
    };
    assert.equal(
      prerequisitesMissingIssue(envelope),
      issue,
      `${code} is a verdict tan already reached — re-running reproduces it`,
    );

    // The narrowness rule is per-code, not just for the first one: only
    // "error" gates the run.
    assert.equal(
      prerequisitesMissingIssue({
        ...envelope,
        issues: [{ ...issue, severity: "warning" }],
      }),
      null,
    );
  });
}

test("prerequisitesMissingIssue: an unrecognised bootstrap code still falls through", () => {
  // The fall-through rule is unchanged by widening the set: a code this build
  // does not know is NOT a verdict, and blocking on it would break a working
  // host the day tan adds a refusal we haven't taught the extension.
  assert.equal(
    prerequisitesMissingIssue({
      command: "bootstrap",
      ok: false,
      exitCode: 1,
      project: { root: null, boardYaml: null },
      data: {},
      issues: [
        {
          code: "bootstrap.some-future-refusal",
          severity: "error",
          message: "…",
        },
      ],
    }),
    null,
  );
});

test("cliSkew is the single comparison: behind / same / ahead-patch / ahead-minor / unknown", () => {
  assert.equal(cliSkew("0.1.11", "0.1.14"), "behind");
  assert.equal(cliSkew("0.1.14", "0.1.14"), "same");
  // PATCH ahead is its own verdict -- it cannot move the envelope contract.
  assert.equal(cliSkew("0.3.2", "0.3.1"), "ahead-patch");
  // MINOR (and MAJOR) ahead is the axis that can rename an issue code/field.
  assert.equal(cliSkew("0.4.0", "0.3.1"), "ahead-minor");
  assert.equal(cliSkew("1.0.0", "0.3.1"), "ahead-minor");

  // Pre-release rule (SemVer §11): an rc is OLDER than its own release...
  assert.equal(cliSkew("0.4.0-rc.1", "0.4.0"), "behind");
  assert.equal(cliSkew("0.4.0", "0.4.0-rc.1"), "ahead-patch");
  assert.equal(cliSkew("0.4.0-rc.1", "0.4.0-rc.1"), "same");
  // ...but an rc of a NEWER minor is still ahead-minor: the suffix must not
  // mask the bump that can break the contract.
  assert.equal(cliSkew("0.4.0-rc.1", "0.3.1"), "ahead-minor");

  // Anything unparseable on either side is "unknown", and every caller stays
  // quiet on it -- a probe hiccup must never nag.
  assert.equal(cliSkew(null, "0.3.1"), "unknown");
  assert.equal(cliSkew("", "0.3.1"), "unknown");
  assert.equal(cliSkew("tan-dev", "0.3.1"), "unknown");
  assert.equal(cliSkew("0.3", "0.3.1"), "unknown");
  assert.equal(cliSkew("0.3.1", "nonsense"), "unknown");

  // isCliBehind is a thin read of it, with its legacy behaviour unchanged.
  assert.equal(isCliBehind("0.2.0", "0.1.14"), false);
  assert.equal(isCliBehind(null, "0.1.14"), false);
});

test("shouldWarnCliAhead: PATCH-newer is silent, MINOR/MAJOR-newer warns exactly once", () => {
  // PATCH newer -> NO notification. A patch can't move the envelope contract,
  // and a toast on every activation is the nagging the notify seam fought.
  assert.equal(shouldWarnCliAhead("0.3.2", undefined, "0.3.1"), false);
  assert.equal(shouldWarnCliAhead("0.3.9", undefined, "0.3.1"), false);

  // MINOR newer -> exactly one warning (this is the headline case).
  assert.equal(shouldWarnCliAhead("0.4.0", undefined, "0.3.1"), true);
  // MAJOR newer counts on the same axis.
  assert.equal(shouldWarnCliAhead("1.0.0", undefined, "0.3.1"), true);
  // An rc of a newer minor warns too -- the rc suffix must not silence it.
  assert.equal(shouldWarnCliAhead("0.4.0-rc.1", undefined, "0.3.1"), true);

  // The one-shot gate: a SECOND activation, with the warning already recorded
  // for this exact version, is silent.
  assert.equal(shouldWarnCliAhead("0.4.0", "0.4.0", "0.3.1"), false);
  // ...but a further upgrade is news again.
  assert.equal(shouldWarnCliAhead("0.5.0", "0.4.0", "0.3.1"), true);
  // ...and a recorded warning for a version that is no longer installed does
  // not suppress the one for the version that IS.
  assert.equal(shouldWarnCliAhead("0.4.0", "0.3.2", "0.3.1"), true);

  // behind / same / unknown never warn.
  assert.equal(shouldWarnCliAhead("0.3.0", undefined, "0.3.1"), false);
  assert.equal(shouldWarnCliAhead("0.3.1", undefined, "0.3.1"), false);
  assert.equal(shouldWarnCliAhead(null, undefined, "0.3.1"), false);
  assert.equal(shouldWarnCliAhead("tan-dev", undefined, "0.3.1"), false);
});

test("the ahead-of-pin warning is gated on persisted state, not a module flag", () => {
  // The pure decision above is only honest if the adapter actually asks it AND
  // records the answer -- a module-level flag would re-warn on every
  // activation, which is exactly what this fix removes.
  assert.match(
    adapterSource,
    /const AHEAD_WARNED_KEY = "alp\.tanAheadWarnedVersion";/,
    "the ahead warning must be keyed in globalState",
  );
  assert.match(
    sourceAfter("shouldWarnCliAhead("),
    /AHEAD_WARNED_KEY/,
    "checkCliVersion must gate on the persisted warned-for version",
  );
  assert.match(
    adapterSource,
    /globalState\.update\( ?AHEAD_WARNED_KEY, ?version,? ?\)/,
    "the warned-for version must be persisted, or the gate never closes",
  );
});

test("the self-heal give-up marker is compared against the pin, so a pin bump re-arms it", () => {
  // Traced, not assumed: HEAL_GAVE_UP_KEY stores the SUPPORTED_CLI_VERSION the
  // self-heal proved futile for, and the gate compares the stored value to the
  // CURRENT pin. Move the pin 0.3.1 -> 0.4.0 with "0.3.1" recorded and the
  // comparison is false, so the download is attempted again for the new pin --
  // correct, and no code change was needed. This test exists to keep it that
  // way: compare against a literal version instead of the pin and the marker
  // would outlive the pin it was recorded for, wedging every future release.
  assert.match(
    adapterSource,
    /globalState\.get<string>\(HEAL_GAVE_UP_KEY\) === SUPPORTED_CLI_VERSION/,
    "the give-up gate must compare against the current pin",
  );
  assert.match(
    adapterSource,
    /globalState\.update\( ?HEAL_GAVE_UP_KEY, ?SUPPORTED_CLI_VERSION,? ?\)/,
    "the give-up marker must record the current pin",
  );
  // ...and no hardcoded version literal sits next to either give-up site.
  for (
    let i = 1;
    i <= adapterSource.split("HEAL_GAVE_UP_KEY").length - 1;
    i++
  ) {
    assert.doesNotMatch(
      sourceAfter("HEAL_GAVE_UP_KEY", i, 60),
      /"\d+\.\d+\.\d+"/,
      "a literal version next to HEAL_GAVE_UP_KEY would outlive the pin",
    );
  }
});

test("prerequisitesMissingIssue: also matches the two python-refusal codes (tan-cli#78/#81)", () => {
  const envelope = (issues) => ({
    command: "bootstrap",
    ok: false,
    exitCode: 1,
    project: { root: null, boardYaml: null },
    data: {},
    issues,
  });

  const tooOld = {
    code: "bootstrap.python-too-old",
    severity: "error",
    message:
      "Python 3.9 found; the SDK tooling needs >= 3.10 (winget install " +
      "-e --id Python.Python.3.12).",
  };
  assert.equal(prerequisitesMissingIssue(envelope([tooOld])), tooOld);

  const notRunnable = {
    code: "bootstrap.python-not-runnable",
    severity: "error",
    message:
      "python3 was found on PATH but could not be run (winget install " +
      "-e --id Python.Python.3.12).",
  };
  assert.equal(prerequisitesMissingIssue(envelope([notRunnable])), notRunnable);

  // Same code, but not "error" severity -- must not be treated as a verdict,
  // same narrowness as the original bootstrap.prerequisites-missing case.
  assert.equal(
    prerequisitesMissingIssue(envelope([{ ...tooOld, severity: "warning" }])),
    null,
  );

  // An unrelated bootstrap refusal code is still not this verdict.
  assert.equal(
    prerequisitesMissingIssue(
      envelope([
        {
          code: "bootstrap.windows-unsupported",
          severity: "error",
          message: "This tan CLI is too old to bootstrap on Windows. …",
        },
      ]),
    ),
    null,
  );

  // A null envelope (failed/unparseable probe) -- not a verdict.
  assert.equal(prerequisitesMissingIssue(null), null);
});

test("aheadPathFixAction gates the ahead-tan remedy on preferGlobalCli", () => {
  // Flag off: a PATH tan only won because no managed copy exists; the cache
  // outranks PATH when off, so downloading the pinned version restores support.
  assert.equal(aheadPathFixAction(false), "updateManagedCli");
  // Flag on: PATH outranks the cache, so re-downloading can't win; turning the
  // preference off is the remedy.
  assert.equal(aheadPathFixAction(true), "openPreferGlobalSetting");
});

test("decideBinarySource follows the resolution order", () => {
  // explicit cliPath always wins.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/tan",
      cliPathExists: true,
      onPath: true,
      bundledExists: true,
      cachedExists: true,
      cachedDigestRecorded: true,
    }),
    "cliPath",
  );
  // a managed binary (bundled here) wins over a verified-native PATH `tan` —
  // PATH is a last resort, not a second choice, so a shell's shadowed/stale
  // `tan` can never override the extension's own binary.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/tan",
      cliPathExists: false,
      onPath: true,
      bundledExists: true,
      cachedExists: true,
      cachedDigestRecorded: true,
    }),
    "bundled",
  );
  // no managed binary and no PATH `tan` → a cached download still wins over
  // triggering a fresh one.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: false,
      cachedExists: true,
      cachedDigestRecorded: true,
    }),
    "cached",
  );
  // nothing resolves at all → download-on-demand.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: false,
      cachedExists: false,
    }),
    "download",
  );
});

test("decideBinarySource: a local tan-cli build resolves before cached/download", () => {
  // A source checkout (no bundle, no network) resolves the built CLI instead of
  // failing with "tan CLI unavailable".
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: false,
      localBuildExists: true,
      cachedExists: false,
    }),
    "localBuild",
  );
  // ...but a bundle (platform VSIX) and PATH/cliPath still win over it.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: true,
      localBuildExists: true,
      cachedExists: false,
    }),
    "bundled",
  );
  // ...and a cached download loses to it.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: false,
      localBuildExists: false,
      cachedExists: true,
      cachedDigestRecorded: true,
    }),
    "cached",
  );
});

test("decideBinarySource: bundled wins over cached/download/PATH but loses to cliPath", () => {
  // bundled beats cached and download when nothing higher-priority resolves.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: true,
      cachedExists: true,
      cachedDigestRecorded: true,
    }),
    "bundled",
  );
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: true,
      cachedExists: false,
    }),
    "bundled",
  );

  // an explicit, existing cliPath still wins over a bundled binary.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/tan",
      cliPathExists: true,
      onPath: false,
      bundledExists: true,
      cachedExists: true,
      cachedDigestRecorded: true,
    }),
    "cliPath",
  );

  // a verified-native `tan` on PATH is a last resort: it no longer overrides
  // a managed bundled binary. PATH may be a stale/non-native `tan` in disguise
  // (see `isNativeTanVersionOutput`), so the extension prefers its own binary
  // whenever one is already available.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: true,
      bundledExists: true,
      cachedExists: true,
      cachedDigestRecorded: true,
    }),
    "bundled",
  );
});

test("decideBinarySource: flag OFF (default) — a verified-native PATH tan is a last resort, pinning the exact default order cliPath > bundled > localBuild > cached > path > download", () => {
  // no cliPath, no bundled/localBuild/cached binary → PATH is all that's left,
  // so it's used ahead of triggering a network download.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: true,
      bundledExists: false,
      localBuildExists: false,
      cachedExists: false,
      preferGlobalCli: false,
    }),
    "path",
  );
  // ...but a cached binary (or bundled/localBuild) still wins over it.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: true,
      bundledExists: false,
      localBuildExists: false,
      cachedExists: true,
      cachedDigestRecorded: true,
      preferGlobalCli: false,
    }),
    "cached",
  );
  // ...and localBuild wins over cached.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: true,
      bundledExists: false,
      localBuildExists: true,
      cachedExists: true,
      cachedDigestRecorded: true,
      preferGlobalCli: false,
    }),
    "localBuild",
  );
  // ...and bundled wins over localBuild.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: true,
      bundledExists: true,
      localBuildExists: true,
      cachedExists: true,
      cachedDigestRecorded: true,
      preferGlobalCli: false,
    }),
    "bundled",
  );
  // ...and an explicit, existing cliPath wins over everything, PATH included.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/tan",
      cliPathExists: true,
      onPath: true,
      bundledExists: true,
      localBuildExists: true,
      cachedExists: true,
      cachedDigestRecorded: true,
      preferGlobalCli: false,
    }),
    "cliPath",
  );
});

test("decideBinarySource: flag ON (preferGlobalCli) — a verified-native PATH tan is promoted above bundled/localBuild/cached, but still loses to cliPath", () => {
  const base = {
    cliPathSetting: "",
    cliPathExists: false,
    onPath: true,
    preferGlobalCli: true,
  };

  // path beats cached.
  assert.equal(
    decideBinarySource({
      ...base,
      bundledExists: false,
      localBuildExists: false,
      cachedExists: true,
      cachedDigestRecorded: true,
    }),
    "path",
  );
  // path beats bundled.
  assert.equal(
    decideBinarySource({
      ...base,
      bundledExists: true,
      localBuildExists: false,
      cachedExists: false,
    }),
    "path",
  );
  // path beats localBuild.
  assert.equal(
    decideBinarySource({
      ...base,
      bundledExists: false,
      localBuildExists: true,
      cachedExists: false,
    }),
    "path",
  );
  // path still loses to an explicit, existing cliPath.
  assert.equal(
    decideBinarySource({
      ...base,
      cliPathSetting: "/x/tan",
      cliPathExists: true,
      bundledExists: true,
      localBuildExists: true,
      cachedExists: true,
      cachedDigestRecorded: true,
    }),
    "cliPath",
  );
  // flag on with onPath:false leaves the rest of the ladder unchanged (falls
  // straight through to bundled, same as flag off).
  assert.equal(
    decideBinarySource({
      ...base,
      onPath: false,
      bundledExists: true,
      localBuildExists: true,
      cachedExists: true,
      cachedDigestRecorded: true,
    }),
    "bundled",
  );
  // ...and with nothing else available either, flag on + onPath:false still
  // falls through to download, same as flag off.
  assert.equal(
    decideBinarySource({
      ...base,
      onPath: false,
      bundledExists: false,
      localBuildExists: false,
      cachedExists: false,
    }),
    "download",
  );
});

test("resolutionInputFromDeps: the single seam both provisioning and resolution build BinaryResolutionInput from sets preferGlobalCli", () => {
  const deps = {
    cliPathSetting: "",
    fileExists: () => false,
    commandOnPath: () => true,
    bundledExists: false,
    localBuildBinaryPath: null,
    cachedBinaryPath: "/cache/tan",
    preferGlobalCli: true,
    recordedCachedDigest: () => undefined,
  };
  const input = resolutionInputFromDeps(deps);
  assert.equal(input.preferGlobalCli, true);
  assert.equal(input.onPath, true);

  const inputOff = resolutionInputFromDeps({ ...deps, preferGlobalCli: false });
  assert.equal(inputOff.preferGlobalCli, false);
});

test("resolutionInputFromDeps: cachedDigestRecorded reflects the recorded digest, and a missing record is FALSE (#386)", () => {
  const deps = {
    cliPathSetting: "",
    fileExists: () => true,
    commandOnPath: () => false,
    bundledExists: false,
    localBuildBinaryPath: null,
    cachedBinaryPath: "/cache/tan",
    preferGlobalCli: false,
    recordedCachedDigest: () => undefined,
  };
  // The migration state: the binary is on disk, nothing vouches for it.
  const migrating = resolutionInputFromDeps(deps);
  assert.equal(migrating.cachedExists, true);
  assert.equal(migrating.cachedDigestRecorded, false);
  // …and that is what keeps `decideBinarySource` off the cached arm, which is
  // the whole mechanism: no record, no spawn.
  assert.equal(decideBinarySource(migrating), "download");

  const recorded = resolutionInputFromDeps({
    ...deps,
    recordedCachedDigest: () => "a".repeat(64),
  });
  assert.equal(recorded.cachedDigestRecorded, true);
  assert.equal(decideBinarySource(recorded), "cached");
});

test("classifyExitCode maps the stable codes", () => {
  assert.equal(classifyExitCode(0), "success");
  assert.equal(classifyExitCode(1), "runtime");
  assert.equal(classifyExitCode(2), "validation");
  assert.equal(classifyExitCode(3), "write");
  assert.equal(classifyExitCode(4), "doctor");
  assert.equal(classifyExitCode(5), "internal");
  assert.equal(classifyExitCode(99), "unknown");
});

test("parseEnvelope accepts a well-formed envelope, rejects junk", () => {
  const good = JSON.stringify({
    command: "validate",
    ok: true,
    exitCode: 0,
    project: { root: "/p", boardYaml: "/p/board.yaml" },
    data: {},
    issues: [],
  });
  const parsed = parseEnvelope(good);
  assert.ok(parsed);
  assert.equal(parsed.command, "validate");

  assert.equal(parseEnvelope(""), null);
  assert.equal(parseEnvelope("   "), null);
  assert.equal(parseEnvelope("not json"), null);
  assert.equal(parseEnvelope(JSON.stringify({ command: "x" })), null); // missing fields
});

test("classifyOutcome sets severity by kind and prefers the first issue", () => {
  const ok = classifyOutcome(
    0,
    parseEnvelope(
      JSON.stringify({
        command: "x",
        ok: true,
        exitCode: 0,
        project: {},
        data: {},
        issues: [],
      }),
    ),
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.kind, "success");
  assert.equal(ok.severity, "info");

  const validation = classifyOutcome(
    2,
    parseEnvelope(
      JSON.stringify({
        command: "validate",
        ok: false,
        exitCode: 2,
        project: {},
        data: {},
        issues: [{ code: "x", severity: "error", message: "bad board.yaml" }],
      }),
    ),
  );
  assert.equal(validation.kind, "validation");
  assert.equal(validation.severity, "warning");
  assert.equal(validation.message, "bad board.yaml");

  const runtime = classifyOutcome(1, null);
  assert.equal(runtime.kind, "runtime");
  assert.equal(runtime.severity, "error");

  assert.equal(classifyOutcome(4, null).severity, "warning"); // doctor
  assert.equal(classifyOutcome(3, null).severity, "error"); // write
});

test("releaseAssetForTarget mirrors the six tan-cli release targets (raw binary, v<version> tag)", () => {
  const linux = releaseAssetForTarget("linux", "x64");
  assert.equal(linux.target, "x86_64-unknown-linux-musl");
  assert.equal(linux.tag, `v${SUPPORTED_CLI_VERSION}`);
  assert.equal(linux.assetName, "tan-x86_64-unknown-linux-musl");
  assert.ok(
    linux.url.endsWith(
      `/alplabai/tan-cli/releases/download/v${SUPPORTED_CLI_VERSION}/tan-x86_64-unknown-linux-musl`,
    ),
  );

  // arm64 Linux ships the static musl build too (no glibc floor on either arch).
  assert.equal(
    releaseAssetForTarget("linux", "arm64").target,
    "aarch64-unknown-linux-musl",
  );

  // both macOS arches are published (Intel + Apple Silicon).
  assert.equal(
    releaseAssetForTarget("darwin", "x64").target,
    "x86_64-apple-darwin",
  );
  assert.equal(
    releaseAssetForTarget("darwin", "arm64").target,
    "aarch64-apple-darwin",
  );

  // Windows ships BOTH x64 and arm64; the asset carries a `.exe` suffix.
  const winX64 = releaseAssetForTarget("win32", "x64");
  assert.equal(winX64.target, "x86_64-pc-windows-msvc");
  assert.equal(winX64.assetName, "tan-x86_64-pc-windows-msvc.exe");
  assert.equal(
    releaseAssetForTarget("win32", "arm64").target,
    "aarch64-pc-windows-msvc",
  );

  // A host with no published target (e.g. 32-bit ARM Linux) has no asset.
  assert.equal(releaseAssetForTarget("linux", "arm"), null);
});

test("releaseAssetForTarget resolves checksums.txt at the SAME tag as the binary", () => {
  for (const [platform, arch] of [
    ["linux", "x64"],
    ["win32", "arm64"],
    ["darwin", "arm64"],
  ]) {
    const asset = releaseAssetForTarget(platform, arch);
    assert.equal(
      asset.checksumsUrl,
      `https://github.com/alplabai/tan-cli/releases/download/${asset.tag}/checksums.txt`,
    );
    // The property that matters: the digest can never be looked up against a
    // different release than the bytes came from.
    assert.equal(
      asset.checksumsUrl.slice(0, asset.checksumsUrl.lastIndexOf("/")),
      asset.url.slice(0, asset.url.lastIndexOf("/")),
    );
  }
  // An explicit version pins both halves together too.
  const pinned = releaseAssetForTarget("linux", "x64", "0.9.9");
  assert.ok(pinned.url.includes("/download/v0.9.9/"));
  assert.ok(pinned.checksumsUrl.includes("/download/v0.9.9/"));
});

// The corpus is the REAL published tan v0.4.0 `checksums.txt` (digests are
// public release metadata), so the parser is proven against the producer's
// actual bytes rather than a hand-invented approximation of them: `<64 hex>` +
// TWO spaces + filename + LF.
const V040_CHECKSUMS = `76197d72333e05dcdb50172d8ca21eb761d49a8cd4d0aab26104eb9e287342a5  envelope-contract.json
b31a9b1673e7bd91297927445ba1a2ec24b03edb30aa760ffb77436dd5ffe86f  tan-aarch64-apple-darwin
d30b2a5536111e30394dbad0a43f18b369c49299cca7538b39ae8fd78278cb92  tan-aarch64-pc-windows-msvc.exe
09a58537dd64b0853e8c06ee03ea64c11e67556e8f044b1fe12353ec99ee4a2d  tan-aarch64-unknown-linux-gnu
95e4cfd820c6ece0f9383f1e140befcdad8ddac92557a93d321b7635c28bdf48  tan-aarch64-unknown-linux-musl
a2696088acd082de19673032b8aceeb353c06d7cd1176c004e26a6e51e353805  tan-x86_64-apple-darwin
a80fb5da183798335d87438c634dcf018763c4ab2089a17a2631464aadfc6b76  tan-x86_64-pc-windows-msvc.exe
cc5b6f1d0ce9a19bcce48fd8addd88fe6f9ec4fbf52d766155b0f651cc68ccec  tan-x86_64-unknown-linux-gnu
d8491a3e23d2ea99ca3d7743ecc5944282489ece62a3bc4c415d03a50e31a273  tan-x86_64-unknown-linux-musl
`;

test("expectedSha256 reads the real published tan v0.4.0 checksums.txt", () => {
  // Verified by hand against the release: downloading
  // tan-x86_64-pc-windows-msvc.exe (3282944 bytes) and hashing it yields
  // exactly this digest, so the published pair really is self-consistent —
  // which is what makes refusing on a mismatch shippable rather than a
  // permanent block.
  assert.equal(
    expectedSha256(V040_CHECKSUMS, "tan-x86_64-pc-windows-msvc.exe"),
    "a80fb5da183798335d87438c634dcf018763c4ab2089a17a2631464aadfc6b76",
  );
  assert.equal(
    expectedSha256(V040_CHECKSUMS, "tan-x86_64-unknown-linux-musl"),
    "d8491a3e23d2ea99ca3d7743ecc5944282489ece62a3bc4c415d03a50e31a273",
  );
  // Every one of the eight published binaries resolves — the extension has a
  // host for each, so a name this parser could not find would be a dead target.
  for (const line of V040_CHECKSUMS.trim().split("\n")) {
    const name = line.split("  ")[1];
    assert.equal(expectedSha256(V040_CHECKSUMS, name)?.length, 64, name);
  }
});

test("expectedSha256 returns null rather than guessing, which is a REFUSAL upstream", () => {
  // No line for the asset. Not a pass: `download.ts` turns this into a
  // ChecksumError, because a release that doesn't list the file it served
  // vouches for nothing.
  assert.equal(expectedSha256(V040_CHECKSUMS, "tan-mips-unknown-linux"), null);
  // A prefix/suffix of a real name must never match a longer or shorter one.
  assert.equal(expectedSha256(V040_CHECKSUMS, "tan-x86_64-apple"), null);
  assert.equal(
    expectedSha256(V040_CHECKSUMS, "tan-x86_64-pc-windows-msvc"),
    null,
    "the .exe asset must not answer for a name without the suffix",
  );
  // Case-sensitive on the FILENAME: the release assets are lowercase triples,
  // and folding case could pair a digest with a different asset.
  assert.equal(expectedSha256(V040_CHECKSUMS, "TAN-x86_64-apple-darwin"), null);
  assert.equal(expectedSha256("", "tan-x86_64-apple-darwin"), null);
  // A truncated / non-hex digest is not a digest, so the line does not count.
  assert.equal(
    expectedSha256(
      "deadbeef  tan-x86_64-apple-darwin",
      "tan-x86_64-apple-darwin",
    ),
    null,
  );
});

test("expectedSha256 tolerates the sha256sum spelling variants, normalising the digest", () => {
  const digest =
    "a80fb5da183798335d87438c634dcf018763c4ab2089a17a2631464aadfc6b76";
  // CRLF (a manifest that went through a Windows tool).
  assert.equal(expectedSha256(`${digest}  tan\r\n`, "tan"), digest);
  // `sha256sum -b` binary-mode marker.
  assert.equal(expectedSha256(`${digest} *tan`, "tan"), digest);
  // A single space / a tab instead of the canonical two spaces.
  assert.equal(expectedSha256(`${digest} tan`, "tan"), digest);
  assert.equal(expectedSha256(`${digest}\ttan`, "tan"), digest);
  // UPPERCASE hex normalises to lower, so the comparison downstream is a plain
  // string equality and can't fail on presentation alone.
  assert.equal(expectedSha256(`${digest.toUpperCase()}  tan`, "tan"), digest);
});

test("classifyUnavailable files a refused checksum as its OWN reason, not as corrupt or a network failure", () => {
  // The exact sentences `download.ts` throws. Neither neighbouring reason is
  // survivable here: `downloadFailed` offers "retry when you're back online"
  // for bytes that arrived perfectly well, and `corrupt` says "the installed
  // copy looks broken" — false, nothing was installed — and then offers
  // `alpSdk.cliPath`, the one resolution source that is NEVER checksum-checked.
  for (const sentence of [
    "The downloaded tan CLI does not match the checksum Alp Lab published for it, so it was discarded and nothing was installed.",
    "The tan CLI download was discarded: the checksum file that vouches for it could not be fetched, so there was no way to tell whether the binary is the one Alp Lab published.",
    "The tan CLI download was discarded: the release's checksum file does not list this binary, so nothing vouches for the bytes that were served.",
  ]) {
    assert.equal(classifyUnavailable(sentence), "checksumRefused", sentence);
  }
});

test("binaryName is platform-specific", () => {
  assert.equal(binaryName("win32"), "tan.exe");
  assert.equal(binaryName("linux"), "tan");
  assert.equal(binaryName("darwin"), "tan");
});

test("isNativeTanVersionOutput accepts native clap output, rejects everything else", () => {
  // Native (Rust/clap): `tan <MAJOR.MINOR.PATCH>`.
  for (const out of [
    "tan 0.1.0",
    "tan 0.1.6\n",
    "tan 10.20.30",
    "tan 0.2.0 (abc1234)", // tolerate a future build-metadata suffix
    "  tan 0.1.0  ", // surrounding whitespace
    "tan 0.1.0\r\n", // CRLF
    "\ntan 0.1.0", // leading blank line
  ]) {
    assert.equal(
      isNativeTanVersionOutput(out),
      true,
      `expected native: ${JSON.stringify(out)}`,
    );
  }

  // A click-style `tan, version X` line does not emit the JSON envelope.
  for (const out of ["tan, version 0.8.1", "tan, version 0.8.1\n"]) {
    assert.equal(
      isNativeTanVersionOutput(out),
      false,
      `expected click-style rejected: ${JSON.stringify(out)}`,
    );
  }

  // Garbage / unrelated / partial / the retired `alp` name → not the native CLI.
  for (const out of [
    "",
    "   ",
    "alp 0.1.3", // the retired binary name
    "python 3.11.5",
    "tango 3.19", // must not partial-match the `tan` prefix
    "tan", // name only, no version
    "tan 0.1", // two components, not MAJOR.MINOR.PATCH
    "usage: tan [OPTIONS]", // help/error text
  ]) {
    assert.equal(
      isNativeTanVersionOutput(out),
      false,
      `expected rejected: ${JSON.stringify(out)}`,
    );
  }
});

// ── debug-config envelope guard ───────────────────────────────────────────────

/** The REAL payload tan 0.3.1 returns — the released version at the time this
 *  landed, which predates `data.configuration` (tan-cli#67). Kept verbatim as
 *  the negative fixture: this is the shape that must never reach launch.json. */
const TAN_0_3_1_DATA = {
  schemaVersion: "1",
  generatedAt: "2026-07-25T16:09:55.563Z",
  targetKind: "zephyr-mcu",
  server: "jlink",
  preview: false,
  launchJsonPath: "/p/.vscode/launch.json",
  replaced: false,
  notes: ["This is a draft launch configuration generated by tan."],
};

const TAN_0_3_2_DATA = {
  ...TAN_0_3_1_DATA,
  configuration: {
    name: "Alp: Zephyr Debug (J-Link)",
    type: "cortex-debug",
    executable:
      "${workspaceFolder}/build/m55_he-zephyr/build/zephyr/zephyr.elf",
    device: "Cortex-M55",
  },
};

test("isDebugConfigData rejects the released 0.3.1 payload", () => {
  // ok:true, exitCode 0 — the skew is invisible from the exit code alone.
  assert.strictEqual(isDebugConfigData(TAN_0_3_1_DATA), false);
  assert.strictEqual(isDebugConfigData(TAN_0_3_2_DATA), true);
});

test("isDebugConfigData requires a non-empty configuration name", () => {
  // The one field the caller consumes. Empty degrades silently: the wrong
  // adapter is prompted for, then startDebugging fails with `declined to
  // start ""`.
  const noName = { ...TAN_0_3_2_DATA, configuration: { type: "cortex-debug" } };
  const emptyName = {
    ...TAN_0_3_2_DATA,
    configuration: { name: "", type: "cortex-debug" },
  };
  assert.strictEqual(isDebugConfigData(noName), false);
  assert.strictEqual(isDebugConfigData(emptyName), false);
});

test("isDebugConfigData rejects non-string notes", () => {
  // They are logged verbatim; an object prints as [object Object].
  const bad = { ...TAN_0_3_2_DATA, notes: ["fine", { not: "a string" }] };
  assert.strictEqual(isDebugConfigData(bad), false);
});

test("isDebugConfigData rejects junk", () => {
  for (const junk of [null, undefined, 42, "text", [], {}]) {
    assert.strictEqual(isDebugConfigData(junk), false);
  }
});

test("launchConfigPlaceholders finds every unresolved value, nested, with its key", () => {
  // A board that registers no OpenOCD runner still gets configFiles with a
  // placeholder — inside an ARRAY, which a flat scan would miss.
  const partly = {
    name: "Alp: Zephyr Debug (OpenOCD)",
    servertype: "openocd",
    serverpath: "/zephyr-sdk-1.0.1/hosttools/usr/bin/openocd",
    configFiles: ["<resolved-openocd-board-cfg>"],
    device: "<resolved-device>",
  };
  // The KEY is what makes a finding actionable: `foldLaunchConfigPlaceholders`
  // names its check after it and the toast is built from check names, so this
  // is what turns "resolve: launchConfig" into "resolve: device" (#339).
  assert.deepStrictEqual(launchConfigPlaceholders(partly), [
    { key: "configFiles[0]", value: "<resolved-openocd-board-cfg>" },
    { key: "device", value: "<resolved-device>" },
  ]);
  // Nested under an object inside an array — the cppdbg `setupCommands` shape.
  assert.deepStrictEqual(
    launchConfigPlaceholders({ setupCommands: [{ text: "<resolved-gdb>" }] }),
    [{ key: "setupCommands[0].text", value: "<resolved-gdb>" }],
  );
  // A fully resolved configuration must report clean, or every debug session
  // would be marked unlaunchable.
  assert.deepStrictEqual(
    launchConfigPlaceholders(TAN_0_3_2_DATA.configuration),
    [],
  );
});
