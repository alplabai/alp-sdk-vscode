// SPDX-License-Identifier: Apache-2.0
//
// `runDebugConfig` (`src/debug.ts`) read only `outcome.envelope?.data`, so a
// SUCCESSFUL `tan debug-config` run's `issues[]` — the advisories tan emits
// alongside a resolved profile, e.g. a migrated legacy launch.json entry, a
// dropped comment, or an SDK-identity value it overwrote or could not resolve
// — were dropped entirely. The customer got a launch.json with no sign tan
// had any reservations about it (#611 point 3).
//
// Driven through the real registered `alp.configureDebugProfile` handler out
// of `out/debug.js`, same `Module._load` swap and harness as
// `test/debug.svdWiring.test.js` (a fully successful preview + write), with
// `./util`'s `log` replaced by a spy instead of a no-op so the channel lines
// `runDebugConfig` produces are observable.

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

const ADVISORY = {
  code: "debug-config.sdk-identity-overwrite",
  severity: "info",
  message:
    "Replaced the existing `device` value with the SDK's published identity for this variant.",
};

/** Runs `alp.configureDebugProfile` to completion against a tan that succeeds
 *  on both invocations, the REAL WRITE additionally carrying `ADVISORY` in
 *  its envelope's `issues[]` (the preview carries none, so a test asserting
 *  on "the channel line exists" cannot be satisfied by an over-wide guard
 *  that fires on every call regardless of content). Returns every line
 *  `log()` was called with. */
async function configureAndCollectLog() {
  const argv = [];
  const channel = [];

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
    "./debug/launchJsonFile": {
      readLaunchJsonDocument: () => null,
      writeLaunchJsonDocument: () => undefined,
    },
    "./alpCli/vscodeAdapter": {
      runAlpCommand: async (_context, args) => {
        argv.push([...args]);
        const preview = args.includes("--preview");
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
              issues: preview ? [] : [ADVISORY],
            },
          },
        };
      },
    },
    "./west": { ensureNativeSimOverlay: async () => true },
    "./util": { log: (line) => channel.push(line), showOutput() {} },
    "./notify/vscodeAdapter": { notify: async () => undefined },
    "./project/vscodeAdapter": { readSvdPath: () => "" },
  });

  const handlers = new Map(
    registerDebugCommands({}).map((entry) => [entry.id, entry.handler]),
  );
  await handlers.get("alp.configureDebugProfile")();
  return { argv, channel };
}

test("a successful debug-config write's advisory issue reaches the channel", async () => {
  const { argv, channel } = await configureAndCollectLog();

  assert.equal(argv.length, 2, "both the preview and the real write ran");
  assert.ok(
    channel.some((line) => line.includes(ADVISORY.message)),
    `expected the advisory's message on the channel, got: ${JSON.stringify(channel)}`,
  );
});

// Adversarial review (#611 follow-up): `writeLaunchProfile` calls
// `runDebugConfig` TWICE per run — once for `--preview`, once for the real
// write — and tan's own registry confirms at least two `debug-config.*`
// advisories fire on BOTH: `debug-config.sdk-identity-key-absent` ("Emitted
// on BOTH `--preview` and a write") and
// `debug-config.gdbserver-address-unresolved` ("both --preview and a
// write"). `ADVISORY` above (`sdk-identity-overwrite`) is write-only, so the
// test above cannot catch a double-log — this one uses a both-carrying code
// and asserts the message reaches the channel exactly once per run.
const BOTH_PATHS_ADVISORY = {
  code: "debug-config.gdbserver-address-unresolved",
  severity: "info",
  message:
    "The gdbserver address is still <host>:<port> -- fill in the deployed board's real host and port.",
};

async function configureWithAdvisoryOnBothCalls() {
  const argv = [];
  const channel = [];

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
                configuration: { name: "ALP: Yocto Debug (gdbserver)" },
              },
              // Fires on BOTH calls, unlike ADVISORY above.
              issues: [BOTH_PATHS_ADVISORY],
            },
          },
        };
      },
    },
    "./west": { ensureNativeSimOverlay: async () => true },
    "./util": { log: (line) => channel.push(line), showOutput() {} },
    "./notify/vscodeAdapter": { notify: async () => undefined },
    "./project/vscodeAdapter": { readSvdPath: () => "" },
  });

  const handlers = new Map(
    registerDebugCommands({}).map((entry) => [entry.id, entry.handler]),
  );
  await handlers.get("alp.configureDebugProfile")();
  return { argv, channel };
}

test("an advisory that fires on BOTH the preview and the write is logged once per run, not twice", async () => {
  const { argv, channel } = await configureWithAdvisoryOnBothCalls();

  assert.equal(argv.length, 2, "both the preview and the real write ran");
  const occurrences = channel.filter((line) =>
    line.includes(BOTH_PATHS_ADVISORY.message),
  );
  assert.equal(
    occurrences.length,
    1,
    `expected the advisory logged exactly once for one configure run, got ` +
      `${occurrences.length}: ${JSON.stringify(channel)}`,
  );
});
