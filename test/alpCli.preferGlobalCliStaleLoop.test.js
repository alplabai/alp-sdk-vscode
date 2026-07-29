// SPDX-License-Identifier: Apache-2.0
//
// #408: with `alpSdk.preferGlobalCli: true` and a stale global `tan` resolved
// from PATH, the ONLY fix the extension offered was "Install tan CLI (global)"
// — which re-runs the bundled installer with no pin, so it can land the SAME
// binary again (see alpCli.installTanCli.test.js's sibling gate on the
// installer's own `--version`/`-Version`). A one-button loop with no visible
// way out, because the escape hatch (clearing the setting) was never offered
// here — only at the sibling "no `tan` on PATH at all" notice
// (`warnIfPreferGlobalCliHasNoPath`), which already carries both buttons.
//
// Driven through the REAL `checkCliVersion` (out/alpCli/vscodeAdapter.js), the
// same harness `alpCli.aheadWarning.test.js` uses, so what's asserted is the
// shipped notification plan, not a pure-function stand-in that could go on
// passing after the call site regresses.

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

const [MAJOR, MINOR] = SUPPORTED_CLI_VERSION.split(".").map(Number);
// One MINOR behind the pin (with the current 0.4.0 pin: "0.3.0") — derived,
// not hardcoded, so a pin bump keeps testing the same relationship.
const BEHIND = `${MAJOR}.${Math.max(MINOR - 1, 0)}.0`;

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
 * One activation of `checkCliVersion` with `tan --version` reporting
 * `installed`, resolved from `source`, with `alpSdk.preferGlobalCli` read as
 * `preferGlobalCli`. Mirrors `alpCli.aheadWarning.test.js`'s `activate`.
 */
async function activate({ installed, globalState, source, preferGlobalCli }) {
  const plans = [];
  const logLines = [];
  delete require.cache[ADAPTER];
  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: (section) => ({
          get: (key, fallback) =>
            section === "alpSdk" && key === "preferGlobalCli"
              ? preferGlobalCli
              : fallback,
        }),
      },
    },
    child_process: {
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
    adapter = require(ADAPTER);
  } finally {
    Module._load = originalLoad;
    delete require.cache[ADAPTER];
  }
  await adapter.checkCliVersion({
    extensionPath: path.join(root, "no-such-extension-dir"),
    globalStorageUri: { fsPath: path.join(root, "no-such-storage-dir") },
    globalState,
  });
  return { plans, logLines };
}

test("stale PATH tan + preferGlobalCli offers the escape hatch alongside the reinstall (#408)", async () => {
  const { plans } = await activate({
    installed: BEHIND,
    globalState: memento(),
    source: "path",
    preferGlobalCli: true,
  });

  assert.equal(
    plans.length,
    1,
    `tan ${BEHIND} against a ${SUPPORTED_CLI_VERSION} pin must raise the ` +
      "outdated-CLI warning",
  );
  const [plan] = plans;
  assert.deepEqual(
    plan.actions,
    [
      { id: "installTanCli", title: "Install tan CLI (global)" },
      { id: "openSettings", arg: "alpSdk.preferGlobalCli" },
    ],
    "the reinstall button alone re-runs the SAME unversioned installer " +
      "against the SAME re-ranked `path` rung — a loop with no way out " +
      "shown on screen. `openSettings(alpSdk.preferGlobalCli)` always " +
      "breaks it, so it must ride along, exactly like the sibling notice " +
      "(`warnIfPreferGlobalCliHasNoPath`) already offers both.",
  );
});

test("the same stale tan WITHOUT preferGlobalCli still offers only Update (no regression)", async () => {
  const { plans } = await activate({
    installed: BEHIND,
    globalState: memento(),
    source: "path",
    preferGlobalCli: false,
  });

  assert.equal(plans.length, 1);
  assert.deepEqual(
    plans[0].actions,
    [{ id: "updateCli", title: "Update" }],
    "preferGlobalCli off must keep the ordinary managed-download fix — the " +
      "extra escape-hatch button is specific to the opted-in loop",
  );
});
