// SPDX-License-Identifier: Apache-2.0
//
// #340 review finding (MAJOR): nothing pinned that the REAL (non-preview)
// `tan debug-config` invocation carries `--svd` — only the pure
// `debugConfigArgs` unit tests and the failure-hint tests exercised it, and
// every failure-hint test uses a FAILING outcome, so `writeLaunchProfile`
// early-returns at `if (!preview) return null` and only the first
// (`--preview`) argv is ever observed. Proved by mutation: rewriting the real
// call site's `debugConfigArgs(spec, { svdPath })` to `debugConfigArgs(spec)`
// left every other debug test green.
//
// This file drives `alp.configureDebugProfile` to a SUCCESSFUL preview AND a
// successful real write — both `runAlpCommand` calls resolve with `ok: true`
// — so both argvs are captured, and asserts `--svd` is present in BOTH, with
// the SAME value. The regression this closes: a preview showing `svdFile`
// and a written `launch.json` missing it, with every other test still green.
//
// Same `Module._load` swap as test/debug.skewHint.test.js and
// test/debug.svdFailureHint.test.js. `./debug/launchJsonFile` is stubbed to a
// document-not-found shape (`null`) purely so `gradeWrittenLaunchConfig`
// takes its documented fallback path (grade the envelope, `source:
// "cliEnvelope"`) rather than because anything about that read is under test
// here — `test/debug.gradedConfig.test.js` owns that.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

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

/** Runs `alp.configureDebugProfile` to completion against a tan that succeeds
 *  on BOTH invocations, with `alpSdk.svdPath` reading back as `svdPath`, and
 *  returns every argv `runAlpCommand` was called with. */
async function configureSuccessfullyWith(svdPath) {
  const argv = [];

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
    "./debug/launchJsonFile": {
      readLaunchJsonDocument: () => null,
      writeLaunchJsonDocument: () => undefined,
    },
    "./alpCli/vscodeAdapter": {
      runAlpCommand: async (_context, args) => {
        argv.push([...args]);
        return {
          outcome: {
            ok: true,
            envelope: {
              data: {
                launchJsonPath: path.join(
                  root,
                  "does-not-exist-pre-first-build",
                  ".vscode",
                  "launch.json",
                ),
                replaced: false,
                notes: [],
                configuration: { name: "ALP: Zephyr Debug (J-Link)" },
              },
            },
          },
        };
      },
    },
    "./west": { ensureNativeSimOverlay: async () => true },
    "./util": { log() {}, showOutput() {} },
    "./notify/vscodeAdapter": { notify: async () => undefined },
    "./project/vscodeAdapter": { readSvdPath: () => svdPath },
  });

  const handlers = new Map(
    registerDebugCommands({}).map((entry) => [entry.id, entry.handler]),
  );
  await handlers.get("alp.configureDebugProfile")();
  return argv;
}

test("a successful preview AND a successful real write both carry --svd, with the same value", async () => {
  const argv = await configureSuccessfullyWith("vendor/E8.svd");

  assert.equal(argv.length, 2, "both the preview and the real write ran");

  for (const [label, call] of [
    ["preview", argv[0]],
    ["real write", argv[1]],
  ]) {
    const at = call.indexOf("--svd");
    assert.notEqual(at, -1, `${label} argv is missing --svd: ${call}`);
    assert.equal(call[at + 1], "vendor/E8.svd", `${label} argv's --svd value`);
  }

  // The real write specifically — not just "some argv somewhere" — is the
  // regression #340 review caught: a mutation dropping svdPath from ONLY the
  // real call site left every other test green.
  assert.ok(
    argv[1].includes("--preview") === false,
    "the real write must not itself carry --preview",
  );
});

test("no alpSdk.svdPath set: neither the preview nor the real write carries --svd", async () => {
  const argv = await configureSuccessfullyWith("");

  assert.equal(argv.length, 2);
  assert.equal(argv[0].includes("--svd"), false);
  assert.equal(argv[1].includes("--svd"), false);
});
