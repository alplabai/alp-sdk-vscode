// SPDX-License-Identifier: Apache-2.0
//
// The Build Plan panel's three SPAWNING handlers, with no folder open.
//
// `alp.showBuildPlan` carries no `when`/`enablement` in package.json, so the
// panel opens with no workspace. All three handlers below then read
//
//   const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
//
// and never check it. `cwd` stays optional the whole way down --
// `runAlpCommand(context, args, cwd?)` -> `spawn(command, argv, cwd)` -- and no
// layer substitutes a default, so `undefined` reaches `child_process.spawn` and
// the child inherits the extension host's own working directory (on Windows,
// the VS Code install directory). `tan build --materialise` then WRITES the
// plan's generated files there.
//
// `src/west.ts` already refuses this exact shape with
// `planPrecondition("noWorkspace", ...)`, and test/bootstrap.noWorkspace.test.js
// pins the same guard for `tan bootstrap`. The panel was the hole.
//
// This drives the REAL handlers out of `out/ideHub/buildPlanPanel.js` with the
// same `Module._load` swap test/ideHub.materialiseGuard.test.js uses, and
// asserts on the two things that matter: was a process spawned, and was the
// customer told why not. A source-level grep cannot tell those apart.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/**
 * Open the panel with NO workspace folder and post `message`, collecting every
 * spawn attempt and notification plan.
 *
 * `workspaceFolders` is left `undefined` -- the shape VS Code really reports
 * with no folder open -- rather than an empty array, so a guard that only
 * handles `[]` cannot pass this by accident.
 */
async function driveWithNoWorkspace(message) {
  const commandSpawns = [];
  const streamedSpawns = [];
  const terminalSpawns = [];
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
    fs: { existsSync: () => true },
    vscode: {
      window: {
        createWebviewPanel: () => ({
          webview: {
            set html(_v) {},
            onDidReceiveMessage: (cb) => {
              onMessage = cb;
              return { dispose() {} };
            },
            postMessage: async () => true,
          },
          onDidDispose: () => ({ dispose() {} }),
          reveal() {},
          dispose() {},
        }),
      },
      workspace: {
        workspaceFolders: undefined,
        createFileSystemWatcher: () => watcher,
      },
      ViewColumn: { Active: 1 },
      Uri: { joinPath: (...p) => p.join("/"), parse: (v) => v },
      env: { openExternal: async () => true },
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args, cwd) => {
        commandSpawns.push({ args: [...args], cwd });
        return {
          outcome: {
            message: "unused",
            envelope: { ok: true, issues: [], data: { written: [] } },
          },
        };
      },
      runAlpStreamed: async (_ctx, args, options) => {
        streamedSpawns.push({ args: [...args], cwd: options?.cwd });
      },
      runAlpInTerminal: async (_ctx, args, options) => {
        terminalSpawns.push({ args: [...args], cwd: options?.cwd });
      },
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
      notify: async (plan) => {
        notified.push(plan);
        return undefined;
      },
    },
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
  // The panel's own opening refresh spawns read-only probes; only spawns made
  // AFTER the click are the ones under test.
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
  commandSpawns.length = 0;
  streamedSpawns.length = 0;
  terminalSpawns.length = 0;
  notified.length = 0;

  onMessage(message);
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  return { commandSpawns, streamedSpawns, terminalSpawns, notified };
}

const CLICKS = [
  {
    message: { type: "materialiseBuildPlan" },
    what: "`tan build --materialise`, which WRITES generated files",
  },
  { message: { type: "runBuild" }, what: "`tan build`" },
  {
    message: { type: "flashSlice", coreId: "m55_hp" },
    what: "`tan flash --core m55_hp`",
  },
];

for (const { message, what } of CLICKS) {
  test(`${message.type} with no folder open never spawns tan`, async () => {
    const { commandSpawns, streamedSpawns, terminalSpawns } =
      await driveWithNoWorkspace(message);

    const spawned = [...commandSpawns, ...streamedSpawns, ...terminalSpawns];
    assert.deepEqual(
      spawned,
      [],
      `with no workspace root the child inherits the extension host's cwd, ` +
        `so ${what} would run against the VS Code install directory`,
    );
  });

  test(`${message.type} with no folder open explains why nothing ran`, async () => {
    const { notified } = await driveWithNoWorkspace(message);

    assert.ok(
      notified.length >= 1,
      "silently doing nothing is the worst outcome: the button appears " +
        "broken and the customer has no idea a folder is what is missing",
    );
  });
}
