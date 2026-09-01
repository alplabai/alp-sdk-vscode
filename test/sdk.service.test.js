const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isSdkVersionBelowMin,
  listLocalSdkEntries,
  MIN_SDK_VERSION,
  narrowSdkCurrent,
  narrowSdkReleases,
} = require("../packages/alp-core/dist/sdk/service.js");

test("flags SDKs older than the supported floor", () => {
  assert.equal(isSdkVersionBelowMin("0.8.1"), true);
  assert.equal(isSdkVersionBelowMin("0.9.0"), true);
  assert.equal(isSdkVersionBelowMin("v0.9.0"), true); // tolerates a leading v
});

test("accepts the floor and newer", () => {
  assert.equal(isSdkVersionBelowMin(MIN_SDK_VERSION), false);
  assert.equal(isSdkVersionBelowMin("0.10.1"), false);
  assert.equal(isSdkVersionBelowMin("0.11.0"), false);
  assert.equal(isSdkVersionBelowMin("1.0.0"), false);
});

test("treats null/unparseable as unknown, not behind", () => {
  // A dev checkout's metadata/sdk_version.yaml can lag the tag; never mis-flag.
  assert.equal(isSdkVersionBelowMin(null), false);
  assert.equal(isSdkVersionBelowMin("0.11.0-rc1"), false);
  assert.equal(isSdkVersionBelowMin("garbage"), false);
});

// #361: `path.resolve` does not fold case, so a hand-typed `alpSdk.path` seeded
// as a search root used to list the SAME SDK a second time whenever its casing
// differed from what discovery produced. De-dup keys on the canonical form.
test("listLocalSdkEntries de-dups one SDK reached under two casings on win32", () => {
  // Forward slashes on purpose: `listLocalSdkEntries` calls the HOST's
  // `path.resolve`, so a backslash fixture would mean different things on the
  // Windows dev box and the Linux CI runner. These two differ only in case.
  const roots = [
    "C:/Users/Me/.alp/sdk/v0.13.0",
    "c:/users/me/.alp/sdk/v0.13.0",
  ];
  const entries = listLocalSdkEntries(
    roots,
    () => true, // every probe (loader script, readiness) succeeds
    () => "0.13.0",
    () => [],
    "win32",
  );
  assert.equal(entries.length, 1);
});

// The same two strings ARE two directories on a case-sensitive filesystem.
test("listLocalSdkEntries keeps case-distinct roots separate off win32", () => {
  const entries = listLocalSdkEntries(
    ["/home/me/.alp/sdk/V0.13.0", "/home/me/.alp/sdk/v0.13.0"],
    () => true,
    () => "0.13.0",
    () => [],
    "linux",
  );
  assert.equal(entries.length, 2);
});

// ── narrowSdkReleases (#611) ─────────────────────────────────────────────────
//
// Both `src/deps/vscodeAdapter.ts` and `src/ideHub/sdkManagerMessages.ts` used
// to read `tan sdk list`'s untrusted envelope payload as
// `(envelope.data as { releases?: SdkRelease[] }).releases ?? []` — a cast,
// not a narrow. A `releases` that is not an array throws on `.find`
// (`pickLatestSdkTag`); an entry without a string `tag` throws inside
// `isStableTag`'s `tag.trim()`, on a path with no try/catch. This function is
// the shared, narrowing replacement: malformed entries are DROPPED, never
// coerced, and the well-formed ones survive byte-identical.

const REAL_RELEASE = {
  tag: "v0.16.0",
  publishedAt: "2026-07-31T21:54:56Z",
  tarballUrl: "https://api.github.com/repos/alplabai/alp-sdk/tarball/v0.16.0",
  releaseNotesSummary: "Release notes.",
  releaseNotes: "Release notes.",
};

test("narrowSdkReleases keeps a well-formed release byte-identical", () => {
  assert.deepEqual(narrowSdkReleases({ releases: [REAL_RELEASE] }), [
    REAL_RELEASE,
  ]);
});

test("narrowSdkReleases drops an entry with no string tag rather than throwing", () => {
  assert.deepEqual(
    narrowSdkReleases({
      releases: [{ ...REAL_RELEASE, tag: undefined }, REAL_RELEASE],
    }),
    [REAL_RELEASE],
  );
});

test("narrowSdkReleases returns [] rather than throwing when `releases` is not an array", () => {
  assert.deepEqual(narrowSdkReleases({ releases: "not-an-array" }), []);
  assert.deepEqual(narrowSdkReleases({}), []);
  assert.deepEqual(narrowSdkReleases(null), []);
});

test("narrowSdkReleases defaults a missing cosmetic field to empty string, never inventing one", () => {
  assert.deepEqual(narrowSdkReleases({ releases: [{ tag: "v0.16.0" }] }), [
    {
      tag: "v0.16.0",
      publishedAt: "",
      tarballUrl: "",
      releaseNotesSummary: "",
      releaseNotes: "",
    },
  ]);
});

// ── narrowSdkCurrent (#614) ───────────────────────────────────────────────────
//
// `tan sdk current`'s untrusted `data` payload narrowed the same way
// `narrowSdkReleases` narrows `sdk list`'s (#611): malformed fields DROPPED,
// never coerced. Fixtures below are the REAL shapes measured against the
// pinned tan 0.6.0 binary (`tan sdk current --sdk-root <dir> --format json`,
// and again with a dangling `.alp/sdk-path`/no SDK at all), not invented from
// the issue's prose.

// Measured: `tan sdk current --sdk-root <fakesdk> --format json`.
const FOUND_DATA = {
  subcommand: "current",
  sdkPath: "/private/tmp/scratch/fakesdk",
  readiness: {
    sdkPath: "/private/tmp/scratch/fakesdk",
    version: "0.16.0-rc1",
    loaderScriptPresent: true,
    metadataPresent: true,
    state: "ready",
    issues: [],
  },
  sourceTier: "sdkRootFlag",
};

// Measured: `tan sdk current --format json` with no `.alp/sdk-path`, no
// `~/.alp/sdk-default`, and no `--sdk-root` — matches the `sdk-current-no-sdk`
// entry in the fetched `test/golden/tan-contract/envelope-contract.json` at
// the time this was written (that file is gitignored, fetched via
// `pnpm run contract:fetch`, and this literal is NOT compared against it by
// any gate — a hand-typed snapshot, not a pinned one).
const NONE_DATA = {
  subcommand: "current",
  sdkPath: null,
  readiness: null,
  sourceTier: "none",
};

test("narrowSdkCurrent keeps sdkPath/sourceTier byte-identical and readiness's state+issues", () => {
  // `readiness` is narrowed to the two fields this extension actually reads
  // (`state`, `issues`) — the wider `checkSdkReadiness` shape tan's payload
  // also happens to carry (`version`/`loaderScriptPresent`/`metadataPresent`)
  // is not kept: nothing here consumes it, and keeping it would be a second,
  // untested copy of a shape `checkSdkReadiness` already owns locally.
  assert.deepEqual(narrowSdkCurrent(FOUND_DATA), {
    sdkPath: FOUND_DATA.sdkPath,
    readiness: { state: "ready", issues: [] },
    sourceTier: FOUND_DATA.sourceTier,
  });
});

test("narrowSdkCurrent keeps the `none` tier's null sdkPath/readiness, not a dropped result", () => {
  assert.deepEqual(narrowSdkCurrent(NONE_DATA), {
    sdkPath: null,
    readiness: null,
    sourceTier: "none",
  });
});

test("narrowSdkCurrent returns null when sourceTier is missing or the wrong type", () => {
  assert.equal(narrowSdkCurrent({ sdkPath: "/sdk", readiness: null }), null);
  assert.equal(
    narrowSdkCurrent({ ...NONE_DATA, sourceTier: 42 }),
    null,
    "a non-string sourceTier is not this shape at all",
  );
});

test("narrowSdkCurrent returns null for non-object input rather than throwing", () => {
  assert.equal(narrowSdkCurrent(null), null);
  assert.equal(narrowSdkCurrent("current"), null);
  assert.equal(narrowSdkCurrent(undefined), null);
});

test("narrowSdkCurrent leaves an unrecognised sourceTier value alone (forward-compat)", () => {
  // #614's own framing: a future rung of tan's ladder is a fact this
  // extension should still be able to report, not a value narrowing drops —
  // the same discipline `narrowModelCoverage` applies to `npuCoverage` (#521).
  const future = { ...FOUND_DATA, sourceTier: "envOverride" };
  assert.deepEqual(narrowSdkCurrent(future), {
    sdkPath: future.sdkPath,
    readiness: { state: "ready", issues: [] },
    sourceTier: "envOverride",
  });
});

test("narrowSdkCurrent drops a malformed readiness but keeps sdkPath/sourceTier", () => {
  assert.deepEqual(
    narrowSdkCurrent({ ...FOUND_DATA, readiness: { sdkPath: "/sdk" } }),
    {
      sdkPath: FOUND_DATA.sdkPath,
      readiness: null,
      sourceTier: FOUND_DATA.sourceTier,
    },
    "readiness with no string `state` is not the shape checkSdkReadiness produces",
  );
  assert.deepEqual(narrowSdkCurrent({ ...FOUND_DATA, readiness: "ready" }), {
    sdkPath: FOUND_DATA.sdkPath,
    readiness: null,
    sourceTier: FOUND_DATA.sourceTier,
  });
});

test("narrowSdkCurrent drops non-string issues entries inside readiness rather than throwing", () => {
  const withBadIssues = {
    ...FOUND_DATA,
    readiness: { ...FOUND_DATA.readiness, issues: ["real issue", 5, null] },
  };
  assert.deepEqual(narrowSdkCurrent(withBadIssues).readiness.issues, [
    "real issue",
  ]);
});
