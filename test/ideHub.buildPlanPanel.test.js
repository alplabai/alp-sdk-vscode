// SPDX-License-Identifier: Apache-2.0
//
// `BuildPlanPanel` (src/ideHub/buildPlanPanel.ts) serves `handleRequestBuildPlan`
// from TWO triggers that must not be treated alike: the webview's own
// `requestBuildPlan` message (posted on mount — the user just opened "Alp:
// Build Plan") and the constructor's board.yaml/system-manifest.yaml file
// watcher (a file save, nobody's direct ask). Only the first may let a
// from-scratch tan CLI download show ADR 0021's consent dialog.

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
 * Mount the REAL `BuildPlanPanel` over a fake webview panel and fake file
 * watchers, with `../alpCli/vscodeAdapter` replaced so every `runAlpCommand`
 * call (and the `interactive` option it was given) is captured. Returns
 * handles to drive it: `requestBuildPlan()` (the webview message) and
 * `fileChanged()` (the board.yaml/system-manifest.yaml watcher firing).
 */
function mountPanel() {
  const calls = [];
  let onMessage = () => {};
  const watcherHandlers = [];
  const panel = {
    webview: {
      html: "",
      onDidReceiveMessage(handler) {
        onMessage = handler;
        return { dispose() {} };
      },
      postMessage() {
        return Promise.resolve(true);
      },
    },
    reveal() {},
    onDidDispose() {
      return { dispose() {} };
    },
  };

  const { BuildPlanPanel } = loadWithStubs("ideHub/buildPlanPanel.js", {
    vscode: {
      window: {
        createWebviewPanel: () => panel,
        workspaceFolders: undefined,
      },
      workspace: {
        get workspaceFolders() {
          return undefined;
        },
        createFileSystemWatcher: () => ({
          onDidChange(handler) {
            watcherHandlers.push(handler);
            return { dispose() {} };
          },
          onDidCreate() {
            return { dispose() {} };
          },
          onDidDelete() {
            return { dispose() {} };
          },
        }),
      },
      ViewColumn: { Active: 1 },
      Uri: { joinPath: () => ({}), parse: (value) => value },
      env: { openExternal: async () => true },
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_context, args, cwd, options) => {
        calls.push({ args, options });
        return { outcome: { ok: true, envelope: null, message: "" } };
      },
      runAlpStreamed: async () => {},
    },
    "./webviewHtml": { buildWebviewHtml: () => "<html></html>" },
    "../notify/vscodeAdapter": { notifyAsync() {} },
    "../util": {
      BUILD_RUN_NAME: "build",
      FLASH_RUN_NAME: "flash",
      isStreamedRunActive: () => false,
      releaseStreamedRun: () => {},
      reserveStreamedRun: () => true,
      log() {},
    },
  });

  BuildPlanPanel.open({ extensionUri: {} });

  return {
    calls,
    requestBuildPlan: () => onMessage({ type: "requestBuildPlan" }),
    fileChanged: () => watcherHandlers.forEach((handler) => handler()),
  };
}

test("BuildPlanPanel: the webview's requestBuildPlan (panel open) DOES ask tan CLI download consent", async () => {
  const { calls, requestBuildPlan } = mountPanel();
  requestBuildPlan();
  await new Promise((resolve) => setImmediate(resolve));

  const planCalls = calls.filter((c) => c.args.includes("--plan"));
  assert.ok(planCalls.length > 0, "requestBuildPlan must run `build --plan`");
  for (const call of planCalls) {
    assert.equal(
      call.options?.interactive,
      true,
      "the webview posts requestBuildPlan on mount — i.e. the user just opened " +
        "the panel — so this must be interactive, or an unanswered consent " +
        "setting silently paints nothing",
    );
  }
});

test("BuildPlanPanel: a board.yaml/system-manifest.yaml watcher refresh never asks consent", async () => {
  const { calls, fileChanged } = mountPanel();
  fileChanged();
  await new Promise((resolve) => setImmediate(resolve));

  const planCalls = calls.filter((c) => c.args.includes("--plan"));
  assert.ok(planCalls.length > 0, "the watcher must still refresh the plan");
  for (const call of planCalls) {
    assert.notEqual(
      call.options?.interactive,
      true,
      "a file save is not a direct user ask — an interactive resolution here " +
        "would pop ADR 0021's consent modal out of a board.yaml save",
    );
  }
});
