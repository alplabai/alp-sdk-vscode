// SPDX-License-Identifier: Apache-2.0
//
// `alp.debugDoctor` (#376): target-agnostic (no target/server QuickPicks —
// those are `alp.debugPreflight`'s), spawns plain `tan doctor` through the
// shared `runDebugDoctor` seam, and renders its envelope verbatim. Gated on
// an open workspace (the #371 rule) and degrades to exactly ONE message when
// `tan` is unresolvable — never a second, in-process doctor rebuilt as a
// fallback.
//
// Drives the REAL registered handler out of `out/debug.js`, same
// `Module._load` swap as test/debug.supportBundle.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

function loadDebug(stubs) {
  const modPath = require.resolve(path.join(root, "out", "debug.js"));
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

const HEALTHY_DATA = {
  checks: [{ name: "sdk", status: "pass", detail: "alp-sdk v0.6.0" }],
  summary: { pass: 1, warn: 0, fail: 0 },
};

function register({
  workspaceRoot = "/w",
  runDebugDoctor = async () => ({ data: HEALTHY_DATA, message: "ok" }),
} = {}) {
  const docs = [];
  const notifications = [];
  const outputShown = { count: 0 };

  const { registerDebugCommands } = loadDebug({
    vscode: {
      commands: {
        registerCommand(id, handler) {
          return { id, handler, dispose() {} };
        },
      },
      window: { showTextDocument: async () => undefined },
      workspace: {
        openTextDocument: async (options) => {
          docs.push(options);
          return options;
        },
      },
    },
    "./debug/vscodeAdapter": {
      collectWorkspaceDebugContext: () => ({
        generatedAt: "2026-07-28T00:00:00.000Z",
        workspaceRoot,
        sdkRoot: "/w",
        boardYamlPath: "/w/board.yaml",
        boardYamlExists: true,
        westCwd: "/w",
        pythonBinary: "python3",
        debuggerExtensions: {
          cortexDebug: true,
          cppTools: true,
          codeLLDB: true,
        },
      }),
      collectRuntimeCapabilities: () => ({
        pythonAvailable: true,
        jlinkExecutable: null,
        openOcdExecutable: null,
        pyocdExecutable: null,
        gdbExecutable: null,
        lldbExecutable: null,
        hostPlatform: "linux",
      }),
      fileExists: () => true,
      runDebugDoctor,
    },
    // Module-level imports of src/debug.ts that would otherwise drag a
    // terminal or the west surface in. Nothing under test reaches them.
    "./alpCli/vscodeAdapter": { runAlpCommand: async () => ({}) },
    "./west": { ensureNativeSimOverlay: async () => true },
    "./util": {
      log() {},
      showOutput: () => {
        outputShown.count += 1;
      },
    },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        notifications.push(plan);
        return undefined;
      },
    },
  });

  const handlers = new Map(
    registerDebugCommands({}).map((entry) => [entry.id, entry.handler]),
  );
  return { handlers, docs, notifications, outputShown };
}

test("alp.debugDoctor refuses with one message when no workspace is open", async () => {
  const { handlers, docs, notifications } = register({ workspaceRoot: null });

  await handlers.get("alp.debugDoctor")();

  assert.equal(docs.length, 0, "no JSON document opened");
  assert.equal(notifications.length, 1, "exactly one message");
  assert.match(notifications[0].message, /open a folder/i);
});

test("alp.debugDoctor shows one message, not a second doctor, when tan is unresolvable", async () => {
  const { handlers, docs, notifications } = register({
    runDebugDoctor: async () => ({
      data: null,
      message:
        "tan could not be resolved: no prebuilt tan CLI is available for this platform.",
    }),
  });

  await handlers.get("alp.debugDoctor")();

  assert.equal(
    docs.length,
    0,
    "no JSON document opened — no second, rebuilt report",
  );
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].message, /tan could not be resolved/);
});

test("alp.debugDoctor renders tan's envelope verbatim on success", async () => {
  const { handlers, docs, notifications, outputShown } = register({
    runDebugDoctor: async () => ({ data: HEALTHY_DATA, message: "ok" }),
  });

  await handlers.get("alp.debugDoctor")();

  assert.equal(notifications.length, 0, "no failure toast on a healthy report");
  assert.equal(docs.length, 1);
  assert.deepEqual(JSON.parse(docs[0].content), HEALTHY_DATA);
  assert.equal(outputShown.count, 0, "no forced output on an all-pass report");
});

// #376 decision 9: exit 4 is a FAILING DOCTOR REPORT, not a failed retrieval —
// `runDebugDoctor` (see test/alpCli.doctor.test.js) still returns `data` on
// that path, and this command must render it rather than treat it as
// unavailable.
test("a failing doctor report (as exit 4 produces) still renders, and forces the output channel open", async () => {
  const data = {
    checks: [{ name: "ninja", status: "fail", detail: "ninja not found" }],
    summary: { pass: 0, warn: 0, fail: 1 },
  };
  const { handlers, docs, notifications, outputShown } = register({
    runDebugDoctor: async () => ({ data, message: "doctor found problems" }),
  });

  await handlers.get("alp.debugDoctor")();

  assert.equal(
    notifications.length,
    0,
    "a failing report is not the 'unavailable' message path",
  );
  assert.equal(docs.length, 1);
  assert.deepEqual(JSON.parse(docs[0].content), data);
  assert.equal(
    outputShown.count,
    1,
    "a failing check forces the Alp SDK channel open",
  );
});

test("an unknown-status check reaches the rendered JSON verbatim", async () => {
  const data = {
    checks: [
      {
        name: "codeLLDBExtension",
        status: "unknown",
        detail:
          "unknown — the standalone tan binary cannot see VS Code's installed extensions.",
      },
    ],
    summary: { pass: 0, warn: 0, fail: 0 },
  };
  const { handlers, docs } = register({
    runDebugDoctor: async () => ({ data, message: "ok" }),
  });

  await handlers.get("alp.debugDoctor")();

  assert.equal(JSON.parse(docs[0].content).checks[0].status, "unknown");
});
