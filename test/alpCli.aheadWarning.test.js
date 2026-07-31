// SPDX-License-Identifier: Apache-2.0
//
// The "your tan CLI is newer than this extension was tested against" warning,
// driven through the REAL `checkCliVersion` in out/alpCli/vscodeAdapter.js.
//
// Why this file exists: the decision used to be split across two places — an
// `if (skew === "ahead-patch") { …; return; }` early return AND the
// `shouldWarnCliAhead(…)` gate below it. Widening the early return to
// `skew === "ahead-patch" || skew === "ahead-minor"` made the whole warning
// dead code and left the entire suite green, because every assertion covering
// it was either a pure-function test (which never reaches that branch) or a
// source-text grep (which cannot see that a call became unreachable). The
// adapter is loaded here with its host requires swapped out — the same
// `Module._load` trick test/setupOrchestrator.service.test.js,
// test/util.terminalFinish.test.js and test/webviewHtml.csp.test.js use — so
// what is asserted is the shipped code path, notification plan included.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

const ADAPTER = require.resolve(
  path.join(root, "out", "alpCli", "vscodeAdapter.js"),
);
const { SUPPORTED_CLI_VERSION } = require(
  path.join(root, "out", "alpCli", "service.js"),
);

/** globalState key the adapter persists the already-warned version under. */
const AHEAD_WARNED_KEY = "alp.tanAheadWarnedVersion";

// Strip any pre-release suffix before parsing the numeric tuple -- a naive
// `.split(".").map(Number)` on a pin like "0.5.0-rc1" reads its PATCH chunk
// as "0-rc1" and produces NaN (#446 pinned the first pre-release SUPPORTED_CLI_VERSION).
const [, MAJOR_STR, MINOR_STR, PATCH_STR, PRE] =
  SUPPORTED_CLI_VERSION.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/) ?? [];
const [MAJOR, MINOR, PATCH] = [MAJOR_STR, MINOR_STR, PATCH_STR].map(Number);
/** One MINOR ahead of the pin — the skew that CAN move the envelope contract
 *  (with the current 0.3.1 pin: "0.4.0"). Derived, not hardcoded, so a pin bump
 *  keeps testing the same relationship instead of silently changing it. */
const AHEAD_MINOR = `${MAJOR}.${MINOR + 1}.0`;
/** One PATCH ahead — the skew that must stay SILENT. When the pin itself is a
 *  pre-release, the same MAJOR.MINOR.PATCH tuple WITHOUT a pre-release suffix
 *  is already "ahead-patch" per `cliSkew` (SemVer §11: a final release beats
 *  its own rc) — bumping PATCH again would skip past that relationship
 *  instead of testing it. */
const AHEAD_PATCH = PRE
  ? `${MAJOR}.${MINOR}.${PATCH}`
  : `${MAJOR}.${MINOR}.${PATCH + 1}`;

/** A `vscode.Memento` over a plain object. */
function memento(initial = {}) {
  const store = { ...initial };
  return {
    store,
    get: (key, fallback) =>
      Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback,
    update: async (key, value) => {
      if (value === undefined) delete store[key];
      else store[key] = value;
    },
  };
}

/**
 * One activation: load a FRESH copy of the adapter (its `versionChecked` /
 * resolved-binary memos are per-window module state) with `tan --version`
 * reporting `installed`, and return every notification plan it raised.
 * `globalState` is passed in so two activations can share it, which is how the
 * one-shot-across-restarts guard is exercised for real.
 */
async function activate({ installed, globalState, source = "cached" }) {
  const plans = [];
  const logLines = [];
  const modPath = ADAPTER;
  delete require.cache[modPath];
  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      },
    },
    child_process: {
      // The adapter probes `tan --version` synchronously; nothing else in this
      // path spawns. `execFile` only has to exist — it is promisified at
      // module load.
      spawnSync: () => ({
        status: 0,
        stdout: `tan ${installed}\n`,
        stderr: "",
      }),
      spawn: () => {
        throw new Error("checkCliVersion must not spawn anything else");
      },
      execFile: () => {},
    },
    "./adapterCore": {
      resolveAlpBinary: async () => ({ command: "tan", source }),
      resolutionInputFromDeps: () => ({}),
      runAlpAsync: async () => {
        throw new Error("checkCliVersion must not run an envelope command");
      },
      downloadCli: async () => {},
    },
    // `downloadSeam` is a FACTORY: the adapter calls it once at
    // `buildResolveDeps` time to build the `ResolveDeps.download` seam, so the
    // stub has to return a function, not be one.
    "./download": { downloadSeam: () => async () => {} },
    "../notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return undefined;
      },
      notifyAsync: (plan) => plans.push(plan),
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: null,
        sdkRoot: null,
        boardYamlPath: null,
        westCwd: null,
        pythonBinary: "python",
      }),
    },
    "../util": { log: (line) => logLines.push(line), runInTerminal: () => {} },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let adapter;
  try {
    adapter = require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
  await adapter.checkCliVersion({
    extensionPath: path.join(root, "no-such-extension-dir"),
    globalStorageUri: { fsPath: path.join(root, "no-such-storage-dir") },
    globalState,
  });
  return { plans, logLines };
}

test("a MINOR-newer tan warns exactly once, naming the version found", async () => {
  const globalState = memento();
  const { plans } = await activate({
    installed: AHEAD_MINOR,
    globalState,
  });

  assert.equal(
    plans.length,
    1,
    `tan ${AHEAD_MINOR} against a ${SUPPORTED_CLI_VERSION} pin must raise the ` +
      "ahead-of-pin warning — if this is 0, the warning has become unreachable",
  );
  const [plan] = plans;
  assert.ok(
    plan.message.includes(AHEAD_MINOR),
    `the version found is the fact the customer needs: ${plan.message}`,
  );
  assert.equal(plan.severity, "warning");
  assert.equal(plan.channel, "toast");
  assert.equal(
    globalState.store[AHEAD_WARNED_KEY],
    AHEAD_MINOR,
    "the warned-for version must be persisted, or every restart re-toasts",
  );

  // The remedy the sentence offers has to be the remedy the buttons perform.
  // `alp.updateCli` DOWNLOADS the pinned version, i.e. a downgrade from the
  // installed one — titled "Update" it silently took a newer tan away from a
  // customer who had just read "update the extension".
  assert.deepEqual(
    plan.actions,
    [
      { id: "openExtensions" },
      { id: "updateCli", title: `Use tan ${SUPPORTED_CLI_VERSION}` },
    ],
    "the advice 'update the extension' needs a button, and the CLI button " +
      "must say that it installs the pinned (older) CLI",
  );

  // VS Code clips a toast to ~2 lines: whatever leads is the whole message
  // most customers read, and contract vocabulary is not actionable.
  assert.ok(
    plan.message.length <= 140,
    `the toast must stay readable unexpanded (${plan.message.length} chars): ${plan.message}`,
  );
  for (const jargon of ["issue code", "envelope"]) {
    assert.ok(
      !plan.message.toLowerCase().includes(jargon),
      `"${jargon}" is internal contract vocabulary — channel, not toast`,
    );
  }
});

test("a PATCH-newer tan stays silent, and says so in the channel", async () => {
  const globalState = memento();
  const { plans, logLines } = await activate({
    installed: AHEAD_PATCH,
    globalState,
  });

  assert.deepEqual(
    plans,
    [],
    `a patch release cannot move the envelope contract, so tan ${AHEAD_PATCH} ` +
      "must not toast on every activation",
  );
  assert.ok(
    logLines.some((line) => line.includes(AHEAD_PATCH)),
    "the silence has to be explainable in a support thread",
  );
  assert.equal(
    globalState.store[AHEAD_WARNED_KEY],
    undefined,
    "nothing was warned about, so nothing may be recorded as warned",
  );
});

test("the warning is one-shot across activations, not once per window", async () => {
  const globalState = memento();
  assert.equal(
    (await activate({ installed: AHEAD_MINOR, globalState })).plans.length,
    1,
  );
  assert.deepEqual(
    (await activate({ installed: AHEAD_MINOR, globalState })).plans,
    [],
    "a customer running a newer tan on purpose must not be re-toasted every " +
      "time VS Code starts",
  );
});
