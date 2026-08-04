// SPDX-License-Identifier: Apache-2.0
//
// `alp.openDebugTroubleshootingPanel` (#376): the doctor half of the panel
// now comes from one `tan doctor` spawn's result, rendered verbatim by
// `createDebugTroubleshootingPanelHtml` (packages/alp-core, its own coverage
// in test/debug.panelHtml.test.js). This file covers the SURFACE wiring —
// the new workspace gate and the degraded path — driving the REAL registered
// handler out of `out/debug.js`, same `Module._load` swap as
// test/debug.supportBundle.test.js.

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
  const panels = [];
  const notifications = [];

  const { registerDebugCommands } = loadDebug({
    vscode: {
      commands: {
        registerCommand(id, handler) {
          return { id, handler, dispose() {} };
        },
      },
      window: {
        // pickTargetKind / pickServer both take the head of the list:
        // zephyr-mcu, then jlink.
        showQuickPick: async (items) => items[0],
        createWebviewPanel: (viewType, title) => {
          const panel = {
            viewType,
            title,
            webview: { cspSource: "vscode-webview://panel", html: "" },
          };
          panels.push(panel);
          return panel;
        },
      },
      ViewColumn: { Active: 1 },
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
    "./util": { log() {}, showOutput() {} },
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
  return { handlers, panels, notifications };
}

test("alp.openDebugTroubleshootingPanel refuses with one message when no workspace is open", async () => {
  const { handlers, panels, notifications } = register({
    workspaceRoot: null,
  });

  await handlers.get("alp.openDebugTroubleshootingPanel")();

  assert.equal(panels.length, 0, "no panel opened");
  assert.equal(notifications.length, 1, "exactly one message");
  assert.match(notifications[0].message, /open a folder/i);
});

test("the panel renders tan's doctor envelope verbatim on success", async () => {
  const { handlers, panels } = register({
    runDebugDoctor: async () => ({ data: HEALTHY_DATA, message: "ok" }),
  });

  await handlers.get("alp.openDebugTroubleshootingPanel")();

  assert.equal(panels.length, 1);
  assert.match(panels[0].webview.html, /pass=1 warn=0 fail=0/);
  assert.match(panels[0].webview.html, /sdk/);
});

// #376 decision 5: exactly ONE message where the doctor table was — never a
// second, in-process doctor rendered in its place. The rest of the panel
// (inspect/trace/preflight) still opens.
test("the panel still opens, with one message in place of the doctor table, when tan is unresolvable", async () => {
  const { handlers, panels } = register({
    runDebugDoctor: async () => ({
      data: null,
      message:
        "tan could not be resolved: no prebuilt tan CLI is available for this platform.",
    }),
  });

  await handlers.get("alp.openDebugTroubleshootingPanel")();

  assert.equal(panels.length, 1, "the panel itself is not refused");
  assert.match(
    panels[0].webview.html,
    /tan could not be resolved: no prebuilt tan CLI is available for this platform\./,
  );
  assert.match(panels[0].webview.html, /Preflight Summary/);
});
