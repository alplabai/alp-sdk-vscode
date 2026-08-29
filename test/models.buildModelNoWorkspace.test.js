// SPDX-License-Identifier: Apache-2.0
//
// `ModelsPanel.buildModel` (src/models/panel.ts) used to read
//
//   const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
//
// and pass it straight to `runAlpCommand(["model", "build"], cwd, ...)` with
// no check. With no folder open, `cwd` is `undefined`, and `undefined` is not
// refused anywhere downstream — the child inherits the extension host's own
// working directory (on Windows, the VS Code install directory) and `tan
// model build` compiles THERE (#605). The Models surface is hidden from the
// palette (#525) but `alp.buildModel` is still a registered command, so this
// is latent rather than dead.
//
// Same `Module._load` swap test/ideHub.buildPlanNoWorkspace.test.js uses:
// drives the REAL handler out of `out/models/panel.js`, and asserts on the
// two things that matter — was a process spawned, and was the customer told
// why not — because a source-level grep cannot tell those apart.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Drive `alp.buildModel` (`triggerModelBuild`) with NO workspace folder,
 *  collecting every spawn attempt and notification plan. */
function driveWithNoWorkspace() {
  const spawns = [];
  const notified = [];
  const posted = [];

  const modPath = require.resolve(path.join(root, "out", "models", "panel.js"));
  delete require.cache[modPath];
  const stubs = {
    vscode: {
      window: {
        createWebviewPanel: () => ({
          webview: {
            set html(_v) {},
            onDidReceiveMessage: () => ({ dispose() {} }),
            postMessage: async (msg) => {
              posted.push(msg);
              return true;
            },
          },
          onDidDispose: () => ({ dispose() {} }),
          reveal() {},
          dispose() {},
        }),
        withProgress: async (_opts, task) => task({ report() {} }, {}),
      },
      ProgressLocation: { Notification: 15 },
      ViewColumn: { Active: 1 },
      Uri: { joinPath: (...p) => p.join("/") },
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args, cwd, options) => {
        spawns.push({ args: [...args], cwd, options });
        return { outcome: { envelope: { ok: true, data: {} } } };
      },
    },
    // The resolver seam the guard actually reads — `docs/ARCHITECTURE_
    // RULES.md` §3 forbids re-deriving the root from `workspaceFolders[0]`,
    // so the guard asks this, and so must the test.
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot: undefined }),
    },
    "../ideHub/webviewHtml": {
      buildWebviewHtml: () => "<html></html>",
      runWebviewCommand: () => {},
    },
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => notified.push(plan),
      reportError: () => {},
    },
    "../util": { log() {} },
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let triggerModelBuild;
  try {
    ({ triggerModelBuild } = require(modPath));
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }

  triggerModelBuild({ extensionUri: "/ext" });
  return { spawns, notified, posted };
}

test("alp.buildModel with no folder open never spawns tan", async () => {
  const { spawns } = driveWithNoWorkspace();
  // `buildModel` is async; let its microtasks settle before asserting.
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  assert.deepEqual(
    spawns,
    [],
    "with no workspace root the child inherits the extension host's cwd, so " +
      "`tan model build` would compile against the VS Code install directory",
  );
});

test("alp.buildModel with no folder open explains why nothing ran", async () => {
  const { notified } = driveWithNoWorkspace();
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  assert.ok(
    notified.length >= 1,
    "silently doing nothing is the worst outcome: the command appears to " +
      "have done something, and the customer has no idea a folder is missing",
  );
});

test("alp.buildModel with no folder open still stops the webview's spinner", async () => {
  // useModels.ts's `build()` dispatches `buildStart` (`building: true`)
  // BEFORE posting the click, and only a `modelBuildProgress` with
  // `done: true` clears it -- both Build buttons stay `disabled={building}`
  // until one arrives. An early return that skips this leaves the button
  // disabled until the panel is closed and reopened.
  const { posted } = driveWithNoWorkspace();
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  const progress = posted.find((m) => m.type === "modelBuildProgress");
  assert.ok(
    progress,
    "the refusal path posted no modelBuildProgress at all -- got " +
      JSON.stringify(posted),
  );
  assert.equal(
    progress.done,
    true,
    "only done: true clears useModels.ts's `building` state",
  );
});
