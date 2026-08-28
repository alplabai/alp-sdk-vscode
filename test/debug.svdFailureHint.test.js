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
// It ALSO pins the narrower half of the guard, and what "narrower" MEANS here
// has changed. The original scoping was `outcome.kind === "internal"` (exit 5,
// measured against `ExitCode::InternalFailure` in what is now the RETIRED Rust
// oracle). Against the pinned tan 0.6.0 every live `--svd` failure is exit 2
// carrying `debug-config.invalid-argument` — measured: a missing path, a
// directory, and an empty string all land there — so an `internal`-only guard
// never fired at all. The guard now keys on that ISSUE CODE, with the exit-5
// arm kept only as cover for an older binary.
//
// What it must still refuse: firing on "any failure while --svd is on the
// argv". A stale tan that does not recognise the flag answers exit 2 too, with
// `cli.parse-error` — so a wide guard shows the skew hint ("update tan") AND
// the svd hint (Open Settings on a setting that was never the problem) side by
// side, with the wrong remedy the more actionable-looking one. Both stale-tan
// shapes are pinned below, the envelope-carrying one being the load-bearing
// case: a guard reading "any issue at all" passes every other test here.
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

// ---------------------------------------------------------------------------
// The shape the PINNED tan 0.6.0 actually returns.
//
// The two tests above fabricate `kind: "internal"` (exit 5). Measured against
// the pinned binary, an unreadable `--svd` is exit 2 -- `kind: "validation"` --
// carrying `debug-config.invalid-argument`:
//
//   {"ok":false,"exitCode":2,"issues":[{"code":"debug-config.invalid-argument",
//    "message":"Alp: --svd path cannot be read: /nonexistent/nope.svd ([Errno 2]
//    No such file or directory...). Pass the path to the vendor's own .svd file;
//    the SDK ships none (alp-sdk#948)."}]}
//
// So an `internal`-only guard never fires on the shipping CLI, and the skew
// hint -- keyed on `validation` plus a `--pre-launch-task` that is on the argv
// for three of the four target kinds -- fires instead, telling a customer with
// a bad path to update a CLI that is already current. Both hints classify on
// the ISSUE CODE now, which is what actually separates the two failures.

/** The measured 0.6.0 failure for an unreadable `--svd`. */
const INVALID_ARGUMENT_OUTCOME = {
  ok: false,
  kind: "validation",
  message:
    "Alp: --svd path cannot be read: /home/dev/nope.svd ([Errno 2] No such " +
    "file or directory). Pass the path to the vendor's own .svd file; the " +
    "SDK ships none (alp-sdk#948).",
  envelope: {
    command: "debug-config",
    ok: false,
    exitCode: 2,
    issues: [
      {
        code: "debug-config.invalid-argument",
        severity: "error",
        message: "Alp: --svd path cannot be read: /home/dev/nope.svd",
      },
    ],
  },
};

test("an unreadable --svd at the pinned tan still names the setting", async () => {
  const { argv, plans } = await configureWith(INVALID_ARGUMENT_OUTCOME, {
    svdPath: "vendor/nope.svd",
  });

  assert.ok(argv[0].includes("--svd"), "the argv under test must carry --svd");
  assert.equal(plans.length, 1);
  assert.match(
    plans[0].message,
    /alpSdk\.svdPath/,
    "exit 2 + debug-config.invalid-argument is the SHIPPING shape of this " +
      "failure; a guard that only fires on exit 5 never fires at all",
  );
  assert.ok(
    plans[0].actions.some(
      (action) =>
        action.id === "openSettings" && action.arg === "alpSdk.svdPath",
    ),
    `expected an openSettings->alpSdk.svdPath action, got ${JSON.stringify(plans[0].actions)}`,
  );
});

test("an unreadable --svd is NOT reported as a stale CLI", async () => {
  const { plans } = await configureWith(INVALID_ARGUMENT_OUTCOME, {
    svdPath: "vendor/nope.svd",
  });

  assert.doesNotMatch(
    plans[0].message,
    new RegExp(`requires tan ${SUPPORTED_CLI_VERSION.replace(/\./g, "\\.")}`),
    "the customer's CLI is current -- the bad path is theirs to fix, and " +
      "'run Alp: Update CLI' is the wrong remedy shown as the actionable one",
  );
});

test("a stale tan's cli.parse-error envelope still reads as CLI skew", async () => {
  // The stale-tan case above feeds an outcome with NO `envelope` key, so it
  // only ever exercised the `envelope === undefined` arm. A real stale tan
  // DOES send an envelope -- measured, `debug-config` with an unknown flag:
  //
  //   {"command":"cli","ok":false,"exitCode":2,...,"issues":[{
  //     "code":"cli.parse-error","severity":"error",
  //     "message":"...No such option: --svd..."}]}
  //
  // so the guard has to distinguish `cli.parse-error` from
  // `debug-config.invalid-argument` on two envelopes that are otherwise the
  // same shape and the same exit code. Without this case a guard reading "any
  // issue at all" passes the whole suite while getting both hints backwards.
  const { plans } = await configureWith(
    {
      ok: false,
      kind: "validation",
      message: "Usage: tan debug-config [OPTIONS]\nNo such option: --svd",
      envelope: {
        command: "cli",
        ok: false,
        exitCode: 2,
        issues: [
          {
            code: "cli.parse-error",
            severity: "error",
            message: "Usage: tan debug-config [OPTIONS]\nNo such option: --svd",
          },
        ],
      },
    },
    { svdPath: "vendor/E8.svd" },
  );

  assert.equal(plans.length, 1);
  assert.match(
    plans[0].message,
    new RegExp(`requires tan ${SUPPORTED_CLI_VERSION.replace(/\./g, "\\.")}`),
    "an unrecognised flag IS version skew -- updating tan is the right remedy",
  );
  assert.doesNotMatch(
    plans[0].message,
    /alpSdk\.svdPath/,
    "the setting was never the problem; pointing at it here is the wrong " +
      "remedy wearing the more actionable-looking button",
  );
});
