// SPDX-License-Identifier: Apache-2.0
//
// The name `runNameFor` PROMISES for a row is the name that row's dispatch
// actually CLAIMS (#631).
//
// ── The hang this closes ────────────────────────────────────────────────────
//
// `runFixAll` subscribes to `awaitRun(runNameFor(row))` and then dispatches the
// row. `awaitRun` (`src/util.ts`) only ever settles on a `terminalFinished`
// event carrying the name it subscribed to — so if the dispatch claims a
// DIFFERENT name, the promise never resolves. Measured on the compiled
// `runFixAll` before the fix:
//
//   dispatched under:        [ 'Alp: install dependency' ]
//   awaitRun subscribed for: [ 'Alp: install Zephyr SDK' ]
//   result:                  __HUNG__ (never resolves)
//
// The progress notification spins forever, no later row runs, nothing on screen
// says why, and only a window reload clears it.
//
// It was the `zephyrSdk` row: `runNameFor` returns `ZEPHYR_SDK_RUN_NAME` for
// it, but `runZephyrSdkInstall`'s `retargetWestCommand`-refused FALLBACK
// dispatched through a helper that hardcoded `INSTALL_RUN_NAME`. Two dispatch
// paths, one of them off-contract.
//
// ── Why a gate and not just the fix ─────────────────────────────────────────
//
// The invariant held for every other row and broke on exactly one, in exactly
// one of its two branches, reachable only when a failing Zephyr SDK check and
// a refused retarget coincide. `runFixAll`'s existing `isRunActive` guard
// cannot catch it: the mismatch is between the AWAITED name and the DISPATCHED
// one, not between two dispatches.
//
// So this file asserts the invariant itself, per action kind and per branch,
// by driving the real compiled dispatcher with `runInTerminal` stubbed to
// record the name it was handed.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

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

/**
 * @param opts.retargets whether `retargetWestCommand` resolves a `west` binary
 *   — i.e. which of `runZephyrSdkInstall`'s TWO dispatch branches is taken.
 *   The fallback is the one that was off-contract.
 */
function load(opts = {}) {
  const dispatched = [];
  const awaited = [];
  const notified = [];

  const mod = loadWithStubs("deps/vscodeAdapter.js", {
    vscode: {
      window: { showQuickPick: async (items) => items },
      Uri: {},
      commands: { executeCommand: async () => undefined },
    },
    "../alpCli/vscodeAdapter": {
      proxyEnvAdditions: () => ({}),
      runAlpCommand: async () => ({ outcome: { envelope: null } }),
    },
    "../alpCli/doctor": {},
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => notified.push(plan),
      notify: async (plan) => {
        notified.push(plan);
        return undefined;
      },
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        westCwd: "/home/dev/proj",
        sdkRoot: "/home/dev/alp-sdk",
        workspaceRoot: "/home/dev/proj",
      }),
      readOnlyProjectCwd: () => "/home/dev/proj",
    },
    "../environment/vscodeAdapter": {
      // `topdir` resolves and its venv has a `west`; `retargets: false` is what
      // pushes `runZephyrSdkInstall` down its fallback branch.
      westWorkspaceTopdir: () => "/home/dev/zephyrproject",
      venvWestInTopdir: () => "/home/dev/zephyrproject/.venv/bin/west",
    },
    "@alp-sdk/core/deps/westCommand": {
      retargetWestCommand: (command, west) =>
        opts.retargets === false ? null : [west, "sdk", "install"],
    },
    "../toolchain": {
      runToolchainFix() {},
      TOOLCHAIN_FIX_RUN_NAME: "Alp: toolchain fix",
    },
    "../util": {
      log() {},
      isRunActive: () => false,
      runInTerminal: (options) => dispatched.push(options),
      awaitRun: (name) => {
        awaited.push(name);
        return new Promise(() => {});
      },
    },
  });

  return { ...mod, dispatched, awaited, notified };
}

/** A row shaped like the planner's output, for one action. */
const row = (name, action) => ({
  name,
  label: name,
  status: "fail",
  state: "will-install",
  detail: "",
  hint: null,
  installed: null,
  latest: null,
  updateAvailable: false,
  action,
});

const commandAction = (commands) => ({
  kind: "command",
  commands,
  effect: "install",
  title: "",
  omittedTools: [],
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Drive one row's dispatch and report what name(s) it claimed. */
async function dispatchOf(mod, aRow) {
  void mod.runDependencyAction({
    action: aRow.action,
    rowName: aRow.name,
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });
  await settle();
  await settle();
  return mod.dispatched.map((d) => d.name);
}

// ---------------------------------------------------------------------------
// The row that hung
// ---------------------------------------------------------------------------

test("the zephyrSdk RETARGETED dispatch claims the name runNameFor promises", async () => {
  const mod = load({ retargets: true });
  const r = row(
    "zephyrSdk",
    commandAction([{ tool: "zephyrSdk", command: "west sdk install" }]),
  );
  const claimed = await dispatchOf(mod, r);
  assert.deepEqual(claimed, [mod.runNameFor(r)]);
});

test("the zephyrSdk FALLBACK dispatch claims it too — the #631 hang", async () => {
  const mod = load({ retargets: false });
  const r = row(
    "zephyrSdk",
    commandAction([{ tool: "zephyrSdk", command: "west sdk install" }]),
  );
  const claimed = await dispatchOf(mod, r);
  assert.deepEqual(
    claimed,
    [mod.runNameFor(r)],
    "`retargetWestCommand` refusing the line used to fall back to a helper " +
      "hardcoding `Alp: install dependency`, while `runFixAll` awaited " +
      "`Alp: install Zephyr SDK`. `awaitRun` settles only on the name it " +
      "subscribed to, so Fix-all hung forever with nothing on screen saying " +
      "why — only a window reload cleared it.",
  );
});

test("the fallback gives the Zephyr SDK notice, not the winget PATH one", async () => {
  const mod = load({ retargets: false });
  await dispatchOf(
    mod,
    row(
      "zephyrSdk",
      commandAction([{ tool: "zephyrSdk", command: "west sdk install" }]),
    ),
  );
  const text = JSON.stringify(mod.notified);
  assert.doesNotMatch(
    text,
    /PATH/i,
    "the old fallback also raised `offerReloadAfterInstall`, whose prose is " +
      "written for a `winget` install and blames the window's PATH — wrong " +
      "advice for `west sdk install`, and it dropped `sevenZipStatus` too",
  );
});

// ---------------------------------------------------------------------------
// The invariant, across the action kinds
// ---------------------------------------------------------------------------

test("a plain command row claims the generic install name it is promised", async () => {
  const mod = load();
  const r = row(
    "hostPrerequisites",
    commandAction([{ tool: "cmake", command: "brew install cmake" }]),
  );
  const claimed = await dispatchOf(mod, r);
  assert.deepEqual(claimed, [mod.runNameFor(r)]);
});

test("a MULTI-step command row claims that one name on every step", async () => {
  const mod = load();
  const r = row(
    "hostPrerequisites",
    commandAction([
      { tool: "cmake", command: "brew install cmake" },
      { tool: "ninja", command: "brew install ninja" },
    ]),
  );
  void mod.runDependencyAction({
    action: r.action,
    rowName: r.name,
    cwd: "/home/dev/proj",
    sevenZipStatus: undefined,
  });
  await settle();
  assert.ok(mod.dispatched.length >= 1, "no step dispatched at all");
  for (const d of mod.dispatched) {
    assert.equal(
      d.name,
      mod.runNameFor(r),
      "every step of a row runs under the row's one name — `runFixAll` " +
        "subscribes ONCE, so a step under a second name would strand it",
    );
  }
});

test("runNameFor answers null exactly for the rows that dispatch nothing", () => {
  const mod = load();
  assert.equal(
    mod.runNameFor(row("anything", null)),
    null,
    "a row with no action has nothing to await",
  );
  assert.equal(
    mod.runNameFor(
      row("docsOnly", { kind: "command", commands: [], effect: "open-docs" }),
    ),
    null,
    "an `open-docs` action opens a web page and installs nothing, so " +
      "awaiting a terminal that never runs would hang by construction",
  );
});

// ---------------------------------------------------------------------------
// The gate is not vacuous
// ---------------------------------------------------------------------------

test("the harness really does observe a dispatch, and the promised name has not drifted", async () => {
  const mod = load({ retargets: false });
  const r = row(
    "zephyrSdk",
    commandAction([{ tool: "zephyrSdk", command: "west sdk install" }]),
  );
  const claimed = await dispatchOf(mod, r);
  assert.equal(
    claimed.length,
    1,
    "nothing was dispatched, so every name assertion above would compare two " +
      "empty lists and pass",
  );
  assert.notEqual(
    mod.runNameFor(r),
    "Alp: install dependency",
    "the promised name must not itself have drifted to the generic one — " +
      "that would make the contract hold by agreeing with the bug",
  );
});
