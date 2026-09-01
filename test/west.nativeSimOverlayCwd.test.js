// SPDX-License-Identifier: Apache-2.0
//
// `ensureNativeSimOverlay` (src/west.ts) resolves `root` and uses it for
// `nativeSimOverlayExists(root)`, then spawned `tan generate --target
// native-sim-overlay` with `undefined` as its cwd — the #605 defect class,
// found on the adversarial review pass over #605/#606/#607. This WRITES
// `boards/native_sim_native_64.overlay`: with an omitted cwd the child
// inherits the extension host's own directory, so the overlay lands there
// instead of under the project, `nativeSimOverlayExists(root)` never sees it
// and stays false, and the generate step silently reruns on every single
// native_sim run (`alp.westRunNativeSim` and F5 Debug both call this)
// without the app ever picking up the overlay it wrote.
//
// Same `Module._load` swap as test/west.somCliFloor.test.js, including its
// `SOM_FLOOR_GUARD` cache-bust — `west.js` now imports `warnIfCliCannotBuild-
// Som` from a separate compiled module that is not covered by busting
// `west.js`'s own cache entry alone.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const SOM_FLOOR_GUARD = require.resolve(
  path.join(root, "out", "build", "somCliFloorGuard.js"),
);

const PROJECT = "/work/native-sim-project";

function loadWest(stubs) {
  const modPath = require.resolve(path.join(root, "out", "west.js"));
  delete require.cache[modPath];
  delete require.cache[SOM_FLOOR_GUARD];
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
    delete require.cache[SOM_FLOOR_GUARD];
  }
}

test("ensureNativeSimOverlay generates the overlay in the resolved project root, not undefined", async () => {
  const calls = [];
  const { ensureNativeSimOverlay } = loadWest({
    vscode: { window: { showInputBox: async ({ value }) => value } },
    "./alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args, cwd, options) => {
        calls.push({ args, cwd, options });
        return { outcome: { ok: true, message: "" } };
      },
    },
    "./west/vscodeAdapter": {
      collectWestWorkspaceContext: () => ({
        workspaceRoot: PROJECT,
        sdkRoot: null,
        boardYamlPath: `${PROJECT}/board.yaml`,
        westCwd: null,
        pythonBinary: "python3",
      }),
      executeWestPlan: () => {},
      // false: the overlay does not exist yet, so generation must run.
      nativeSimOverlayExists: () => false,
    },
    "@alp-sdk/core/west/service": {
      createWestFlashPlan: () => ({}),
      createWestUpdatePlan: () => ({}),
    },
    "./util": { log() {} },
    "./notify/vscodeAdapter": { notify: async () => undefined },
    // `warnIfCliCannotBuildSom` (#606) lives one directory deeper than
    // `west.ts`, so ITS OWN requires are spelled "../..." — both spellings
    // need stubbing, same trap as test/west.somCliFloor.test.js.
    "../alpCli/vscodeAdapter": { probeTanVersion: async () => null },
    "../notify/vscodeAdapter": { notifyAsync() {} },
    "../util": { log() {} },
  });

  await ensureNativeSimOverlay({});

  const generate = calls.find((c) => c.args.includes("generate"));
  assert.ok(generate, "ensureNativeSimOverlay must spawn `tan generate`");
  assert.equal(
    generate.cwd,
    PROJECT,
    "an omitted cwd here writes boards/native_sim_native_64.overlay into " +
      "the extension host's own directory instead of the project root " +
      "`nativeSimOverlayExists` just checked",
  );
});

test("ensureNativeSimOverlay does nothing when the overlay already exists", async () => {
  const calls = [];
  const { ensureNativeSimOverlay } = loadWest({
    vscode: { window: { showInputBox: async ({ value }) => value } },
    "./alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args, cwd) => {
        calls.push({ args, cwd });
        return { outcome: { ok: true, message: "" } };
      },
    },
    "./west/vscodeAdapter": {
      collectWestWorkspaceContext: () => ({
        workspaceRoot: PROJECT,
        sdkRoot: null,
        boardYamlPath: `${PROJECT}/board.yaml`,
        westCwd: null,
        pythonBinary: "python3",
      }),
      executeWestPlan: () => {},
      nativeSimOverlayExists: () => true,
    },
    "@alp-sdk/core/west/service": {
      createWestFlashPlan: () => ({}),
      createWestUpdatePlan: () => ({}),
    },
    "./util": { log() {} },
    "./notify/vscodeAdapter": { notify: async () => undefined },
    "../alpCli/vscodeAdapter": { probeTanVersion: async () => null },
    "../notify/vscodeAdapter": { notifyAsync() {} },
    "../util": { log() {} },
  });

  await ensureNativeSimOverlay({});

  assert.deepEqual(calls, [], "an existing overlay must not be regenerated");
});
