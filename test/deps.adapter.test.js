// SPDX-License-Identifier: Apache-2.0
//
// The host-side decisions in `src/deps/vscodeAdapter.ts` + `src/deps/panel.ts`
// that are NOT tan's to make, and that a panel screenshot cannot catch:
//
//   1. WHICH release is "latest". `tan sdk list` carries no `draft`/`prerelease`
//      flag, so `releases[0]` offers a release candidate as the latest SDK the
//      day one is published — and the table then tells every customer to move
//      onto an rc. The tag is the only signal there is until tan emits the flag.
//   2. WHEN the cached answer must be re-fetched. That lookup is a live
//      unauthenticated GitHub call against a 60-req/hour budget with no HTTP
//      timeout at the pin, so the TTL is a real decision, not a detail.
//   3. WHICH cells the host may fill at all. The extension's own probe and tan's
//      disagree by definition on a row tan reports as missing.
//   4. WHETHER a process is spawned, and WHEN the table reaches the view.
//      Both are invisible to a type check and to a green suite.
//
// Loaded through the same `Module._load` swap the other adapter tests use
// (test/bootstrap.noWorkspace.test.js). `src/alpCli/service.ts`,
// `src/notify/service.ts` and the core planner are PURE, so they are loaded for
// real — the asserted behaviour is the shipped one, not a copy of it in a stub.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const { SUPPORTED_CLI_VERSION } = require("../out/alpCli/service.js");

const root = path.join(__dirname, "..");

/** Require `relPath` out of `out/` with `stubs` standing in for the requires
 *  named. Swaps Node's loader only for the duration of the synchronous require,
 *  so it never leaks into another test file sharing the process. */
function loadWithStubs(relPath, stubs) {
  const modPath = require.resolve(path.join(root, "out", relPath));
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

/** Load out/deps/vscodeAdapter.js with the host-only modules stubbed out.
 *  `overrides` replaces one stub per test; everything else is inert. */
function loadDepsAdapter(overrides = {}) {
  return loadWithStubs("deps/vscodeAdapter.js", {
    vscode: { window: {}, Uri: {} },
    "../alpCli/vscodeAdapter": {},
    "../alpCli/doctor": {},
    "../notify/vscodeAdapter": { notifyAsync() {} },
    // `readOnlyProjectCwd` (#605) is `latestSdkTag`'s replacement for a bare
    // `undefined` cwd on the `sdk list` spawn; none of the tests below assert
    // on the exact value, only that a spawn happens and with which flags.
    "../project/vscodeAdapter": { readOnlyProjectCwd: () => "/proj" },
    "../toolchain": {},
    "../util": { log() {} },
    ...overrides,
  });
}

/**
 * A REAL `tan doctor` envelope from the PINNED binary, captured with
 * `COLUMNS=200 tan --format json doctor` inside a project and committed
 * verbatim except for one redaction: every absolute path is rewritten onto
 * `/home/dev`.
 *
 * RESOLVED FROM `SUPPORTED_CLI_VERSION`, not a hardcoded filename, for the
 * same reason `test/deps.projectScope.test.js` derives its own copy that way:
 * a pin bump is a doctor-envelope change (check names, the `scope`
 * vocabulary, and which checks are project-scoped all move with it), and a
 * hardcoded literal would leave this whole file reading a superseded
 * binary's envelope with nothing to say so.
 *
 * It is here because the split this file asserts is a claim about tan, not
 * about a stub. tan SCOPES each check itself — `"scope": "project"` or
 * `"scope": "host"` on all fourteen — and that field is what decides which
 * rows are withheld with no folder open. Six are project-scoped
 * (`sdk`, `boardYaml`, `workspace`, `westResolved`, `pythonFloor`,
 * `sdkProvenance`) and eight are host-scoped; note that `sdkProvenance` is one
 * the retired hand list never named, which is the whole argument for reading
 * tan's answer instead of maintaining our own. `zephyrWorkspace`, which used
 * to be the second such check in the rc1 capture this replaced, is not on the
 * wire in THIS capture at all — it depends on a bootstrapped Zephyr workspace
 * being present, and this one was taken against a project that has an SDK
 * resolved but no workspace bootstrapped yet. A check's presence in the
 * checks array is itself state-dependent, not just its status.
 */
const REAL_PINNED = require(
  `./fixtures/tan-doctor.v${SUPPORTED_CLI_VERSION}.darwin.json`,
).data;

/**
 * A REAL `tan 0.4.0` plain-`doctor` envelope from a Windows 11 host, same
 * redaction rules, kept for ONE thing: it has no `scope` on any check, so it
 * is the only way to exercise `LEGACY_PROJECT_CHECKS` — the fallback that runs
 * when `alpSdk.cliPath` points at a binary older than the contract. Its
 * `longPaths` row is also the concrete #472 customer: `LongPathsEnabled = 0`
 * is the stock Windows default and the build then dies in CMake complaining
 * about a file that exists.
 *
 * IT NO LONGER REACHES A TABLE, and that is the point of it now: it carries no
 * per-tool PATH probe at all, so `buildDependencyReport` refuses it outright
 * (`carriesToolchainProbes`) rather than rendering the twelve rows that are
 * there and none of the nine that are not. See "a tan whose doctor reports no
 * host tool at all is refused" below. What it is still driven through directly
 * is the PURE planner, which is where the no-allowlist rule actually lives.
 */
const REAL_LEGACY = require("./fixtures/tan-doctor.v0.4.0.windows.json").data;

/**
 * The `--build` half of that same v0.4.0 capture, back in this file for a
 * DIFFERENT reason than the one it was removed for.
 *
 * It was here to prove that four host checks reached the table only through a
 * second spawn; there is no second spawn any more (#544). It is here now
 * because it is the only real envelope that is BOTH pre-contract (no `scope`
 * on any check, so `LEGACY_PROJECT_CHECKS` is exercised) and carrying the
 * per-tool probes the table is built from (`git`, `python`, `cmake`, `ninja`,
 * `dtc`, `gperf`, `zephyrSdk`, `yoctoHost`, `vendorToolchain`) — i.e. an
 * envelope the toolchain-probe guard admits. The two properties are genuinely
 * independent, and this fixture is the proof: an old binary is not
 * automatically a refused one.
 */
const REAL_LEGACY_BUILD =
  require("./fixtures/tan-doctor-build.v0.4.0.windows.json").data;

/** The PURE planner, loaded for real. Two tests below drive it directly on an
 *  envelope `buildDependencyReport` now refuses, because the rule they assert
 *  ("every check tan reported is a row") is the planner's and holds regardless
 *  of whether the adapter is willing to render that particular envelope. */
const {
  planDependencyReport,
} = require("../packages/alp-core/dist/deps/planner.js");

const { pickLatestSdkTag, latestSdkCacheStale } = loadDepsAdapter();

const HOUR_MS = 60 * 60 * 1000;
/** An arbitrary fixed "now" — the predicate reads deltas, never the wall clock. */
const NOW = 1_700_000_000_000;

test("a release candidate is never offered as the latest SDK", () => {
  // GitHub's newest-first ordering, verbatim, with an rc at the head — exactly
  // the shape of the day tan-cli publishes one. `releases[0]` is the bug.
  const releases = [
    { tag: "v0.7.0-rc.1" },
    { tag: "v0.6.0" },
    { tag: "v0.5.0" },
  ];

  assert.equal(
    pickLatestSdkTag(releases),
    "v0.6.0",
    "the newest STABLE tag must win over a newer release candidate",
  );
});

test("no releases at all means no latest tag (the table shows a dash)", () => {
  assert.equal(
    pickLatestSdkTag([]),
    null,
    "an empty list must degrade to null, never to a fabricated tag",
  );
});

test("build metadata is not a pre-release", () => {
  // SemVer §9/§10: the pre-release is what follows the first `-`; `+build.7` is
  // metadata on a finished release and must not disqualify it.
  assert.equal(pickLatestSdkTag([{ tag: "v1.6.0+build.7" }]), "v1.6.0+build.7");
});

test("the latest-SDK cache is re-fetched only once it is genuinely stale", () => {
  assert.equal(
    latestSdkCacheStale(undefined, NOW),
    true,
    "nothing cached yet — the first open must fetch",
  );
  assert.equal(
    latestSdkCacheStale({ tag: "v0.6.0", fetchedAt: NOW - 11 * HOUR_MS }, NOW),
    false,
    "inside the 12 h TTL the cached answer is served, spending no GitHub request",
  );
  assert.equal(
    latestSdkCacheStale({ tag: "v0.6.0", fetchedAt: NOW - 13 * HOUR_MS }, NOW),
    true,
    "past the 12 h TTL the answer is re-fetched",
  );
  assert.equal(
    latestSdkCacheStale({ tag: "v0.6.0", fetchedAt: NOW + HOUR_MS }, NOW),
    true,
    "a stamp in the future is a clock that moved backwards — trusting it would " +
      "pin the cache until the clock caught up",
  );
  assert.equal(
    latestSdkCacheStale({ tag: "v0.6.0" }, NOW),
    true,
    "an entry written by a build that stored a different shape must not be trusted",
  );
});

// ── The report: which cells the host fills, and what it spawns ───────────────

/** A doctor envelope with one row per interesting case. Statuses are tan's own
 *  vocabulary, verbatim. `westResolved` PASSES here on purpose: a failing one
 *  is already covered by the status gate (see `ninja`), so only a passing one
 *  can prove the arm that pasted the PATH west's version onto it is gone. */
const DOCTOR_DATA = {
  checks: [
    { name: "sdk", status: "pass", detail: "alp-sdk v0.6.0" },
    { name: "west", status: "pass", detail: "west 1.5.0" },
    {
      name: "westResolved",
      status: "pass",
      detail: "west resolves in the workspace venv",
    },
    { name: "ninja", status: "fail", detail: "ninja not found" },
  ],
  summary: { pass: 3, warn: 0, fail: 1 },
};

/** The shared `AlpIdeState` slice the adapter reads — the extension's OWN probe
 *  of a machine where every tool is on PATH. */
const STATE = {
  sdk: { version: "v0.6.0" },
  setup: {
    bootstrapRunning: false,
    toolVersions: {
      tan: "0.3.1",
      west: "1.5.0",
      cmake: "3.28.3",
      ninja: "1.11.1",
    },
  },
};

/** Build a report against a fake CLI, collecting every argv (and cwd) it was
 *  asked to spawn. `workspaceRoot: null` is the no-folder-open machine; a `null`
 *  envelope stands for a run that produced nothing usable. */
async function report(
  workspaceRoot = "/home/dev/proj",
  { doctor = DOCTOR_DATA } = {},
  reportOptions = {},
) {
  const spawns = [];
  const { buildDependencyReport } = loadDepsAdapter({
    "../alpCli/doctor": {
      runDoctor: async (_context, args, cwd, _signal, interactive) => {
        spawns.push({ args, cwd, options: { interactive } });
        return { data: doctor, message: "tan produced no usable envelope" };
      },
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot, sdkRoot: null }),
      readOnlyProjectCwd: () => workspaceRoot ?? "/tmp",
    },
  });
  const result = await buildDependencyReport({}, STATE, reportOptions);
  return { ...result, spawns };
}

test("a version is shown only where tan itself says the row passes", async () => {
  const { report: built } = await report();
  const cell = (name) => built.rows.find((row) => row.name === name);

  assert.equal(
    cell("west").installed,
    "1.5.0",
    "tan says west passes, so the version the extension already probed is real",
  );
  assert.equal(
    cell("ninja").installed,
    null,
    "tan says ninja is missing — pasting a probed 1.11.1 next to 'fail / ninja " +
      "not found' is one row contradicting itself",
  );
  assert.equal(
    cell("westResolved").installed,
    null,
    "`westResolved` is a workspace-venv check, not a tool-version one: the PATH " +
      "west is a DIFFERENT binary and must never be reported as its version — " +
      "on a pre-bootstrap machine that row rendered Installed 1.5.0 beside " +
      "'west not found — run `tan bootstrap` to create the workspace venv'",
  );
});

test("the table does not wait on the latest-SDK lookup", async () => {
  const { report: built, spawns } = await report();

  assert.deepEqual(
    spawns.map((spawn) => spawn.args),
    [["doctor"]],
    "ONE doctor run, and NOTHING else. Two things at once: the live GitHub " +
      "call that fills the sdk row's 'latest' cell must not be awaited before " +
      "the rows already in hand are posted; and `--build` must not come back " +
      '(#544). It used to be `[["doctor", "--build"], ["doctor"]]`, ' +
      "pinned here BY VALUE — the flag is a documented no-op at the pin " +
      "(tan-cli#290) and the two envelopes were byte-identical apart from " +
      "`generatedAt`, so the second spawn was a subprocess per refresh for a " +
      "duplicate payload",
  );
  assert.equal(
    built.rows.find((row) => row.name === "sdk").latest,
    null,
    "the first report leaves the remote cell empty; `withLatestSdk` fills it in " +
      "a second post",
  );
});

test("a focus/settings-edit re-derive never asks tan CLI download consent", async () => {
  const { spawns } = await report();
  assert.ok(spawns.length > 0);
  for (const spawn of spawns) {
    assert.notEqual(
      spawn.options?.interactive,
      true,
      "buildDependencyReport with no `interactive` option must run both doctor " +
        "invocations non-interactively — a window-focus/settings-edit/bootstrap- " +
        "boundary re-derive must never pop ADR 0021's consent modal",
    );
  }
});

test("the Dependencies panel's explicit Refresh click DOES ask tan CLI download consent", async () => {
  const { spawns } = await report("/home/dev/proj", {}, { interactive: true });
  assert.ok(spawns.length > 0);
  for (const spawn of spawns) {
    assert.equal(
      spawn.options?.interactive,
      true,
      "`refreshDependencies` (deps/panel.ts) IS the user's Refresh click — " +
        "it must reach runDoctor interactively so a fresh tan CLI download can " +
        "show ADR 0021's consent dialog instead of being silently refused",
    );
  }
});

/** Drive the REAL `withLatestSdk` against a fake `runAlpCommand`, returning
 *  the options every `sdk list` spawn was given. A bare `globalState` (no
 *  cache entry) so the lookup always reaches the spawn regardless of `force` —
 *  `latestSdkCacheStale` reads "nothing cached" as stale either way. */
async function sdkListSpawnOptions(refreshLatestSdk) {
  const spawns = [];
  const { withLatestSdk } = loadDepsAdapter({
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_context, args, _cwd, options) => {
        spawns.push({ args, options });
        return { outcome: { ok: true, envelope: null, message: "" } };
      },
    },
  });
  const store = new Map();
  const context = {
    globalState: {
      get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
      update: async (key, value) => void store.set(key, value),
    },
  };
  await withLatestSdk(
    context,
    { rows: [{ name: "sdk", installed: null }] },
    { refreshLatestSdk },
  );
  return spawns.filter((spawn) => spawn.args.includes("list"));
}

test("withLatestSdk: a focus/settings-edit re-derive never asks tan CLI download consent on `sdk list`", async () => {
  const spawns = await sdkListSpawnOptions(false);
  assert.ok(spawns.length > 0, "the lookup must still run with nothing cached");
  for (const spawn of spawns) {
    assert.notEqual(
      spawn.options?.interactive,
      true,
      "`refreshLatestSdk: false` (a background re-derive) must not raise ADR " +
        "0021's consent dialog on the `sdk list` call",
    );
  }
});

test("withLatestSdk: the explicit Refresh click DOES ask tan CLI download consent on `sdk list`", async () => {
  const spawns = await sdkListSpawnOptions(true);
  assert.ok(spawns.length > 0);
  for (const spawn of spawns) {
    assert.equal(
      spawn.options?.interactive,
      true,
      "`refreshLatestSdk: true` IS the user's explicit Refresh click " +
        "(deps/panel.ts) and must reach `sdk list` interactively",
    );
  }
});

test("withLatestSdk: `sdk list` runs with an explicit, resolved cwd — never undefined (#605)", async () => {
  const spawns = [];
  const { withLatestSdk } = loadDepsAdapter({
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_context, args, cwd, options) => {
        spawns.push({ args, cwd, options });
        return { outcome: { ok: true, envelope: null, message: "" } };
      },
    },
    "../project/vscodeAdapter": {
      readOnlyProjectCwd: () => "/work/renesas-control",
    },
  });
  const context = {
    globalState: { get: (_k, fallback) => fallback, update: async () => {} },
  };
  await withLatestSdk(
    context,
    { rows: [{ name: "sdk", installed: null }] },
    { refreshLatestSdk: true },
  );

  const listSpawns = spawns.filter((spawn) => spawn.args.includes("list"));
  assert.ok(listSpawns.length > 0, "the lookup must still run");
  for (const spawn of listSpawns) {
    assert.equal(
      spawn.cwd,
      "/work/renesas-control",
      "an omitted cwd reaches child_process.spawn unset and the child " +
        "inherits the extension host's own directory instead of the " +
        "customer's project — `sdk` resolves a project and an SDK from cwd",
    );
  }
});

// ── #542: `ok: true` is not "I have the data" ────────────────────────────────

/** The key `latestSdkTag` stamps. Duplicated deliberately: it is a storage
 *  contract, and a test that discovered it from the code under test could not
 *  notice the code changing it. */
const LATEST_SDK_CACHE_KEY = "alp.deps.latestSdkTag";

/** Drive the REAL `withLatestSdk` against a scripted `sdk list` envelope.
 *  Returns the argv of every `sdk list` spawn, plus every globalState write —
 *  what is NOT written is the whole point of these tests. */
async function sdkListLookup({ envelope, cached }) {
  const spawns = [];
  const writes = [];
  const { withLatestSdk } = loadDepsAdapter({
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_context, args, _cwd, options) => {
        spawns.push({ args, options });
        return { outcome: { ok: true, envelope, message: "" } };
      },
    },
  });
  const store = new Map();
  if (cached) store.set(LATEST_SDK_CACHE_KEY, cached);
  const context = {
    globalState: {
      get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
      update: async (key, value) => {
        writes.push({ key, value });
        store.set(key, value);
      },
    },
  };
  const report = await withLatestSdk(
    context,
    { rows: [{ name: "sdk", installed: null }] },
    { refreshLatestSdk: true },
  );
  return {
    argv: spawns.filter((s) => s.args.includes("list")).map((s) => s.args),
    writes,
    latest: report?.rows?.find((r) => r.name === "sdk")?.latest ?? null,
  };
}

/** Measured against pinned tan 0.6.0: `tan --format json sdk list` with no
 *  `--online`. `ok: true`, exit 0, empty list, real answer in a WARNING. */
const NOT_LOOKED_UP = {
  command: "sdk",
  ok: true,
  exitCode: 0,
  data: { subcommand: "list", releases: [] },
  issues: [
    {
      code: "sdk.network-required",
      severity: "warning",
      message:
        "`sdk list` reports the Alp SDK releases published upstream on GitHub -- there is no local/offline copy to answer from. Add --online to fetch them.",
    },
  ],
};

test("`sdk list` is asked to go online — without it tan cannot answer at all", async () => {
  const { argv } = await sdkListLookup({
    envelope: {
      ok: true,
      data: { releases: [{ tag: "v0.16.0" }] },
      issues: [],
    },
  });
  assert.ok(argv.length > 0, "the lookup must reach a spawn");
  for (const args of argv) {
    assert.ok(
      args.includes("--online"),
      "`--online` is what lets `list` query the GitHub releases API. Without " +
        "it tan returns an empty list plus `sdk.network-required` and every " +
        "caller reads the empty list as an answer (#542). The sibling reader " +
        "in src/ideHub/sdkManagerMessages.ts has always passed it: " +
        JSON.stringify(args),
    );
  }
});

test("a `sdk.network-required` warning is never cached as an answer", async () => {
  const { writes, latest } = await sdkListLookup({
    envelope: NOT_LOOKED_UP,
    cached: { tag: "v0.15.0", fetchedAt: 1 },
  });

  assert.deepEqual(
    writes,
    [],
    "tan said it did not look. Caching that writes a FRESH stamp over an " +
      "absent answer, which suppresses the retry that would fix it — so the " +
      "dash persists for the whole staleness window and the failure sustains " +
      "itself. `ok: true` is not `I have the data`.",
  );
  assert.equal(
    latest?.version,
    "v0.15.0",
    "the last known answer must survive a lookup that never happened",
  );
});

test("a real empty list IS cached — absence of releases is an answer", async () => {
  const { writes } = await sdkListLookup({
    envelope: { ok: true, data: { releases: [] }, issues: [] },
  });

  assert.equal(writes.length, 1, "a lookup that reached the registry answers");
  assert.equal(writes[0].key, LATEST_SDK_CACHE_KEY);
  assert.equal(
    writes[0].value.tag,
    null,
    "no stable tag published is a real null, not a withheld one — this is " +
      "the direction that proves the guard reads the CODE and not merely the " +
      "empty list, which both cases share",
  );
});

// ── #611: sdkListAnswered (shared with src/ideHub/sdkManagerMessages.ts) ────
//
// `sdkListAnswered` lives in `../alpCli/service` (pure, no vscode import),
// not `deps/vscodeAdapter.ts` — moved there precisely so this repo's OTHER
// `sdk list` reader (`src/ideHub/sdkManagerMessages.ts`) could import it
// without pulling in the whole dependency-table adapter. Required directly
// from its real home instead of through `loadDepsAdapter()`'s re-export:
// adversarial review (#611 follow-up) found that re-export protected nothing
// (the moved symbols had zero importers outside this file at base
// `c9ddc48c`) and was deleted.
const { sdkListAnswered } = require("../out/alpCli/service.js");

test("sdkListAnswered agrees with unansweredSdkListCodes on both directions", () => {
  assert.equal(sdkListAnswered(NOT_LOOKED_UP), false);
  assert.equal(
    sdkListAnswered({ ok: true, data: { releases: [] }, issues: [] }),
    true,
  );
});

test("a release entry with no string tag does not crash the lookup — narrowSdkReleases drops it", async () => {
  const { latest } = await sdkListLookup({
    envelope: {
      ok: true,
      data: { releases: [{ tag: 12345 }, { tag: "v0.16.0" }] },
      issues: [],
    },
  });

  assert.equal(
    latest?.version,
    "v0.16.0",
    "the malformed entry must be dropped, not thrown on and not crash the " +
      "whole lookup",
  );
});

// ── A-0f: every check tan reports reaches the table ──────────────────────────

test("no allowlist stands between a check tan reported and a row", async () => {
  // A-0f was "four host checks reached no row because only `--build` ran".
  // Its fix was a SECOND spawn plus an allowlist of names the merge could take
  // from it, and #472 was that allowlist going stale in silence. Both are gone
  // (#544): one envelope, no merge, no allowlist, so the defect class cannot
  // come back — not because the list is right, but because there is no list.
  //
  // Through the ADAPTER, on a real pre-contract envelope it accepts: the
  // v0.4.0 `--build` capture. (The plain-`doctor` half of that same capture no
  // longer reaches a table at all — it carries no PATH probe, so the guard
  // refuses it; the second half of this test drives the planner on it
  // directly, which is where the no-allowlist rule lives.)
  const { report: built, spawns } = await report("/home/dev/proj", {
    doctor: REAL_LEGACY_BUILD,
  });

  assert.deepEqual(
    spawns.map((spawn) => spawn.args),
    [["doctor"]],
    "plain `tan doctor` is the run, and the only one",
  );

  const names = built.rows.map((r) => r.name);
  assert.deepEqual(
    names.slice(0, REAL_LEGACY_BUILD.checks.length),
    REAL_LEGACY_BUILD.checks.map((check) => check.name),
    "every check tan reported is a row, in tan's own order — the rule " +
      "`deps/planner.ts` states and the allowlist was the one exception to",
  );
  assert.deepEqual(
    names.slice(REAL_LEGACY_BUILD.checks.length),
    ["tan"],
    "and the ONLY row not derived from a check is the planner's own `tan` " +
      "row, which is about the binary rather than about anything it reported",
  );

  // And the PLANNER, on the plain-`doctor` envelope, because the three checks
  // the retired allowlist deliberately excluded live only there. The adapter
  // refuses this envelope now — that refusal is asserted in its own test — but
  // the rule under assertion here is the planner's, and it still holds against
  // the exact payload the allowlist would have filtered.
  const planned = planDependencyReport({
    data: REAL_LEGACY,
    bootstrapRunning: false,
    cli: { installed: "0.4.0", latest: { version: "0.6.0", kind: "pin" } },
    compareVersions: () => "behind",
  });
  const row = (name) => planned.rows.find((c) => c.name === name);

  assert.deepEqual(
    planned.rows.map((r) => r.name).slice(0, REAL_LEGACY.checks.length),
    REAL_LEGACY.checks.map((check) => check.name),
    "same rule, same order, on the envelope the allowlist was written for",
  );

  // The concrete customer: LongPathsEnabled = 0 is the stock Windows default,
  // and the build then dies in CMake complaining about a file that exists.
  assert.equal(
    row("longPaths").status,
    "pass",
    "the long-paths row carries tan's verdict verbatim — this host has it " +
      "enabled",
  );
  assert.match(
    row("longPaths").detail,
    /LongPathsEnabled = 1/,
    "with tan's own detail, registry value and all",
  );
  assert.equal(
    row("hostPrerequisites").status,
    "fail",
    "the bootstrap prerequisite gate is reported as tan rated it",
  );

  // The three the allowlist deliberately EXCLUDED, now present. Two were
  // excluded to avoid a duplicate row key across two envelopes — a problem
  // that does not exist with one — and `codeLLDBExtension` was excluded as a
  // fact tan answers `unknown`. `unknown` is an answer, and dropping the row
  // said "not a problem" about a question nobody could see was asked.
  for (const name of ["workspaceRoot", "sdkRoot", "codeLLDBExtension"]) {
    assert.ok(
      row(name),
      `${name} is a check tan reported, so it is a row — the allowlist that ` +
        "silently withheld it is gone",
    );
  }
});

test("the summary counts exactly the rows on screen, using tan's arithmetic", async () => {
  const { tallyChecks } = loadDepsAdapter();

  // First: the tally IS tan's own. Re-run over a real envelope's checks it
  // reproduces that envelope's own summary byte for byte — including tan's rule
  // that a status outside pass/warn/fail counts toward nothing
  // (`codeLLDBExtension: unknown` on 0.4.0, `setools: unknown` at the pin).
  assert.deepEqual(tallyChecks(REAL_LEGACY.checks), REAL_LEGACY.summary);
  assert.deepEqual(tallyChecks(REAL_PINNED.checks), REAL_PINNED.summary);

  const { report: built } = await report("/home/dev/proj", {
    doctor: REAL_PINNED,
  });
  // With a folder open nothing is withheld, so the header IS tan's summary.
  assert.deepEqual(built.counts, REAL_PINNED.summary);
});

// ── the orphan invariant reaches the "Alp SDK" channel, not just the type ────

test("an orphaned prerequisite is LOGGED, not only recorded on the report", async () => {
  // #603: `orphanedPrerequisites` is worthless as a silent-drop catch if
  // nothing ever reads it — the exact failure this field exists to end. A
  // prerequisite for a tool with no check AND no `hostPrerequisites` rollup
  // in this envelope has nowhere to bind.
  const orphanData = {
    checks: [
      { name: "sdk", status: "pass", detail: "alp-sdk v0.6.0" },
      { name: "west", status: "pass", detail: "west 1.5.0" },
    ],
    summary: { pass: 2, warn: 0, fail: 0 },
    missingPrerequisites: [{ tool: "cmake", command: "brew install cmake" }],
  };
  const lines = [];
  const { buildDependencyReport } = loadDepsAdapter({
    "../alpCli/doctor": {
      runDoctor: async () => ({ data: orphanData, message: "" }),
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: "/home/dev/proj",
        sdkRoot: null,
      }),
      readOnlyProjectCwd: () => "/home/dev/proj",
    },
    "../util": {
      log: (line) => lines.push(line),
      isRunActive: () => false,
      runInTerminal() {},
    },
  });

  const { report: built } = await buildDependencyReport({}, STATE, {});

  assert.deepEqual(
    built.orphanedPrerequisites,
    [{ tool: "cmake", command: "brew install cmake" }],
    "sanity: the planner's own half of the invariant still holds",
  );
  const hit = lines.find((line) => line.includes("cmake"));
  assert.ok(
    hit,
    "no log line named the orphaned prerequisite — the next tan rename of " +
      "hostPrerequisites would be exactly as silent as #603 itself",
  );
  assert.match(hit, /brew install cmake/, "the command, not just the tool");
  assert.match(hit, /hostPrerequisites/i);
});

function orphanEnvelope(tools) {
  return {
    checks: [{ name: "west", status: "pass", detail: "west 1.5.0" }],
    summary: { pass: 1, warn: 0, fail: 0 },
    missingPrerequisites: tools.map((tool) => ({
      tool,
      command: `install ${tool}`,
    })),
  };
}

test("the SAME orphan is logged ONCE per session, not once per refresh (#603 second review, minor 8)", async () => {
  // `DependencyPanel.refresh()` re-derives on EVERY window focus, and a
  // genuinely orphaned envelope stays orphaned across every one of those.
  const lines = [];
  const { buildDependencyReport } = loadDepsAdapter({
    "../alpCli/doctor": {
      runDoctor: async () => ({ data: orphanEnvelope(["cmake"]), message: "" }),
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: "/home/dev/proj",
        sdkRoot: null,
      }),
      readOnlyProjectCwd: () => "/home/dev/proj",
    },
    "../util": {
      log: (line) => lines.push(line),
      isRunActive: () => false,
      runInTerminal() {},
    },
  });

  // Three "refreshes" against the SAME loaded module instance — a window
  // focus, a settings edit, a bootstrap boundary, all re-deriving the same
  // orphaned envelope.
  await buildDependencyReport({}, STATE, {});
  await buildDependencyReport({}, STATE, {});
  await buildDependencyReport({}, STATE, {});

  const hits = lines.filter((line) => line.includes("cmake"));
  assert.equal(
    hits.length,
    1,
    "the orphan warning must fire once for the session, not once per refresh",
  );
});

test("a DIFFERENT orphan arriving later is STILL logged — the latch must not over-silence (#603 third review, major 5)", async () => {
  // Measured repro this test reproduces exactly: refresh 1 orphans cmake (1
  // line), refresh 2 orphans a DIFFERENT tool, ninja, with cmake no longer
  // orphaned (0 lines under the bug — a bare "logged once" boolean silences
  // every orphan after the first, forever), refresh 3 orphans two more new
  // tools, gperf and dtc (also 0 lines under the bug). The gate the prior
  // round shipped replayed the SAME orphan three times, which is green
  // under both this bug and the fix — this is the one that tells them apart.
  const lines = [];
  const envelopes = [
    orphanEnvelope(["cmake"]),
    orphanEnvelope(["ninja"]),
    orphanEnvelope(["gperf", "dtc"]),
  ];
  let call = 0;
  const { buildDependencyReport } = loadDepsAdapter({
    "../alpCli/doctor": {
      runDoctor: async () => ({ data: envelopes[call++], message: "" }),
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: "/home/dev/proj",
        sdkRoot: null,
      }),
      readOnlyProjectCwd: () => "/home/dev/proj",
    },
    "../util": {
      log: (line) => lines.push(line),
      isRunActive: () => false,
      runInTerminal() {},
    },
  });

  await buildDependencyReport({}, STATE, {}); // refresh 1: orphan=cmake
  await buildDependencyReport({}, STATE, {}); // refresh 2: NEW orphan=ninja
  await buildDependencyReport({}, STATE, {}); // refresh 3: orphans=gperf,dtc

  assert.equal(
    lines.filter((l) => l.includes("cmake")).length,
    1,
    "refresh 1's orphan is reported",
  );
  assert.equal(
    lines.filter((l) => l.includes("ninja")).length,
    1,
    "a NEW orphan on refresh 2 must still be reported, even though cmake " +
      "already used up a bare one-shot latch",
  );
  assert.equal(
    lines.filter((l) => l.includes("gperf")).length,
    1,
    "refresh 3's new orphans must be reported too",
  );
  assert.equal(lines.filter((l) => l.includes("dtc")).length, 1);
});

test("nothing is logged when every prerequisite bound to a row", async () => {
  const lines = [];
  const { buildDependencyReport } = loadDepsAdapter({
    "../alpCli/doctor": {
      runDoctor: async () => ({ data: DOCTOR_DATA, message: "" }),
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: "/home/dev/proj",
        sdkRoot: null,
      }),
      readOnlyProjectCwd: () => "/home/dev/proj",
    },
    "../util": {
      log: (line) => lines.push(line),
      isRunActive: () => false,
      runInTerminal() {},
    },
  });

  await buildDependencyReport({}, STATE, {});

  assert.equal(
    lines.some(
      (line) => line.includes("orphaned") || line.includes("bound to NO row"),
    ),
    false,
    "a healthy envelope must not print a defect line nobody can act on",
  );
});

// ── 0b: the panel with no project folder open ────────────────────────────────

test("with no folder open the host checks still run", async () => {
  // The ordering deadlock this breaks: the prerequisite table needed a folder,
  // the folder needed the SDK, the SDK needed git, and git was installed from
  // the prerequisite table. The published walkthrough order (installSdk →
  // project → bootstrap) gave a customer no way out, and nothing said that
  // opening any unrelated folder unlocked the table.
  const {
    report: built,
    error,
    spawns,
  } = await report(null, { doctor: REAL_PINNED });
  const row = (name) => built.rows.find((candidate) => candidate.name === name);

  assert.equal(error, undefined, "no refusal — this is a table, not a wall");
  assert.ok(built, "a report, with the host half of it filled in");
  for (const spawn of spawns) {
    assert.ok(
      spawn.cwd,
      "an explicit cwd on every spawn (#371): with none the child inherits " +
        "the extension host's own directory — on Windows the VS Code install " +
        "directory — and reports on it",
    );
  }

  // The host facts, which is the whole point: none of these reads a project,
  // and tan says so itself on every one of them.
  for (const check of REAL_PINNED.checks.filter((c) => c.scope === "host")) {
    assert.equal(
      row(check.name).status,
      check.status,
      `${check.name} is scoped \`host\` by tan and carries its real verdict ` +
        "with no folder open",
    );
  }
});

test("with no folder open a project check is withheld, and says so", async () => {
  const { report: built } = await report(null, { doctor: REAL_PINNED });
  const row = (name) => built.rows.find((candidate) => candidate.name === name);

  const projectChecks = REAL_PINNED.checks.filter(
    (check) => check.scope === "project",
  );
  assert.ok(
    projectChecks.length >= 5,
    "the fixture must actually carry project-scoped checks, or this test " +
      "asserts nothing",
  );
  for (const check of projectChecks) {
    // Reporting these would be worse than the old refusal: tan answers them
    // about whatever directory it was launched in, so a customer with no folder
    // open would read "board.yaml not found" about a temp directory.
    assert.ok(
      row(check.name),
      `${check.name} is still a row — a vanished row teaches nothing`,
    );
    assert.equal(
      row(check.name).status,
      "not checked",
      `${check.name} must not carry a verdict about a project that is not open`,
    );
    assert.match(
      row(check.name).detail,
      /no project folder is open/i,
      "and the row itself says why",
    );
    assert.equal(
      row(check.name).hint,
      null,
      "tan's remedy prose belongs to the verdict it never reached",
    );
  }

  // Two of these six — `pythonFloor` and `sdkProvenance` — were NOT in the
  // hand list this replaced. Reading tan's own `scope` is what admits them, and
  // it is why the list is a fallback rather than the source (#472).
  for (const name of ["pythonFloor", "sdkProvenance"]) {
    assert.equal(
      row(name).status,
      "not checked",
      `${name} is scoped \`project\` by tan and was absent from the retired ` +
        "hand list — a hand list of check names rots the moment tan adds one",
    );
  }

  // Summed BY STATUS off the fixture itself rather than hand-counted, so a
  // re-capture that shuffles which project checks pass/warn/fail (as the GA
  // capture already did once, relative to the rc1 one this replaced) moves
  // this assertion for free. NOT because the hand-counted form fails
  // silently — MEASURED, it does not: reverting to the old `-4/-1/-1`
  // literal REDs against this fixture (`{pass:5,warn:2,fail:0}` vs the
  // hand-counted `{pass:4,warn:2,fail:1}`) — but because that red then costs
  // a maintainer a trip back to the fixture to recompute three digits by
  // hand on every future re-capture, for no reason the derivation below
  // does not already remove.
  const withheldByStatus = { pass: 0, warn: 0, fail: 0 };
  for (const check of projectChecks) {
    if (check.status in withheldByStatus) withheldByStatus[check.status] += 1;
  }
  assert.deepEqual(
    built.counts,
    {
      pass: REAL_PINNED.summary.pass - withheldByStatus.pass,
      warn: REAL_PINNED.summary.warn - withheldByStatus.warn,
      fail: REAL_PINNED.summary.fail - withheldByStatus.fail,
    },
    `a withheld row counts as nothing — ${projectChecks.length} project checks ` +
      "carried a verdict about nowhere, and counting them would put marks in " +
      "the header for checks that never ran",
  );
});

test("a tan too old to report `scope` still withholds the project rows", async () => {
  // `alpSdk.cliPath` can point at a pre-contract binary. `isDoctorEnvelope-
  // Data` accepts its envelope on purpose — refusing it would blank the one
  // table whose `tan` row reports the skew — so the withholding decision has
  // to survive a check with no `scope` at all. `LEGACY_PROJECT_CHECKS` is that
  // fallback, and this is the only thing that exercises it.
  assert.ok(
    REAL_LEGACY_BUILD.checks.every((check) => check.scope === undefined),
    "the legacy fixture must carry no `scope`, or this asserts nothing",
  );
  const { report: built } = await report(null, { doctor: REAL_LEGACY_BUILD });
  const row = (name) => built.rows.find((candidate) => candidate.name === name);

  for (const name of ["sdk", "boardYaml", "workspace", "westResolved"]) {
    assert.equal(
      row(name).status,
      "not checked",
      `${name} reads the project on v0.4.0 too, and the fallback knows it`,
    );
  }
  for (const [name, status] of [
    ["git", "pass"],
    ["cmake", "pass"],
    ["ninja", "fail"],
  ]) {
    assert.equal(
      row(name).status,
      status,
      `${name} is a PATH probe and is NOT withheld by the fallback — a list ` +
        "that withheld everything would pass the arm above and hide the " +
        "whole table",
    );
  }
});

test("a doctor that answers nothing is an error state, not an empty table", async () => {
  const { report: built, error } = await report("/home/dev/proj", {
    doctor: null,
  });

  assert.equal(
    built,
    null,
    "the one run carries every row in the table, so losing it is losing the " +
      "table — a partial table that looked complete would be the worse answer",
  );
  assert.match(error, /no usable envelope/);
});

// ── A tan whose doctor envelope cannot build this table ──────────────────────
//
// The #544 regression this guards. dev refused when the `--build` run produced
// nothing, because "`--build` carries every PATH probe in the table, so losing
// it is losing the table". Dropping that arm dropped the refusal with it, and
// on a pre-0.5 binary reached through `alpSdk.cliPath` the plain envelope has
// NONE of those probes — so the panel rendered a confident, mostly-passing
// table with no row for the nine tools it exists to report.
//
// Both states below are real. They are the two the review ran to prove the
// defect, and neither was covered before.

test("a tan whose doctor reports no host tool at all is refused, with a folder open", async () => {
  const { report: built, error } = await report("/home/dev/proj", {
    doctor: REAL_LEGACY,
  });

  // What the un-guarded code produced: 12 rows + `tan`, and not one of these.
  const missing = [
    "git",
    "python",
    "cmake",
    "ninja",
    "dtc",
    "gperf",
    "zephyrSdk",
    "yoctoHost",
    "vendorToolchain",
  ];
  assert.deepEqual(
    REAL_LEGACY.checks.filter((check) => missing.includes(check.name)),
    [],
    "the fixture must genuinely carry none of the nine, or this test is " +
      "asserting against an envelope that was never the problem",
  );

  assert.equal(
    built,
    null,
    "nine tool rows silently absent from a table whose whole subject is " +
      "those tools reads as `all fine`, not as `not asked` — the same " +
      "judgement dev's deleted `--build` guard made, on the one envelope " +
      "there is now",
  );
  assert.match(
    error,
    /no host tool checks at all/,
    "the refusal must name the CAUSE, not just decline",
  );
  assert.match(
    error,
    /Reinstall the pinned tan CLI/,
    "and the way out, by the name it carries in the command palette",
  );
  assert.match(
    error,
    /alpSdk\.cliPath/,
    "including the setting that is how a binary this old gets resolved in " +
      "the first place",
  );
  assert.match(
    error,
    /0\.3\.1/,
    "the version the extension already probed sharpens the sentence — it is " +
      "not what DECIDES (see `carriesToolchainProbes`), but withholding it " +
      "would leave the reader guessing which binary is meant",
  );
});

test("the same tan with NO folder open is refused too, rather than reporting on os.tmpdir()", async () => {
  const { report: built, error } = await report(null, { doctor: REAL_LEGACY });

  // The extra damage in this state, on top of the nine missing rows: tan was
  // launched in `os.tmpdir()`, and these two carry no `scope`, so the legacy
  // hand list — which never named them — lets them through un-withheld.
  for (const name of ["workspaceRoot", "sdkRoot"]) {
    assert.ok(
      REAL_LEGACY.checks.some((check) => check.name === name),
      `${name} must be in the fixture, or this test asserts nothing`,
    );
  }
  assert.equal(
    built,
    null,
    "`workspaceRoot pass C:/tmp/no-project` and `sdkRoot fail No alp-sdk " +
      "checkout resolved.` are verdicts about a temp directory, rendered " +
      "live beside six rows that say `No project folder is open` — and the " +
      "red one can contradict the extension's own host-known SDK state",
  );
  assert.match(error, /no host tool checks at all/);
});

test("the guard does not fire on an envelope that DOES carry the probes", async () => {
  // A false refusal blanks the table, which is the same damage in the other
  // direction. Both directions, on real captured envelopes.
  for (const [label, doctor] of [
    ["the pinned binary", REAL_PINNED],
    ["a v0.4.0 `--build` envelope", REAL_LEGACY_BUILD],
  ]) {
    for (const root of ["/home/dev/proj", null]) {
      const { report: built, error } = await report(root, { doctor });
      assert.ok(
        built,
        `${label} carries per-tool probes, so it must render — refusing it ` +
          `would be the guard firing on the wrong thing (${error})`,
      );
    }
  }
});

// ── A-0g: a winget install leaves a stale PATH ───────────────────────────────

test("a terminal install says what actually makes the row go green", async () => {
  // A TASK now, not a bare terminal (#466 §2): the same shell line, but the
  // run reports an exit code and holds a reservation, which is what a
  // sequential Fix all waits on. The assertions below are the same claims they
  // always were — the line goes to the shell verbatim, the cwd is the
  // caller's — read off `runInTerminal`'s options instead of a terminal's.
  const runs = [];
  const plans = [];
  const { runDependencyAction } = loadDepsAdapter({
    vscode: { window: {}, Uri: {} },
    "../util": {
      log() {},
      runInTerminal: (opts) => runs.push(opts),
      isRunActive: () => false,
      awaitRun: () => Promise.resolve(0),
    },
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => plans.push(plan),
    },
  });

  runDependencyAction({
    action: {
      kind: "command",
      // tan 0.4.0's own `missingPrerequisites[].command` on this Windows host,
      // verbatim.
      commands: [
        {
          tool: "ninja",
          command: "winget install -e --id Ninja-build.Ninja",
        },
      ],
      effect: "install",
      title: "winget install -e --id Ninja-build.Ninja",
    },
    rowName: "ninja",
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });

  assert.deepEqual(
    runs.map((run) => run.command),
    ["winget install -e --id Ninja-build.Ninja"],
    "the shell LINE reaches the shell verbatim — a ShellExecution, never an " +
      "argv split that would mangle a quoted argument",
  );
  assert.equal(
    runs[0].argv,
    undefined,
    "argv and command are mutually exclusive; passing both is a bug the type " +
      "forbids and this pins at runtime",
  );
  assert.equal(
    runs[0].cwd,
    "/home/dev/proj",
    // `rowName` and `cwd` are both plain strings — an options object, not
    // positional parameters, is what makes a swap between them fail to
    // type-check instead of passing silently.
    "the generic path's cwd is the caller's, unretargeted",
  );
  assert.equal(
    plans.length,
    1,
    "winget installs onto the MACHINE's PATH; the extension host inherited its " +
      "environment at launch, so the row the customer just fixed still reads " +
      "`fail / ninja not found` and nothing on screen said why",
  );
  // NO reload button. A reload re-forks the extension host from a main process
  // whose environment was captured at launch — VS Code skips shell-environment
  // resolution on Windows entirely — so it inherits the same stale PATH and
  // cannot turn the row green. Offering it would be a wrong diagnosis with a
  // button attached, and pressing it mid-install disposes the terminal.
  assert.equal(
    (plans[0].actions ?? []).some((action) => action.id === "reloadWindow"),
    false,
    "a reload cannot pick up a new PATH, so it must not be offered as if it can",
  );
  assert.equal(plans[0].severity, "info", "an offer, not a failure");
  assert.match(
    plans[0].message,
    /refresh/i,
    "Refresh is the step that usually works: winget's shim lands in a " +
      "directory that was already on PATH when the editor started",
  );
  assert.match(
    plans[0].message,
    /close VS Code completely|reopen/i,
    "and when Refresh is not enough, only a full restart picks up a new PATH",
  );
  assert.equal(
    /reload the window|only picks up a new PATH on reload/i.test(
      plans[0].message,
    ),
    false,
    "the sentence must not promise a reload that cannot deliver",
  );
  assert.ok(
    plans[0].dedupeKey,
    "three Install presses must not stack three toasts",
  );
});

test("a second press while the install run is already active: surfaced via runInTerminal, not silent", async () => {
  // A regression this file exists to pin down: the per-step `isRunActive`
  // guard must not become a SILENT stop. `runInTerminal` (src/util.ts) is the
  // one place that already shows "is still running — wait for it to finish"
  // + Show Terminal for a same-named collision, so the loop must still call
  // it (stubbed here, same as the zephyrSdk concurrent-press test below)
  // rather than bypassing it with a bare log line nobody sees.
  const runs = [];
  const plans = [];
  const { runDependencyAction } = loadDepsAdapter({
    vscode: { window: {}, Uri: {} },
    "../util": {
      log() {},
      runInTerminal: (opts) => runs.push(opts),
      isRunActive: () => true,
      awaitRun: () => Promise.resolve(0),
    },
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => plans.push(plan),
    },
  });

  const outcomes = await runDependencyAction({
    action: {
      kind: "command",
      commands: [{ tool: "ninja", command: "brew install ninja" }],
      effect: "install",
      title: "brew install ninja",
    },
    rowName: "ninja",
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });

  assert.deepEqual(
    outcomes,
    [],
    "nothing dispatched successfully — the row installed nothing",
  );
  assert.equal(
    runs.length,
    1,
    "runInTerminal is still called — it is what shows the refusal " +
      '("is still running — wait for it to finish before starting it ' +
      'again.") and offers Show Terminal; on dev this call is what the ' +
      "customer saw and losing it is a silent regression",
  );
  assert.equal(
    plans.length,
    0,
    "no press-Refresh notice for a press that dispatched nothing — raising " +
      "it here would ALSO suppress the still-running press's own notice via " +
      'the shared "deps-install-reload" dedupe key, leaving the customer ' +
      "with neither",
  );
  // #603, second review, major 4: the refusal dispatch must reserve the SAME
  // shared name the `isRunActive` check just tested — `"Alp: install
  // dependency"`, never the row's own name (`rowName`, "ninja" here). This
  // harness's `isRunActive: () => true` cannot itself distinguish the two
  // (it ignores its argument), so the wrong name would slip through every
  // OTHER assertion in this test unnoticed: in production `isRunActive("ninja")`
  // is false, so a `runInTerminal` call under that name would actually START
  // a real, unreserved second install — the exact #146 double-run the shared
  // name exists to prevent.
  assert.equal(
    runs[0].name,
    "Alp: install dependency",
    "the refusal must be dispatched under the SHARED run name, not the row's own",
  );
  assert.equal(
    runs[0].command,
    "brew install ninja",
    "the command line itself is still the one that was refused, verbatim",
  );
});

test(
  "isRunActive already true never reaches awaitRun — a HANG-DETECTION test, distinct from its sibling above",
  { timeout: 2000 },
  async () => {
    // #603, second review, nit 11: this test's unique value over "a second
    // press while the install run is already active" (above) is specifically
    // that `awaitRun` here NEVER resolves — that sibling's `awaitRun` stub
    // resolves immediately, so it cannot tell "the guard stopped this before
    // awaitRun" apart from "awaitRun was called and happened to resolve
    // fast". If the mid-loop `isRunActive` check were ever removed (or
    // defeated), this dispatches straight to `awaitRun` on a name whose
    // promise never settles, and the bounded test timeout above is what
    // turns THAT into a reported failure instead of a hung test run.
    // `awaitRun`'s own doc (src/util.ts) names exactly this as its one
    // failure mode.
    const runs = [];
    const { runDependencyAction } = loadDepsAdapter({
      vscode: { window: {}, Uri: {} },
      "../util": {
        log() {},
        runInTerminal: (opts) => runs.push(opts),
        isRunActive: () => true,
        awaitRun: () => new Promise(() => {}), // never resolves
      },
    });

    const outcomes = await runDependencyAction({
      action: {
        kind: "command",
        commands: [{ tool: "ninja", command: "brew install ninja" }],
        effect: "install",
        title: "",
      },
      rowName: "ninja",
      cwd: "/home/dev/proj",
      sevenZipStatus: undefined,
    });

    assert.deepEqual(outcomes, []);
    // Distinct from the sibling's assertions too: it never inspects `runs`.
    assert.equal(
      runs.length,
      1,
      "the refusal still dispatches through runInTerminal exactly once, " +
        "and never reaches a second awaitRun call",
    );
  },
);

// ── #412: `west sdk install …` retargeted onto the resolved venv binary ─────

/** tan v0.4.1's own `missingPrerequisites[].command` for the `zephyrSdk` row,
 *  verbatim. */
const ZEPHYR_SDK_ACTION = {
  kind: "command",
  commands: [
    {
      tool: "zephyrSdk",
      command: "west sdk install --version 1.0.1 -t arm-zephyr-eabi",
    },
  ],
  effect: "install",
  title: "west sdk install --version 1.0.1 -t arm-zephyr-eabi",
};

/** Synthetic proxy env additions — distinct dummy keys/values so a test can
 *  tell "the real proxyEnvAdditions() ran and its result reached runInTerminal"
 *  from "env was silently dropped or hardcoded". */
const FAKE_PROXY_ENV = { HTTP_PROXY: "http://proxy.example:8080" };

/** A `zephyrSdk`-branch harness: a resolved topdir, a resolved venv `west`
 *  inside it, `runInTerminal` and `notifyAsync` both captured. `running`
 *  stands in for a concurrent press already occupying the run name. */
function loadZephyrSdkHarness(running = false) {
  const calls = [];
  const plans = [];
  const { runDependencyAction } = loadDepsAdapter({
    "../util": {
      log() {},
      runInTerminal: (opts) => calls.push(opts),
      isRunActive: () => running,
    },
    "../alpCli/vscodeAdapter": {
      proxyEnvAdditions: () => FAKE_PROXY_ENV,
    },
    "../notify/vscodeAdapter": { notifyAsync: (plan) => plans.push(plan) },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        westCwd: "/home/dev/proj",
        sdkRoot: "/home/dev/.alp/sdk/v0.13.0",
      }),
    },
    "../environment/vscodeAdapter": {
      westWorkspaceTopdir: () => "/home/dev/.alp",
      venvWestInTopdir: (topdir) => `${topdir}/.venv/bin/west`,
    },
  });
  return { calls, plans, runDependencyAction };
}

test("the zephyrSdk row dispatches argv through runInTerminal, from the resolved topdir, with the proxy env", () => {
  const { calls, plans, runDependencyAction } = loadZephyrSdkHarness();

  runDependencyAction({
    action: ZEPHYR_SDK_ACTION,
    rowName: "zephyrSdk",
    cwd: "/home/dev/proj",
    sevenZipStatus: "pass",
  });

  assert.equal(
    calls.length,
    1,
    "west sdk install dispatches via runInTerminal (argv, no shell), not sendText",
  );
  assert.equal(
    calls[0].name,
    "Alp: install Zephyr SDK",
    "a name distinct from the generic install path — a winget terminal " +
      "sharing the name would let a refusal's Show Terminal reveal the wrong one",
  );
  assert.deepEqual(calls[0].argv, [
    "/home/dev/.alp/.venv/bin/west",
    "sdk",
    "install",
    "--version",
    "1.0.1",
    "-t",
    "arm-zephyr-eabi",
  ]);
  assert.equal(
    calls[0].cwd,
    "/home/dev/.alp",
    "west needs the workspace TOPDIR, not the open project's cwd",
  );
  assert.deepEqual(
    calls[0].env,
    FAKE_PROXY_ENV,
    "this is the one west run that downloads a gigabyte-class archive, and " +
      "every other network-bound child process already carries proxyEnvAdditions()",
  );
  assert.equal(plans.length, 1, "a press-Refresh notice after dispatch");
  assert.equal(
    plans[0].severity,
    "info",
    "sevenZip passed: nothing to warn about",
  );
  assert.match(plans[0].message, /refresh/i);
  assert.doesNotMatch(
    plans[0].message,
    /7-Zip/,
    "the extractor caveat only appears when tan's own sevenZip check is not pass",
  );
});

test(
  "win32 + tan's sevenZip check not pass: the extractor sentence reaches the notice",
  {
    skip:
      process.platform !== "win32" &&
      "the 7-Zip caveat is win32-only by design; nothing to assert elsewhere",
  },
  () => {
    const { plans, runDependencyAction } = loadZephyrSdkHarness();

    runDependencyAction({
      action: ZEPHYR_SDK_ACTION,
      rowName: "zephyrSdk",
      cwd: "/home/dev/proj",
      sevenZipStatus: "warn",
    });

    assert.equal(plans.length, 1);
    assert.equal(plans[0].severity, "warning");
    assert.match(plans[0].message, /7-Zip/);
    assert.match(plans[0].message, /7z \/ 7za \/ 7zr \/ 7zz \/ 7zzs \/ unar/);
  },
);

test("tan's sevenZip check at pass: no extractor sentence reaches the notice, on any host", () => {
  const { plans, runDependencyAction } = loadZephyrSdkHarness();

  runDependencyAction({
    action: ZEPHYR_SDK_ACTION,
    rowName: "zephyrSdk",
    cwd: "/home/dev/proj",
    sevenZipStatus: "pass",
  });

  assert.equal(plans.length, 1);
  assert.doesNotMatch(plans[0].message, /7-Zip/);
});

test("a concurrent zephyrSdk press: runInTerminal owns the refusal, no press-Refresh notice on top", () => {
  const { calls, plans, runDependencyAction } = loadZephyrSdkHarness(
    /* running */ true,
  );

  runDependencyAction({
    action: ZEPHYR_SDK_ACTION,
    rowName: "zephyrSdk",
    cwd: "/home/dev/proj",
    sevenZipStatus: "pass",
  });

  assert.equal(
    calls.length,
    1,
    "still dispatches — runInTerminal itself is what refuses a same-named " +
      "concurrent run and tells the customer why",
  );
  assert.equal(
    plans.length,
    0,
    "a second notice on top would read as if a NEW install just started",
  );
});

test("no west workspace at all: no terminal, a precondition pointing at Bootstrap", () => {
  const calls = [];
  const plans = [];
  const { runDependencyAction } = loadDepsAdapter({
    "../util": {
      log() {},
      runInTerminal: (opts) => calls.push(opts),
    },
    "../notify/vscodeAdapter": { notifyAsync: (plan) => plans.push(plan) },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ westCwd: null, sdkRoot: null }),
    },
    "../environment/vscodeAdapter": {
      westWorkspaceTopdir: () => null,
      venvWestInTopdir: () => {
        throw new Error("must not be called when no topdir resolved");
      },
    },
  });

  runDependencyAction({
    action: ZEPHYR_SDK_ACTION,
    rowName: "zephyrSdk",
    cwd: undefined,
    sevenZipStatus: undefined,
  });

  assert.equal(
    calls.length,
    0,
    "`west sdk install` cannot succeed with no west workspace — opening a " +
      "terminal only relocates the dead end",
  );
  assert.equal(plans.length, 1);
  assert.equal(plans[0].severity, "warning", "a precondition, never `info`");
  assert.match(plans[0].message, /bootstrap/i);
  assert.ok(
    (plans[0].actions ?? []).some((action) => action.id === "bootstrap"),
    "one click to the fix, not a name-only mention",
  );
  assert.ok(plans[0].dedupeKey);
});

test("a topdir resolves but its venv has no west: refused, warning severity, Bootstrap offered", () => {
  const calls = [];
  const plans = [];
  const { runDependencyAction } = loadDepsAdapter({
    "../util": {
      log() {},
      runInTerminal: (opts) => calls.push(opts),
    },
    "../notify/vscodeAdapter": { notifyAsync: (plan) => plans.push(plan) },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        westCwd: "/home/dev/proj",
        sdkRoot: null,
      }),
    },
    "../environment/vscodeAdapter": {
      // The #349 mixed state: a topdir resolves (an ambient $ZEPHYR_BASE, or a
      // bare `.west/config` ancestor) but nothing bootstrapped a venv under it.
      westWorkspaceTopdir: () => "/home/dev/proj",
      venvWestInTopdir: () => null,
    },
  });

  runDependencyAction({
    action: ZEPHYR_SDK_ACTION,
    rowName: "zephyrSdk",
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });

  assert.equal(
    calls.length,
    0,
    "no terminal opens on a byte-identical command",
  );
  assert.equal(plans.length, 1);
  assert.equal(
    plans[0].severity,
    "warning",
    "a setup gap, not a fault — matches planPrecondition's own rule",
  );
  assert.ok(
    (plans[0].actions ?? []).some((action) => action.id === "bootstrap"),
  );
  assert.match(plans[0].message, /venv/i);
  assert.notEqual(
    plans[0].dedupeKey,
    "deps-zephyr-sdk-no-workspace",
    "distinct from the no-topdir-at-all case: a different notice must not be deduped against it",
  );
});

test("a zephyrSdk command that cannot be retargeted falls back to the topdir, not the open project's cwd", () => {
  const runs = [];
  const { runDependencyAction } = loadDepsAdapter({
    vscode: { window: {}, Uri: {} },
    "../util": {
      log() {},
      runInTerminal: (opts) => runs.push(opts),
      isRunActive: () => false,
    },
    "../notify/vscodeAdapter": { notifyAsync() {} },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        westCwd: "/home/dev/proj",
        sdkRoot: "/home/dev/.alp/sdk/v0.13.0",
      }),
    },
    "../environment/vscodeAdapter": {
      westWorkspaceTopdir: () => "/home/dev/.alp",
      venvWestInTopdir: (topdir) => `${topdir}/.venv/bin/west`,
    },
  });

  runDependencyAction({
    action: {
      kind: "command",
      // A shape `retargetWestCommand` refuses (a quoted argument) — never
      // actually reachable on the measured v0.4.1 command, but drift
      // insurance: it must fail in exactly ONE way, not two.
      commands: [
        { tool: "zephyrSdk", command: 'west sdk install --name "custom sdk"' },
      ],
      effect: "install",
      title: 'west sdk install --name "custom sdk"',
    },
    rowName: "zephyrSdk",
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });

  assert.deepEqual(
    runs.map((run) => run.command),
    ['west sdk install --name "custom sdk"'],
    "the quoted argument survives — the whole reason this path is a shell " +
      "line and not an argv array",
  );
  assert.equal(
    runs[0].cwd,
    "/home/dev/.alp",
    "still `west sdk install` — it still needs the west workspace topdir, " +
      "not the open project folder, even un-retargeted",
  );
});

test("the SAME un-retargeted fallback, refused by an active install run: no false press-Refresh notice", () => {
  // #603, second review, major 5: this fallback (`runInNewTerminal`, reached
  // when `retargetWestCommand` returns null) is byte-for-byte the antipattern
  // fixed for the generic command-step loop in the SAME commit — unconditional
  // `runInTerminal` + `offerReloadAfterInstall()` — and it survived untouched
  // because the fix was scoped to a prose finding list rather than grepped
  // for the shape. Driven exactly as the finding measured: `isRunActive("Alp:
  // install dependency")` already true.
  const runs = [];
  const plans = [];
  const { runDependencyAction } = loadDepsAdapter({
    vscode: { window: {}, Uri: {} },
    "../util": {
      log() {},
      runInTerminal: (opts) => runs.push(opts),
      isRunActive: () => true,
    },
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => plans.push(plan),
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        westCwd: "/home/dev/proj",
        sdkRoot: "/home/dev/.alp/sdk/v0.13.0",
      }),
    },
    "../environment/vscodeAdapter": {
      westWorkspaceTopdir: () => "/home/dev/.alp",
      venvWestInTopdir: (topdir) => `${topdir}/.venv/bin/west`,
    },
  });

  runDependencyAction({
    action: {
      kind: "command",
      commands: [
        { tool: "zephyrSdk", command: 'west sdk install --name "custom sdk"' },
      ],
      effect: "install",
      title: 'west sdk install --name "custom sdk"',
    },
    rowName: "zephyrSdk",
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });

  // `runInTerminal` still gets called — it is what shows the customer the
  // refusal, unchanged from before this fix.
  assert.equal(runs.length, 1);
  assert.equal(
    plans.length,
    0,
    "measured on dev before this fix: 1 notice fired here " +
      '(dedupeKey "deps-install-reload") for a dispatch runInTerminal ' +
      "refuses — this is the false press-Refresh notice",
  );
});

test("a non-zephyrSdk row carrying a west command is not hijacked", () => {
  const runs = [];
  const { runDependencyAction } = loadDepsAdapter({
    vscode: { window: {}, Uri: {} },
    "../util": {
      log() {},
      runInTerminal: (opts) => runs.push(opts),
      isRunActive: () => false,
      awaitRun: () => Promise.resolve(0),
    },
    // No override for "../project/vscodeAdapter" or "../environment/
    // vscodeAdapter": if the zephyrSdk branch fired by mistake for this row,
    // `collectProjectContext` (stubbed to `{}` by default) would throw "is not
    // a function" and fail this test loudly.
  });

  runDependencyAction({
    action: {
      kind: "command",
      // `workspace`/`westResolved` also carry a `west …` command via
      // `missingPrerequisites` (FIX_IDS in the planner) — only the `zephyrSdk`
      // ROW gets retargeted.
      commands: [{ tool: "workspace", command: "west update" }],
      effect: "install",
      title: "west update",
    },
    rowName: "workspace",
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });

  assert.deepEqual(
    runs.map((run) => run.command),
    ["west update"],
    "the command reaches the plain install dispatch untouched",
  );
});

test("an open-docs fix offers no PATH notice", async () => {
  const plans = [];
  const fixes = [];
  const { runDependencyAction } = loadDepsAdapter({
    "../notify/vscodeAdapter": { notifyAsync: (plan) => plans.push(plan) },
    "../toolchain": { runToolchainFix: (id) => fixes.push(id) },
  });

  runDependencyAction({
    action: { kind: "fix", fixId: "zephyr-sdk" },
    rowName: "zephyrSdk",
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });

  assert.deepEqual(fixes, ["zephyr-sdk"]);
  assert.deepEqual(
    plans,
    [],
    "the `zephyr-sdk` fix opens a web page and installs nothing, so there is " +
      "no new PATH to pick up and the notice would be noise. NOT true of every " +
      "`fix` id: on Windows the `west` fix is a real `pip install --user`, " +
      "which does write a PATH entry and gets no notice either — reachable " +
      "only against a pre-v0.4.0 binary via `alpSdk.cliPath`",
  );
});

// ── The panel: what reaches the view, and what re-spawns a doctor ────────────

/** Let every pending microtask and one macrotask turn settle. */
const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

/**
 * Mount the REAL `DependencyPanel` over a fake webview panel and a fake state
 * manager, with `./vscodeAdapter` replaced by the two calls it makes. Returns
 * the posts the view received, the calls the panel made, and the handles to
 * drive it: `ready()`, `stateChanged()`, `show()` / `hide()`.
 */
function mountPanel({ build, latest }) {
  const posts = [];
  const calls = { build: 0, latest: 0 };
  let onMessage = () => {};
  let onDispose = () => {};
  let onViewState = () => {};
  const panel = {
    visible: true,
    webview: {
      html: "",
      onDidReceiveMessage(handler) {
        onMessage = handler;
        return { dispose() {} };
      },
      postMessage(message) {
        posts.push(message);
        return Promise.resolve(true);
      },
    },
    reveal() {},
    dispose() {
      onDispose();
    },
    onDidDispose(handler) {
      onDispose = handler;
      return { dispose() {} };
    },
    onDidChangeViewState(handler) {
      onViewState = handler;
      return { dispose() {} };
    },
  };

  const { DependencyPanel } = loadWithStubs("deps/panel.js", {
    vscode: {
      window: { createWebviewPanel: () => panel },
      ViewColumn: { Active: 1 },
      Uri: { joinPath: () => ({}), parse: (value) => value },
      env: { openExternal: async () => true },
    },
    "../environment/vscodeAdapter": { danglingWestManifest: () => null },
    "../ideHub/webviewHtml": { buildWebviewHtml: () => "<html></html>" },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: "/home/dev/proj",
        sdkRoot: null,
      }),
    },
    "../toolchain": { offerBootstrapFix: async () => {} },
    "../util": { log() {} },
    "./vscodeAdapter": {
      buildDependencyReport: (...args) => {
        calls.build += 1;
        return build(...args);
      },
      withLatestSdk: (...args) => {
        calls.latest += 1;
        return latest ? latest(...args) : Promise.resolve(null);
      },
      runDependencyAction() {},
    },
  });

  let stateChanged = () => {};
  const stateMgr = {
    state: STATE,
    onStateChange(handler) {
      stateChanged = handler;
      return { dispose() {} };
    },
  };
  DependencyPanel.open({ extensionUri: {} }, stateMgr);

  return {
    posts,
    calls,
    ready: () => onMessage({ type: "ready" }),
    stateChanged: () => stateChanged(),
    show: () => {
      panel.visible = true;
      onViewState();
    },
    hide: () => {
      panel.visible = false;
      onViewState();
    },
    // Clears the module-level singleton, so the next test mounts a fresh panel.
    close: () => panel.dispose(),
  };
}

/** The planned report, as `buildDependencyReport` hands it over. */
const PLANNED = { rows: [{ name: "sdk", installed: "v0.6.0", latest: null }] };

test("the table is posted before the latest-SDK lookup answers", async () => {
  // The lookup that fills ONE cell never settles here — a hung unauthenticated
  // GitHub call, which the pin gives no HTTP timeout and tan caps at 60 s.
  let fillIn = () => {};
  const pending = new Promise((resolve) => {
    fillIn = resolve;
  });
  const panel = mountPanel({
    build: async () => ({ report: PLANNED }),
    latest: () => pending,
  });

  panel.ready();
  await flush();

  assert.equal(
    panel.posts.length,
    1,
    "the rows already in hand must reach the view while the remote cell is " +
      "still outstanding — not after it",
  );
  assert.equal(panel.posts[0].report, PLANNED);

  fillIn({ rows: [{ name: "sdk", latest: { version: "v0.7.0" } }] });
  await flush();

  assert.equal(
    panel.posts.length,
    2,
    "the filled cell arrives as a second post",
  );
  assert.equal(panel.posts[1].report.rows[0].latest.version, "v0.7.0");
  panel.close();
});

test("a failed refresh posts an error state instead of hanging on 'Running checks…'", async () => {
  const panel = mountPanel({
    build: async () => {
      throw new Error("EPERM: operation not permitted");
    },
  });

  panel.ready();
  await flush();

  assert.equal(panel.posts.length, 1, "the view must be told, always");
  assert.equal(panel.posts[0].report, null);
  assert.match(
    panel.posts[0].error,
    /did not finish/i,
    "an honest error state — the view keeps Refresh disabled until a report " +
      "arrives, so a swallowed rejection strands the panel forever",
  );
  panel.close();
});

test("a window teardown cancellation posts nothing at all", async () => {
  const canceled = new Error("Canceled");
  canceled.name = "Canceled";
  const panel = mountPanel({
    build: async () => {
      throw canceled;
    },
  });

  panel.ready();
  await flush();

  assert.deepEqual(
    panel.posts,
    [],
    "the window went away — that is not a failure and must not be dressed up " +
      "as one in the customer's channel",
  );
  panel.close();
});

test("a hidden panel does not re-spawn a doctor on every window focus", async () => {
  const panel = mountPanel({ build: async () => ({ report: PLANNED }) });
  panel.ready();
  await flush();
  assert.equal(panel.calls.build, 1);

  panel.hide();
  panel.stateChanged();
  panel.stateChanged();
  await flush();
  assert.equal(
    panel.calls.build,
    1,
    "`retainContextWhenHidden` keeps this panel alive while hidden — the state " +
      "manager fires on every window focus, and each one was a `tan doctor " +
      "--build` process for a table nobody was looking at",
  );

  panel.show();
  await flush();
  assert.equal(
    panel.calls.build,
    2,
    "and exactly one catch-up when the tab comes back",
  );

  panel.show();
  await flush();
  assert.equal(
    panel.calls.build,
    2,
    "a second view-state event with nothing missed re-spawns nothing",
  );
  panel.close();
});
