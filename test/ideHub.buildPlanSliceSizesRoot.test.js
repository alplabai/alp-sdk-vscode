// SPDX-License-Identifier: Apache-2.0
//
// #607: the Build Plan panel's memory table silently blanked for any project
// that is not the workspace root.
//
// `postSystemManifestUnavailable` and `handleRequestSliceSizes`
// (src/ideHub/buildPlanPanel.ts) used to read
//
//   const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
//
// while the panel's OWN spawning handlers (Materialise, Build, flash-slice —
// #600's `requireWorkspace`) resolve `cwd` through `collectProjectContext().
// workspaceRoot`. On a multi-root workspace the two can name DIFFERENT
// folders (`docs/ARCHITECTURE_RULES.md` §3's own example: folder[0] a docs
// folder, the board.yaml project folder[1]) — a build the panel itself
// dispatches writes under `collectProjectContext().workspaceRoot`, but the
// size/manifest readers went on checking `workspaceFolders[0]`, found
// nothing there, and posted `report: null` with NO reason at all. A blank
// table that cannot explain itself is indistinguishable from a project that
// genuinely has no sizes yet.
//
// Same `Module._load` swap as test/tanPayloadShape.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

// The resolved root is POSIX-separated in production — `resolveWorkspaceRoot`
// (packages/alp-core/src/project/service.ts) ends in `toPosix(...)` — while
// the panel then builds the manifest path with `path.join`, which is NATIVE.
// So on win32 the panel produces `\root\project-b\build\...` from this
// same POSIX root, and a hardcoded POSIX expectation fails there and only
// there. Derive both the stub's answer and the expectation the way the panel
// does, or this file is green on macOS and red on Windows.
const PROJECT_B = "/root/project-b";
const MANIFEST_B = path.join(PROJECT_B, "build", "system-manifest.yaml");

/** Load `out/ideHub/buildPlanPanel.js` with the host modules stubbed, send
 *  one `requestBuildPlan`, and return every message posted to the webview.
 *
 * @param opts.workspaceRoot what `collectProjectContext` resolves — the root
 *   `requireWorkspace()` (and now the readers) must agree on. `undefined`
 *   simulates no folder open.
 * @param opts.manifestAt    the ONE path (if any) `fs.existsSync` answers true
 *   for — everything else, including a wrong-root guess, answers false.
 */
async function drivePanel(opts) {
  const posted = [];
  const notified = [];
  let onMessage = () => {};
  const watcher = {
    onDidChange: () => ({ dispose() {} }),
    onDidCreate: () => ({ dispose() {} }),
    onDidDelete: () => ({ dispose() {} }),
    dispose() {},
  };

  const modPath = require.resolve(
    path.join(root, "out", "ideHub", "buildPlanPanel.js"),
  );
  delete require.cache[modPath];
  const stubs = {
    fs: {
      existsSync: (p) => p === opts.manifestAt,
      statSync: () => ({ mtimeMs: 0 }),
    },
    vscode: {
      // Deliberately a DIFFERENT folder than `opts.workspaceRoot` — a
      // regression to `workspaceFolders[0]` must find nothing here and
      // still pass this file's earlier no-manifest-yet case by accident, so
      // this alone would not catch it; the point is this file's assertions
      // never read this value, only `collectProjectContext`'s.
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "/decoy/folder0" } }],
        createFileSystemWatcher: () => watcher,
      },
      window: {
        createWebviewPanel: () => ({
          webview: {
            set html(_v) {},
            onDidReceiveMessage: (cb) => {
              onMessage = cb;
              return { dispose() {} };
            },
            postMessage: async (msg) => {
              posted.push(msg);
              return true;
            },
          },
          onDidDispose: () => ({ dispose() {} }),
          reveal() {},
          dispose() {},
        }),
      },
      ViewColumn: { Active: 1 },
      Uri: { joinPath: (...p) => p.join("/"), parse: (v) => v },
      env: { openExternal: async () => true },
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async () => ({
        outcome: {
          message: "unused",
          envelope: { ok: true, data: { slices: [] } },
        },
      }),
      runAlpStreamed: async () => {},
    },
    "../util": {
      BUILD_RUN_NAME: "Alp Build",
      FLASH_RUN_NAME: "Alp Flash",
      isStreamedRunActive: () => false,
      reserveStreamedRun: () => true,
      releaseStreamedRun() {},
      log() {},
    },
    "./webviewHtml": { buildWebviewHtml: () => "<html></html>" },
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => notified.push(plan),
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot: opts.workspaceRoot }),
    },
    "../build/lastBuild": { readLastBuild: () => null },
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let BuildPlanPanel;
  try {
    ({ BuildPlanPanel } = require(modPath));
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }

  BuildPlanPanel.open({ extensionUri: "/ext" });
  onMessage({ type: "requestBuildPlan" });
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
  return { posted, notified };
}

test("a manifest under the resolved project root — NOT workspaceFolders[0] — is found", async () => {
  const { posted } = await drivePanel({
    workspaceRoot: PROJECT_B,
    manifestAt: MANIFEST_B,
  });

  const sizes = posted.find((m) => m.type === "sliceSizesData");
  assert.ok(sizes, "the panel posted no sliceSizesData at all");
  assert.ok(
    sizes.report !== null || sizes.error === undefined,
    "a manifest that genuinely exists under the resolved root must not " +
      "read as absent",
  );
  // The spawn ran at all — reading the wrong root would have short-circuited
  // to `report: null` before ever calling `tan size`.
  assert.deepEqual(sizes.report, { slices: [] });

  const manifest = posted.find((m) => m.type === "systemManifestData");
  assert.equal(
    manifest.postBuild,
    true,
    "postSystemManifestUnavailable has the SAME defect and must be fixed " +
      "the same way",
  );
});

test("no manifest yet under the resolved root says so, not a silent blank", async () => {
  const { posted } = await drivePanel({
    workspaceRoot: PROJECT_B,
    manifestAt: null,
  });

  const sizes = posted.find((m) => m.type === "sliceSizesData");
  assert.ok(sizes, "the panel posted no sliceSizesData at all");
  assert.equal(sizes.report, null);
  assert.equal(
    sizes.error,
    `No system manifest at ${MANIFEST_B}.`,
    "'no build output' would be a claim about the whole build; only ONE " +
      "file was checked, the same one the sibling systemManifestData " +
      "reader calls merely deferred, not absent",
  );
});

test("no workspace at all says so, distinctly from 'no build yet', and toasts with an Open Folder action", async () => {
  const { posted, notified } = await drivePanel({
    workspaceRoot: undefined,
    manifestAt: null,
  });

  const sizes = posted.find((m) => m.type === "sliceSizesData");
  assert.ok(sizes, "the panel posted no sliceSizesData at all");
  assert.equal(sizes.report, null);
  assert.ok(
    sizes.error && /folder/i.test(sizes.error),
    "with no workspace resolved the reason must name the actual cause, " +
      "not just repeat the generic 'no build yet' text — got " +
      JSON.stringify(sizes),
  );

  // Sourced from `planPrecondition`, not a hand-typed copy of its wording —
  // the panel's inline text and the toast must read identically, and the
  // toast is the only place `actions: [{id: "openFolder"}]` can land.
  assert.equal(notified.length, 1, "exactly one toast, not zero and not two");
  assert.equal(notified[0].message, sizes.error);
  assert.ok(
    notified[0].actions?.some((a) => a.id === "openFolder"),
    'planPrecondition("noWorkspace", …) always attaches an Open Folder ' +
      "action — a hand-typed copy of its message would have dropped it",
  );
});
