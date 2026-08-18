// SPDX-License-Identifier: Apache-2.0
//
// The `alpSdk.svdPath` failure hint `runDebugConfig` (`src/debug.ts`) adds to
// a `debug-config` failure (#340).
//
// tan-cli#214: a `--svd` naming a path that is not a readable file is a HARD
// failure of the whole `debug-config` command — no `launch.json` at all, not
// even one missing the SVD key, and it never falls back to dropping just that
// key. Without a hint pointing at the setting, that symptom is
// indistinguishable from "debug is broken" — a customer who set
// `alpSdk.svdPath` gets the exact same generic toast as one who never touched
// it. This file pins that the hint fires ONLY when `--svd` is actually on the
// argv (i.e. the setting was actually set), and names the setting by key so
// it is actionable rather than a vague "something is wrong".
//
// It ALSO pins the narrower half of the guard (#340 review, MINOR): the hint
// is scoped to `outcome.kind === "internal"` (tan's exit 5, which is where
// BOTH `--svd` failure modes land — confirmed against the pinned tan's
// `ExitCode::InternalFailure`), not "any failure while --svd is on the
// argv". A wide version double-fires on a stale tan that does not recognise
// `--svd` at all (exit 2 / `"validation"`): the skew hint ("update tan")
// AND the svd hint (Open Settings on a setting that was never the problem)
// would both show, and the wrong remedy is the more actionable-looking one.
//
// Same `Module._load` swap as test/debug.skewHint.test.js, driving the real
// registered `alp.configureDebugProfile` handler out of `out/debug.js` so the
// guard and the notification plan it produces are the shipped ones.

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
 * with `alpSdk.svdPath` reading back as `svdPath`, and returns
 * `{ argv, plans }` — the argv the extension really built (`--svd` included
 * or not, exactly as `debugConfigArgs` would decide) and every notification
 * plan it produced.
 *
 * `workspaceRoot` does not exist, matching the skew-hint harness's
 * pre-first-build shape — irrelevant here (no `--core` assertions are made)
 * but kept so the two harnesses stay easy to compare.
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
    // The one seam `readSvdPath` (`src/project/vscodeAdapter.ts`) is behind —
    // stubbed directly rather than via a `vscode.workspace.getConfiguration`
    // mock, so this test exercises exactly what `debugConfigArgs` receives.
    "./project/vscodeAdapter": { readSvdPath: () => svdPath },
  });

  const handlers = new Map(
    registerDebugCommands({}).map((entry) => [entry.id, entry.handler]),
  );
  await handlers.get("alp.configureDebugProfile")();
  return { argv, plans };
}

test("alpSdk.svdPath set + debug-config fails: the toast names the setting and offers to open it", async () => {
  const { argv, plans } = await configureWith(
    {
      ok: false,
      kind: "internal",
      message:
        "Alp: --svd path cannot be read: /home/dev/nope.svd (No such file or directory). " +
        "Pass the path to the vendor's own .svd file; the SDK ships none (alp-sdk#948).",
    },
    { svdPath: "vendor/nope.svd" },
  );

  // Precondition: the setting really did reach the argv this failure is about.
  assert.equal(argv.length, 1, "the preview run is where it fails");
  assert.ok(argv[0].includes("--svd"), "the argv under test must carry --svd");

  assert.equal(plans.length, 1);
  assert.match(plans[0].message, /alpSdk\.svdPath/);
  assert.ok(
    plans[0].actions.some(
      (action) =>
        action.id === "openSettings" && action.arg === "alpSdk.svdPath",
    ),
    `expected an openSettings->alpSdk.svdPath action, got ${JSON.stringify(plans[0].actions)}`,
  );
  // The raw path/errno stays in `detail`, never in the customer-facing
  // sentence — the one contract every notify plan in this repo must keep.
  assert.equal(plans[0].message.includes("/home/dev/nope.svd"), false);
});

test("alpSdk.svdPath unset: a debug-config failure names neither the setting nor an openSettings action", async () => {
  const { argv, plans } = await configureWith({
    ok: false,
    kind: "runtime",
    message: "board.yaml: som.sku is required",
  });

  assert.equal(argv[0].includes("--svd"), false);
  assert.equal(plans.length, 1);
  assert.doesNotMatch(plans[0].message, /alpSdk\.svdPath/);
  assert.equal(
    plans[0].actions.some((action) => action.id === "openSettings"),
    false,
  );
});

test("a stale tan that does not recognise --svd is named as CLI skew, never blamed on alpSdk.svdPath", async () => {
  // A perfectly good alpSdk.svdPath, on a tan too old to know the flag:
  // clap's own "unexpected argument" refusal is exit 2 / "validation", not
  // exit 5 / "internal" — the same shape the v0.3.1 field report caught for
  // `--core`. Only the skew hint may fire here; the wide "any failure"
  // version of the svd hint would fire alongside it and point at a setting
  // that was never the problem.
  const { argv, plans } = await configureWith(
    {
      ok: false,
      kind: "validation",
      message: "error: unexpected argument '--svd' found",
    },
    { svdPath: "vendor/E8.svd" },
  );

  assert.ok(argv[0].includes("--svd"), "the argv under test must carry --svd");

  assert.equal(plans.length, 1);
  assert.equal(
    plans[0].message,
    `Alp: the debug configuration could not be generated. This extension requires tan ${SUPPORTED_CLI_VERSION} or newer; run "Alp: Update CLI" and retry.`,
  );
  assert.doesNotMatch(plans[0].message, /alpSdk\.svdPath/);
  assert.equal(
    plans[0].actions.some(
      (action) =>
        action.id === "openSettings" && action.arg === "alpSdk.svdPath",
    ),
    false,
    "the svd hint must not fire alongside the skew hint",
  );
});
