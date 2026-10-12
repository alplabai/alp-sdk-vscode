// SPDX-License-Identifier: Apache-2.0
//
// Single-row Install on a row the consent screen starts UNCHECKED (tier C or an
// unrecognised word): Enter with the row still unchecked answers `[]`. That was
// only logged, so the click looked dead. Drives the REAL `runDependencyAction`
// message handler out of `out/deps/panel.js` with a stubbed host.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

const row = {
  name: "vendor",
  label: "Vendor tool",
  status: "fail",
  action: { kind: "command", effect: "install", commands: [], title: "x" },
};

function openPanel(consent) {
  const info = [];
  const dispatched = [];
  let onMessage = null;
  const modPath = require.resolve(path.join(root, "out", "deps", "panel.js"));
  delete require.cache[modPath];
  const stubs = {
    vscode: {
      window: {
        createWebviewPanel: () => ({
          webview: {
            set html(_v) {},
            onDidReceiveMessage: (handler) => {
              onMessage = handler;
              return { dispose() {} };
            },
            postMessage: async () => true,
          },
          visible: true,
          onDidChangeViewState: () => ({ dispose() {} }),
          onDidDispose: () => ({ dispose() {} }),
          reveal() {},
          dispose() {},
        }),
      },
      ViewColumn: { Active: 1 },
      Uri: { joinPath: (...p) => p.join("/") },
      env: { openExternal() {} },
    },
    "../environment/vscodeAdapter": { danglingWestManifest: () => null },
    "../ideHub/webviewHtml": { buildWebviewHtml: () => "<html></html>" },
    "../notify/vscodeAdapter": { notifyAsync: (plan) => info.push(plan) },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot: "/ws" }),
    },
    "../toolchain": { offerBootstrapFix: async () => {} },
    "../util": { log() {} },
    "./vscodeAdapter": {
      buildDependencyReport: async () => ({
        report: { rows: [row] },
        error: undefined,
      }),
      withLatestSdk: async () => null,
      confirmDependencyInstalls: async () => consent,
      runDependencyAction: async (call) => dispatched.push(call),
      fixAllSummaryNotice: () => null,
      fixAllTargets: () => [],
      rowStepFailureNotice: () => null,
      runFixAll: async () => {},
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  try {
    require(modPath).DependencyPanel.open(
      { extensionUri: "/ext" },
      { state: {}, onStateChange: () => ({ dispose() {} }) },
    );
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
  return { send: (msg) => onMessage(msg), info, dispatched };
}

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
};

async function click(consent) {
  const panel = openPanel(consent);
  panel.send({ type: "ready" });
  await settle();
  panel.send({ type: "runDependencyAction", name: "vendor" });
  await settle();
  return panel;
}

test("Enter with the row unchecked tells the customer nothing was installed", async () => {
  const panel = await click([]);

  assert.deepEqual(panel.dispatched, []);
  assert.equal(panel.info.length, 1);
  assert.match(panel.info[0].message, /Nothing was selected/);
  assert.match(panel.info[0].detail, /Vendor tool/);
});

test("dismissing the consent screen stays silent", async () => {
  const panel = await click(null);

  assert.deepEqual(panel.dispatched, []);
  assert.deepEqual(panel.info, []);
});

test("a consented row dispatches and shows no notice", async () => {
  const panel = await click([row]);

  assert.equal(panel.dispatched.length, 1);
  assert.deepEqual(panel.info, []);
});
