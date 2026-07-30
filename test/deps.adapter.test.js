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
    "../notify/vscodeAdapter": { notifyAsync() {} },
    "../project/vscodeAdapter": {},
    "../toolchain": {},
    "../util": { log() {} },
    ...overrides,
  });
}

/**
 * The two doctor envelopes a REAL `tan 0.4.0` printed on a Windows 11 host,
 * captured with `tan doctor --format json` and `tan doctor --build --format
 * json` and committed verbatim except for two redactions: the home directory's
 * account name and the temp directory the no-project run was launched in.
 *
 * They are here because the split this file asserts is a claim about tan, not
 * about a stub: that four host checks — `longPaths`, `homePath`,
 * `zephyrSdkHost`, `hostPrerequisites` — exist ONLY on plain `doctor`, and that
 * `--build` alone can therefore never report them. tan says so in
 * `doctor.rs`'s `append_host_environment` ("`--build` deliberately does NOT get
 * them"); these files are that sentence, measured.
 */
const REAL_PLAIN = require("./fixtures/tan-doctor.v0.4.0.windows.json").data;
const REAL_BUILD =
  require("./fixtures/tan-doctor-build.v0.4.0.windows.json").data;

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

/** The plain-`doctor` half, minimal, for the tests that only care about `--build`
 *  cells. The real captured one is `REAL_PLAIN`. */
const PLAIN_DATA = {
  checks: [
    { name: "longPaths", status: "pass", detail: "long paths are enabled" },
  ],
  summary: { pass: 1, warn: 0, fail: 0 },
};

/** Build a report against a fake CLI, collecting every argv (and cwd) it was
 *  asked to spawn. `workspaceRoot: null` is the no-folder-open machine; a `null`
 *  envelope stands for a run that produced nothing usable. */
async function report(
  workspaceRoot = "/home/dev/proj",
  { build = DOCTOR_DATA, plain = PLAIN_DATA } = {},
) {
  const spawns = [];
  const { buildDependencyReport } = loadDepsAdapter({
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_context, args, cwd) => {
        spawns.push({ args, cwd });
        const data = args.includes("--build") ? build : plain;
        return {
          outcome: {
            ok: true,
            message: "tan produced no usable envelope",
            envelope: data ? { ok: true, data } : undefined,
          },
        };
      },
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot, sdkRoot: null }),
    },
  });
  const result = await buildDependencyReport({}, STATE);
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
    [["doctor", "--build"], ["doctor"]],
    "the two doctor runs, and NOTHING else — the live GitHub call that fills " +
      "the sdk row's 'latest' cell must not be awaited before the rows already " +
      "in hand are posted",
  );
  assert.equal(
    built.rows.find((row) => row.name === "sdk").latest,
    null,
    "the first report leaves the remote cell empty; `withLatestSdk` fills it in " +
      "a second post",
  );
});

// ── A-0f: the four checks that live on PLAIN `tan doctor` only ───────────────

test("the host checks tan puts on plain `doctor` reach the table", async () => {
  // Measured on a real tan 0.4.0 (the pin) on Windows 11, not asserted from a
  // stub: `--build` emits 14 checks and NOT ONE of these four is among them.
  const buildOnly = new Set(REAL_BUILD.checks.map((check) => check.name));
  for (const name of [
    "longPaths",
    "homePath",
    "zephyrSdkHost",
    "hostPrerequisites",
  ]) {
    assert.equal(
      buildOnly.has(name),
      false,
      `${name} is absent from \`tan doctor --build\` — running only --build is ` +
        "structurally blind to it, which is why the panel had no row for it",
    );
  }

  const { report: built, spawns } = await report("/home/dev/proj", {
    build: REAL_BUILD,
    plain: REAL_PLAIN,
  });
  const row = (name) => built.rows.find((candidate) => candidate.name === name);

  assert.ok(
    spawns.some(
      (spawn) => spawn.args.length === 1 && spawn.args[0] === "doctor",
    ),
    "plain `tan doctor` must actually be run — before this it never was, " +
      "anywhere in the extension",
  );
  // The concrete customer: LongPathsEnabled = 0 is the stock Windows default,
  // and the build then dies in CMake complaining about a file that exists.
  assert.ok(row("longPaths"), "the long-paths row exists");
  assert.equal(
    row("longPaths").status,
    "pass",
    "and carries tan's verdict verbatim — this host has it enabled",
  );
  assert.match(
    row("longPaths").detail,
    /LongPathsEnabled = 1/,
    "with tan's own detail, registry value and all",
  );
  assert.ok(row("homePath"), "the home-directory row exists");
  assert.ok(row("zephyrSdkHost"), "the Zephyr-SDK-host-support row exists");
  assert.equal(
    row("hostPrerequisites").status,
    "fail",
    "the bootstrap prerequisite gate is reported as tan rated it",
  );
});

test("the two runs' rows are not merged into each other", async () => {
  const { report: built } = await report("/home/dev/proj", {
    build: REAL_BUILD,
    plain: REAL_PLAIN,
  });
  const names = built.rows.map((row) => row.name);

  assert.equal(
    new Set(names).size,
    names.length,
    "no duplicate row ids: plain `doctor` re-reports sdk / workspace / " +
      "westResolved, and taking them alongside --build's would render one fact " +
      "twice under one name and collide the view's `key={row.name}`",
  );
  assert.deepEqual(
    names.slice(0, REAL_BUILD.checks.length),
    REAL_BUILD.checks.map((check) => check.name),
    "--build's block comes first, in tan's own order and unchanged",
  );
  assert.deepEqual(
    names.slice(REAL_BUILD.checks.length, -1),
    ["lldb", "hostPrerequisites", "zephyrSdkHost", "longPaths", "homePath"],
    "then plain `doctor`'s host block, also in tan's order — so which run a " +
      "row came from is readable off the table",
  );
  for (const name of ["workspaceRoot", "sdkRoot", "codeLLDBExtension"]) {
    assert.equal(
      names.includes(name),
      false,
      `${name} is a project fact (or, for codeLLDBExtension, one tan itself ` +
        "answers `unknown` from a standalone binary) and is not this table's",
    );
  }
});

test("the summary counts exactly the rows on screen, using tan's arithmetic", async () => {
  const { tallyChecks } = loadDepsAdapter();

  // First: the tally IS tan's own. Re-run over each real envelope's checks it
  // reproduces that envelope's own summary byte for byte — including tan's rule
  // that a status outside pass/warn/fail (`codeLLDBExtension: unknown`) counts
  // toward nothing.
  assert.deepEqual(tallyChecks(REAL_BUILD.checks), REAL_BUILD.summary);
  assert.deepEqual(tallyChecks(REAL_PLAIN.checks), REAL_PLAIN.summary);

  const { report: built } = await report("/home/dev/proj", {
    build: REAL_BUILD,
    plain: REAL_PLAIN,
  });
  // The header must describe the table under it. With rows from two envelopes,
  // neither envelope's own summary does — `--build` alone would report 0 of the
  // five host rows, so a failing `hostPrerequisites` sat under "4 fail".
  // The five host rows this host produced: zephyrSdkHost / longPaths / homePath
  // pass, lldb warns, hostPrerequisites fails.
  assert.deepEqual(built.counts, {
    pass: REAL_BUILD.summary.pass + 3,
    warn: REAL_BUILD.summary.warn + 1,
    fail: REAL_BUILD.summary.fail + 1,
  });
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
  } = await report(null, {
    build: REAL_BUILD,
    plain: REAL_PLAIN,
  });
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

  // The host facts, which is the whole point: none of these reads a project.
  for (const name of ["git", "python", "cmake", "ninja", "longPaths"]) {
    assert.equal(
      row(name).status,
      REAL_BUILD.checks.concat(REAL_PLAIN.checks).find((c) => c.name === name)
        .status,
      `${name} is a host probe and carries tan's real verdict with no folder open`,
    );
  }
  assert.equal(
    row("ninja").action.command,
    "winget install -e --id Ninja-build.Ninja",
    "and the missing prerequisite is still one click away — that button is " +
      "the exit from the deadlock",
  );
});

test("with no folder open a project check is withheld, and says so", async () => {
  const { report: built } = await report(null, {
    build: REAL_BUILD,
    plain: REAL_PLAIN,
  });
  const row = (name) => built.rows.find((candidate) => candidate.name === name);

  for (const name of ["sdk", "boardYaml", "workspace", "westResolved"]) {
    // Reporting these would be worse than the old refusal: tan answers them
    // about whatever directory it was launched in, so a customer with no folder
    // open would read "board.yaml not found" about a temp directory.
    assert.ok(
      row(name),
      `${name} is still a row — a vanished row teaches nothing`,
    );
    assert.equal(
      row(name).status,
      "not checked",
      `${name} must not carry a verdict about a project that is not open`,
    );
    assert.match(
      row(name).detail,
      /no project folder is open/i,
      "and the row itself says why",
    );
    assert.equal(
      row(name).hint,
      null,
      "tan's remedy prose belongs to the verdict it never reached",
    );
  }
  assert.equal(
    built.counts.fail,
    REAL_BUILD.summary.fail - 3 + 1,
    "a withheld row counts as nothing — `sdk`, `boardYaml` and `workspace` " +
      "each rated `fail` about nowhere, and counting them would put three red " +
      "marks in the header for checks that never ran",
  );
});

test("a plain `doctor` that answers nothing leaves a row saying so", async () => {
  const { report: built } = await report("/home/dev/proj", {
    build: REAL_BUILD,
    plain: null,
  });
  const row = built.rows.find(
    (candidate) => candidate.name === "hostEnvironment",
  );

  assert.ok(
    row,
    "silently dropping the host half is the A-0f defect coming back invisibly",
  );
  assert.equal(row.status, "not checked");
  assert.match(row.detail, /long paths/i);
});

test("a `--build` that answers nothing is still an error state", async () => {
  const { report: built, error } = await report("/home/dev/proj", {
    build: null,
    plain: REAL_PLAIN,
  });

  assert.equal(
    built,
    null,
    "--build carries every PATH probe in the table, so losing it is losing " +
      "the table — five host rows that looked complete would be the worse answer",
  );
  assert.match(error, /no usable envelope/);
});

// ── A-0g: a winget install leaves a stale PATH ───────────────────────────────

test("a terminal install says what actually makes the row go green", async () => {
  const sent = [];
  const terminals = [];
  const plans = [];
  const { runDependencyAction } = loadDepsAdapter({
    vscode: {
      window: {
        createTerminal: (opts) => {
          terminals.push(opts);
          return {
            show() {},
            sendText: (text) => sent.push(text),
          };
        },
      },
      Uri: {},
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
      command: "winget install -e --id Ninja-build.Ninja",
      effect: "install",
      title: "winget install -e --id Ninja-build.Ninja",
    },
    rowName: "ninja",
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });

  assert.deepEqual(sent, ["winget install -e --id Ninja-build.Ninja"]);
  assert.equal(
    terminals[0].cwd,
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

// ── #412: `west sdk install …` retargeted onto the resolved venv binary ─────

/** tan v0.4.1's own `missingPrerequisites[].command` for the `zephyrSdk` row,
 *  verbatim. */
const ZEPHYR_SDK_ACTION = {
  kind: "command",
  command: "west sdk install --version 1.0.1 -t arm-zephyr-eabi",
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
  const sent = [];
  const terminals = [];
  const { runDependencyAction } = loadDepsAdapter({
    vscode: {
      window: {
        createTerminal: (opts) => {
          terminals.push(opts);
          return { show() {}, sendText: (text) => sent.push(text) };
        },
      },
      Uri: {},
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
      command: 'west sdk install --name "custom sdk"',
      effect: "install",
      title: 'west sdk install --name "custom sdk"',
    },
    rowName: "zephyrSdk",
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });

  assert.deepEqual(sent, ['west sdk install --name "custom sdk"']);
  assert.equal(
    terminals[0].cwd,
    "/home/dev/.alp",
    "still `west sdk install` — it still needs the west workspace topdir, " +
      "not the open project folder, even un-retargeted",
  );
});

test("a non-zephyrSdk row carrying a west command is not hijacked", () => {
  const sent = [];
  const { runDependencyAction } = loadDepsAdapter({
    vscode: {
      window: {
        createTerminal: () => ({
          show() {},
          sendText: (text) => sent.push(text),
        }),
      },
      Uri: {},
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
      command: "west update",
      effect: "install",
      title: "west update",
    },
    rowName: "workspace",
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });

  assert.deepEqual(
    sent,
    ["west update"],
    "the command reaches the plain terminal dispatch untouched",
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
