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
    "../project/vscodeAdapter": {},
    "../toolchain": {},
    "../util": { log() {} },
    ...overrides,
  });
}

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

/** Build a report against a fake CLI, collecting every argv it was asked to
 *  spawn. `workspaceRoot: null` is the no-folder-open machine. */
async function report(workspaceRoot = "/home/dev/proj") {
  const spawns = [];
  const { buildDependencyReport } = loadDepsAdapter({
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_context, args) => {
        spawns.push(args);
        return {
          outcome: {
            ok: true,
            message: "",
            envelope: { ok: true, data: DOCTOR_DATA },
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
    spawns,
    [["doctor", "--build"]],
    "one spawn only — the live GitHub call that fills the sdk row's 'latest' " +
      "cell must not be awaited before the ten rows already in hand are posted",
  );
  assert.equal(
    built.rows.find((row) => row.name === "sdk").latest,
    null,
    "the first report leaves the remote cell empty; `withLatestSdk` fills it in " +
      "a second post",
  );
});

test("with no folder open nothing is spawned", async () => {
  // `tan doctor --build` reports on the directory it runs in, and tan 0.4.0+
  // walks UP from there looking for an enclosing SDK. With no folder open the
  // child would inherit the extension host's own cwd (on Windows, the VS Code
  // install directory) and describe a directory the customer never chose.
  const { report: built, error, spawns } = await report(null);

  assert.deepEqual(spawns, [], "no folder open must mean no child process");
  assert.equal(built, null, "no report, rather than a report about nowhere");
  assert.match(
    error,
    /open your alp sdk project folder/i,
    "and the panel says what to do about it",
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
