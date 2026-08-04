// SPDX-License-Identifier: Apache-2.0
//
// The version-skew hint `runDebugConfig` (`src/debug.ts`) adds to a
// `debug-config` failure.
//
// tan exits 2 — the envelope's `validation` kind — both for a project it
// refuses and for an argument its clap definition has never heard of. The two
// need different words: one is "fix your board.yaml", the other is "your tan
// is older than this extension". `src/debug.ts` tells them apart by asking
// whether the argv carried a flag younger than the oldest tan a customer might
// still have, and only then appends `Alp: Update CLI`.
//
// The list of young flags was `--core` alone, from the v0.3.1 field report.
// #406 added a second one, `--pre-launch-task` (tan-cli#85, shipped in 0.4.0),
// and the case below is the one it opens up: the FIRST F5 on a fresh clone.
// There is no `build/system-manifest.yaml` yet, so `resolveManifestSlice`
// returns undefined and `--core` is not in the argv at all — the only young
// flag present is `--pre-launch-task`. Pinned here rather than left to review
// because nothing else can see it: `debugConfigArgs` is pure and knows nothing
// about failures, and the argv suite in test/debug.configArgs.test.js asserts
// what is SENT, never what is said when tan refuses it.
//
// Drives the real registered `alp.configureDebugProfile` handler out of
// `out/debug.js` (same `Module._load` swap as test/debug.supportBundle.test.js)
// so the guard, the argv it inspects and the notification plan are the shipped
// ones. `./notify/service` is pure and is loaded FOR REAL, so `plan.message`
// here is the sentence a customer sees.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

const { SUPPORTED_CLI_VERSION } = require(
  path.join(root, "out", "alpCli", "service.js"),
);

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

/**
 * Runs `alp.configureDebugProfile` against a tan that fails with `outcome`,
 * and returns { argv, plans } — the argv the extension really built and every
 * notification plan it produced.
 *
 * `workspaceRoot` is a path that does not exist, which is what makes this the
 * pre-first-build case: `resolveManifestSlice` finds no
 * `build/system-manifest.yaml`, so no `--core` is appended.
 */
async function configureWith(outcome, { svdPath = "" } = {}) {
  const argv = [];
  const plans = [];

  const { registerDebugCommands } = loadDebug({
    vscode: {
      commands: {
        registerCommand(id, handler) {
          return { id, handler, dispose() {} };
        },
      },
      window: {
        // Zephyr MCU, then J-Link: the head of each picker's list.
        showQuickPick: async (items) => items[0],
        showTextDocument: async () => undefined,
        withProgress: async (_options, task) =>
          task({ report() {} }, { onCancellationRequested() {} }),
      },
      workspace: {
        openTextDocument: async () => ({}),
        asRelativePath: (value) => value,
      },
      ProgressLocation: { Notification: 15 },
    },
    "./debug/vscodeAdapter": {
      collectWorkspaceDebugContext: () => ({
        workspaceRoot: path.join(root, "does-not-exist-pre-first-build"),
        sdkRoot: null,
        boardYamlPath: null,
        boardYamlExists: false,
        westCwd: null,
        pythonBinary: "python3",
        debuggerExtensions: {
          cortexDebug: true,
          cppTools: true,
          codeLLDB: true,
        },
      }),
      collectRuntimeCapabilities: () => ({}),
      fileExists: () => false,
      writeSupportBundle: () => "",
    },
    "./alpCli/vscodeAdapter": {
      runAlpCommand: async (_context, args) => {
        argv.push([...args]);
        return { outcome };
      },
    },
    "./west": { ensureNativeSimOverlay: async () => true },
    "./util": { log() {}, showOutput() {} },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return undefined;
      },
    },
    // `writeLaunchProfile` now reads `alpSdk.svdPath` directly via this
    // adapter (#340) rather than through `./debug/vscodeAdapter`'s already
    // fully-stubbed context, so it needs its own stub — the real module would
    // otherwise call `vscode.workspace.getConfiguration`, which the minimal
    // `vscode` stub above does not implement.
    "./project/vscodeAdapter": { readSvdPath: () => svdPath },
  });

  const handlers = new Map(
    registerDebugCommands({}).map((entry) => [entry.id, entry.handler]),
  );
  await handlers.get("alp.configureDebugProfile")();
  return { argv, plans };
}

const SKEW = ` This extension requires tan ${SUPPORTED_CLI_VERSION} or newer; run "Alp: Update CLI" and retry.`;

test("a --pre-launch-task refusal before the first build is named as version skew", async () => {
  const { argv, plans } = await configureWith({
    ok: false,
    kind: "validation",
    // What an older tan really says about an argument it does not know.
    message: "error: unexpected argument '--pre-launch-task' found",
  });

  // The precondition that makes this test mean something. If a `--core` ever
  // appears here the argv stopped being the pre-first-build one and the
  // assertion below would pass on the old guard too.
  assert.equal(argv.length, 1, "the preview run is where it fails");
  assert.ok(
    argv[0].includes("--pre-launch-task"),
    "the argv under test must carry --pre-launch-task",
  );
  assert.equal(
    argv[0].includes("--core"),
    false,
    "pre-first-build there is no manifest slice, so no --core",
  );

  assert.equal(plans.length, 1);
  assert.equal(
    plans[0].message,
    `Alp: the debug configuration could not be generated.${SKEW}`,
  );
});

test("a project tan really refuses is not blamed on the CLI version", async () => {
  // The other half, and the reason the guard is a flag list rather than
  // "always say Update CLI on exit 2": a genuine validation failure must not
  // send the customer to reinstall a tan that is doing its job. `--preview` is
  // in every argv and is NOT young, so it can never arm the hint.
  const { plans } = await configureWith({
    ok: false,
    kind: "runtime",
    message: "board.yaml: som.sku is required",
  });

  assert.equal(plans.length, 1);
  assert.equal(
    plans[0].message,
    "Alp: the debug configuration could not be generated.",
  );
});
