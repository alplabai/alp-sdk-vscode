// SPDX-License-Identifier: Apache-2.0
//
// #604/#614: `offerBootstrapFix`'s "no Zephyr workspace at all" branch used to
// call `runAlpInTerminal(["bootstrap"], ...)` directly — the SAME raw
// dispatch `src/bootstrap.ts` had, which parses nothing tan reports back. It
// now routes through the shared `runBootstrapInTerminal` (src/bootstrap.ts),
// so this offer gets the post-bootstrap `tan sdk current` reconciliation too,
// not just the palette/Setup-view command.
//
// Drives the REAL `out/toolchain.js` (same `Module._load` swap as
// test/bootstrap.noWorkspace.test.js). `src/notify/service.ts` is pure, so it
// is loaded FOR REAL.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

function loadToolchain(stubs) {
  const modPath = require.resolve(path.join(root, "out", "toolchain.js"));
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

function register() {
  const bootstrapCalls = [];
  const plans = [];

  const { offerBootstrapFix } = loadToolchain({
    "@alp-sdk/core/toolchain/bootstrapPlan": {
      bootstrapHost: () => "darwin",
      fixCommand: () => ({ kind: "guide", guide: { options: [] } }),
    },
    "@alp-sdk/core/sdk/service": {
      westManifestLogLine: () => null,
      westManifestWarning: () => null,
    },
    vscode: {
      commands: { executeCommand: async () => undefined },
      env: { openExternal: async () => true },
      Uri: { parse: (value) => value },
      window: { showQuickPick: async () => undefined },
      workspace: { workspaceFolders: [] },
    },
    "./bootstrap": {
      runBootstrapInTerminal: async (context, cwd) => {
        bootstrapCalls.push({ context, cwd });
      },
    },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return "custom"; // always accept the "Bootstrap now" offer
      },
      notifyAsync: (plan) => {
        plans.push(plan);
      },
    },
    "./util": { log() {}, runInTerminal() {} },
  });

  return { offerBootstrapFix, bootstrapCalls, plans };
}

test("offerBootstrapFix (no workspace at all) dispatches through runBootstrapInTerminal, not a raw runAlpInTerminal", async () => {
  const { offerBootstrapFix, bootstrapCalls } = register();

  await offerBootstrapFix({}, "/workspace/app", null);

  assert.equal(bootstrapCalls.length, 1);
  assert.equal(bootstrapCalls[0].cwd, "/workspace/app");
});
