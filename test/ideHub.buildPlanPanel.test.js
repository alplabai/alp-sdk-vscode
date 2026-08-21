// SPDX-License-Identifier: Apache-2.0
//
// `BuildPlanPanel` (src/ideHub/buildPlanPanel.ts) serves its refresh from TWO
// triggers that must not be treated alike: the webview's own
// `requestBuildPlan` message (posted on mount — the user just opened "Alp:
// Build Plan") and the constructor's board.yaml/system-manifest.yaml file
// watcher (a file save, nobody's direct ask). Only the first may let a
// from-scratch tan CLI download show ADR 0021's consent dialog.
//
// THE CALL THAT CARRIES THAT DISTINCTION IS `tan size` NOW, not `build
// --plan`. `--plan`, `--manifest` and `--manifest-from` are all deferred at
// the pin (tan-cli#427) and the panel no longer spawns for any of them (#541),
// so `size` is the only handler here with an `interactive` flag to get wrong.
// The two consent tests below therefore drive the post-build path — a
// workspace folder and an existing `build/system-manifest.yaml` — because
// `handleRequestSliceSizes` returns early with `report: null` and spawns
// NOTHING when there is no manifest on disk, and a consent assertion over zero
// spawns asserts nothing at all.
//
// The third test is the other half of #541: the watcher must fire no doomed
// call, and the panel must still SAY that the plan is unavailable and name the
// upstream issue.

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
  const posted = [];
  let onMessage = () => {};
  const watcherHandlers = [];
  const panel = {
    webview: {
      html: "",
      onDidReceiveMessage(handler) {
        onMessage = handler;
        return { dispose() {} };
      },
      postMessage(msg) {
        posted.push(msg);
        return Promise.resolve(true);
      },
    },
    reveal() {},
    onDidDispose() {
      return { dispose() {} };
    },
  };

  const { BuildPlanPanel } = loadWithStubs("ideHub/buildPlanPanel.js", {
    // A manifest on disk, so the one remaining spawn (`tan size`) actually
    // runs — see this file's header.
    fs: { existsSync: () => true, statSync: () => ({ mtimeMs: 0 }) },
    vscode: {
      window: {
        createWebviewPanel: () => panel,
        workspaceFolders: [{ uri: { fsPath: "/home/dev/proj" } }],
      },
      workspace: {
        get workspaceFolders() {
          return [{ uri: { fsPath: "/home/dev/proj" } }];
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
    posted,
    requestBuildPlan: () => onMessage({ type: "requestBuildPlan" }),
    fileChanged: () => watcherHandlers.forEach((handler) => handler()),
  };
}

test("BuildPlanPanel: the webview's requestBuildPlan (panel open) DOES ask tan CLI download consent", async () => {
  const { calls, requestBuildPlan } = mountPanel();
  requestBuildPlan();
  await new Promise((resolve) => setImmediate(resolve));

  const sizeCalls = calls.filter((c) => c.args[0] === "size");
  assert.ok(sizeCalls.length > 0, "requestBuildPlan must run `tan size`");
  for (const call of sizeCalls) {
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

  const sizeCalls = calls.filter((c) => c.args[0] === "size");
  assert.ok(
    sizeCalls.length > 0,
    "the watcher must still refresh the slice sizes — a build changes them, " +
      "and `tan size` is a live command at this pin",
  );
  for (const call of sizeCalls) {
    assert.notEqual(
      call.options?.interactive,
      true,
      "a file save is not a direct user ask — an interactive resolution here " +
        "would pop ADR 0021's consent modal out of a board.yaml save",
    );
  }
});

test("BuildPlanPanel: no trigger spawns a deferred `tan build` flag, and the panel says why", async () => {
  // #541. `--plan`, `--manifest` and `--manifest-from` all PARSE, so the old
  // calls exited without a usage error and the failure arrived three layers
  // from its cause. Both triggers are checked: the watcher one is the worse of
  // the two, because it fired two doomed subprocesses on every board.yaml save.
  const { calls, posted, requestBuildPlan, fileChanged } = mountPanel();
  requestBuildPlan();
  fileChanged();
  await new Promise((resolve) => setImmediate(resolve));

  for (const flag of ["--plan", "--manifest", "--manifest-from"]) {
    assert.deepEqual(
      calls.filter((c) => c.args.includes(flag)),
      [],
      `\`tan build ${flag}\` is deferred at this pin (tan-cli#427) — spawning ` +
        "it spends a process to learn what the pin already determines",
    );
  }

  // The user-facing half, which must NOT regress: before this, the CLI's own
  // `cli.command-deferred` message reached the view and named tan-cli#427.
  const plan = posted.find((m) => m.type === "buildPlanData");
  assert.ok(plan, "the panel must still post a buildPlanData");
  assert.equal(plan.plan, null);
  assert.match(plan.error, /--plan/);
  assert.match(plan.error, /tan-cli#427/);
  assert.match(plan.error, /issues\/427/, "with the URL tan itself printed");

  const manifest = posted.find((m) => m.type === "systemManifestData");
  assert.ok(manifest, "and a systemManifestData");
  assert.equal(manifest.manifest, null);
  assert.match(manifest.error, /tan-cli#427/);
  assert.equal(
    manifest.postBuild,
    true,
    "the on-disk facts survive the CLI gap: whether a manifest exists does " +
      "not depend on tan being able to parse it",
  );
});
