// SPDX-License-Identifier: Apache-2.0
//
// #614: `tan sdk current` is never called, so tan's own resolution ladder
// (project pin > global default > discovery) and `alpSdk.path` can disagree
// with nothing asking tan who won.
//
// `reconcileActiveSdkAfterBootstrap` asks `tan sdk current` and pins
// `alpSdk.path` through the SAME writer (`setActiveSdk`) every other
// activation path already uses — but ONLY when nothing was pinned yet.
// Adversarial review of the first version found it circular (handing tan
// this extension's own answer via `--sdk-root` and treating the echo as
// evidence) and destructive (overwriting a customer's deliberate, non-empty
// pin on a disagreement with no reliable relocation signal behind it) —
// both pinned below by a driven mutation, not just a passing assertion.
//
// Drives the REAL `out/sdk/activeSdk.js` (same `Module._load` swap as
// test/bootstrap.noWorkspace.test.js). `src/notify/service.ts` is pure, so it
// is loaded FOR REAL — the asserted message is the one the customer sees, not
// a copy of it in a stub.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

const {
  narrowSdkCurrent,
} = require("../packages/alp-core/dist/sdk/service.js");

/** Load out/sdk/activeSdk.js with `stubs` standing in for the requires named.
 *  Swaps Node's loader only for the duration of the synchronous require, so it
 *  never leaks into another test file sharing the process. */
function loadActiveSdk(stubs) {
  const modPath = require.resolve(
    path.join(root, "out", "sdk", "activeSdk.js"),
  );
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

/** A well-formed "found, ready" `tan sdk current` payload at path/tier. */
function foundData(sdkPath, sourceTier, readinessState = "ready") {
  return {
    subcommand: "current",
    sdkPath,
    readiness: {
      sdkPath,
      version: "0.16.0",
      loaderScriptPresent: readinessState !== "missing",
      metadataPresent: true,
      state: readinessState,
      issues: [],
    },
    sourceTier,
  };
}

const NONE_DATA = {
  subcommand: "current",
  sdkPath: null,
  readiness: null,
  sourceTier: "none",
};

/**
 * @param {object} opts
 * @param {unknown} opts.sdkCurrentData - what `fetchEnvelopeResult` resolves
 *   `data` to (the RAW, untrusted `tan sdk current` payload — narrowed inside
 *   the module under test, exactly like the real call site does).
 * @param {boolean} [opts.ok] - the envelope's own `ok` (default true).
 * @param {unknown[]} [opts.issues] - the envelope's own `issues[]`.
 * @param {string} [opts.configuredPath] - the CURRENT `alpSdk.path` setting.
 */
function register({
  sdkCurrentData,
  ok = true,
  issues = [],
  configuredPath = "",
}) {
  const envelopeCalls = [];
  const writes = [];
  const plans = [];
  const logs = [];

  const { reconcileActiveSdkAfterBootstrap } = loadActiveSdk({
    "@alp-sdk/core/sdk/service": {
      // `setActiveSdk`'s own poison-guard probe: every scenario below feeds
      // it a path it should treat as a real SDK root, so a repoint is never
      // refused for a reason unrelated to what this file tests.
      checkSdkReadiness: (sdkPath) => ({
        sdkPath,
        version: null,
        loaderScriptPresent: true,
        metadataPresent: true,
        state: "ready",
        issues: [],
      }),
      clearActiveSdkPointer: () => false,
      switchActiveSdk: () => {},
      westManifestLogLine: () => null,
      westManifestWarning: () => null,
      narrowSdkCurrent,
    },
    fs: { existsSync: () => true, readFileSync: () => "" },
    vscode: {
      workspace: {
        workspaceFolders: undefined,
        getConfiguration: () => ({
          get: (_key, fallback) => configuredPath || fallback,
        }),
      },
      commands: { executeCommand: async () => undefined },
      ConfigurationTarget: { Workspace: 2, Global: 1 },
    },
    "../alpCli/service": { SUPPORTED_CLI_VERSION: "0.6.0" },
    "../environment/vscodeAdapter": { danglingWestManifest: () => null },
    "../ideHub/vscodeAdapter": { queryAlpIdeState: async () => null },
    "../notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return undefined;
      },
      notifyAsync: (plan) => {
        plans.push(plan);
      },
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot: null }),
    },
    "../util": { log: (line) => logs.push(line) },
    "./settingsWrite": {
      writeAlpSetting: async (key, value, target) => {
        writes.push({ key, value, target });
        return true;
      },
    },
    "../alpCli/envelope": {
      fetchEnvelopeResult: async (_context, args, cwd, options) => {
        envelopeCalls.push({ args, cwd, options });
        return { data: sdkCurrentData, ok, issues };
      },
    },
  });

  return {
    reconcileActiveSdkAfterBootstrap,
    envelopeCalls,
    writes,
    plans,
    logs,
  };
}

test("reconcileActiveSdkAfterBootstrap asks `tan sdk current` in the bootstrap's own cwd", async () => {
  const { reconcileActiveSdkAfterBootstrap, envelopeCalls } = register({
    sdkCurrentData: NONE_DATA,
  });

  await reconcileActiveSdkAfterBootstrap({}, "/workspace/app");

  assert.equal(envelopeCalls.length, 1);
  assert.deepEqual(envelopeCalls[0].args, ["sdk", "current"]);
  assert.equal(envelopeCalls[0].cwd, "/workspace/app");
});

// BLOCKER 1 (adversarial review): `runAlpCommand`'s `withSdkRoot` hands tan
// this extension's OWN resolved SDK as `--sdk-root` unless told not to, and
// tan reports it straight back at `sourceTier: "sdkRootFlag"` — the caller
// asked tan to confirm a fact it just told tan, and mistook the echo for
// independent evidence. `injectSdkRoot: false` is the fix; this pins that the
// call site actually asks for it.
test("reconcileActiveSdkAfterBootstrap asks tan for its OWN independent resolution (injectSdkRoot: false)", async () => {
  const { reconcileActiveSdkAfterBootstrap, envelopeCalls } = register({
    sdkCurrentData: NONE_DATA,
  });

  await reconcileActiveSdkAfterBootstrap({}, "/workspace/app");

  assert.equal(
    envelopeCalls[0].options?.injectSdkRoot,
    false,
    "without this, tan is handed --sdk-root <this extension's own answer> " +
      "and just echoes it back — never independent evidence",
  );
});

test("reconcileActiveSdkAfterBootstrap pins alpSdk.path when nothing was pinned yet", async () => {
  const { reconcileActiveSdkAfterBootstrap, writes, plans } = register({
    configuredPath: "",
    sdkCurrentData: foundData("/home/dev/.alp/sdk/v0.16.0-rc1", "discovery"),
  });

  await reconcileActiveSdkAfterBootstrap({}, "/workspace/app");

  assert.equal(writes.length, 1, "the SAME writer setActiveSdk always uses");
  assert.equal(writes[0].key, "path");
  assert.equal(writes[0].value, "/home/dev/.alp/sdk/v0.16.0-rc1");
  // MINOR 11: the write target is asserted, not just captured — a stale
  // GLOBAL alpSdk.path would otherwise be silently shadowed rather than
  // reconciled by a Workspace-scoped write.
  assert.equal(writes[0].target, 1, "Global scope, per no open folder");

  // Major 3: a REAL toast (an action is what makes `planSuccess` pick
  // "toast" over the five-second status-bar blip `setActiveSdk`'s OWN
  // generic success message uses — both fire here, so this picks the toast
  // SPECIFICALLY, not just "any message").
  const toast = plans.find((p) => p.channel === "toast");
  assert.ok(toast, "must tell the customer via a real toast, not just a blip");
  assert.ok(toast.actions?.length > 0);
  assert.match(toast.message, /\/home\/dev\/\.alp\/sdk\/v0\.16\.0-rc1/);
  // Never claim a relocation this call cannot prove happened.
  assert.doesNotMatch(toast.message, /moved/i);
});

// BLOCKER 2 (adversarial review): a set-but-currently-unresolvable pin (an
// unplugged external drive, a not-yet-cloned SDK) used to fall through to
// tan's globalDefault tier and get silently overwritten -- destroying a
// deliberate pin the customer still owns, with a message claiming a
// relocation that was never observed.
test("reconcileActiveSdkAfterBootstrap NEVER overwrites a non-empty alpSdk.path pin", async () => {
  const { reconcileActiveSdkAfterBootstrap, writes, plans, logs } = register({
    configuredPath: "/Volumes/ext/alp-sdk",
    sdkCurrentData: foundData(
      "/home/dev/.alp/sdk/v0.16.0-rc1",
      "globalDefault",
    ),
  });

  await reconcileActiveSdkAfterBootstrap({}, "/workspace/app");

  assert.deepEqual(
    writes,
    [],
    "a non-empty pin is the customer's own choice -- disagreement alone is " +
      "not a reliable relocation signal (tan-cli#464: a foreign project's " +
      "bootstrap can answer the shared global default) and must never " +
      "destroy it",
  );
  assert.deepEqual(plans, [], "no unsolicited toast for a pin left alone");
  assert.ok(
    logs.some((l) => /disagrees/i.test(l)),
    "the disagreement is still reported to the channel, just not acted on",
  );
});

test("reconcileActiveSdkAfterBootstrap writes nothing when tan agrees with alpSdk.path", async () => {
  const { reconcileActiveSdkAfterBootstrap, writes } = register({
    configuredPath: "/same/alp-sdk",
    sdkCurrentData: foundData("/same/alp-sdk", "projectPin"),
  });

  await reconcileActiveSdkAfterBootstrap({}, "/workspace/app");

  assert.deepEqual(writes, []);
});

test("reconcileActiveSdkAfterBootstrap writes nothing when tan resolves no SDK at all", async () => {
  const { reconcileActiveSdkAfterBootstrap, writes } = register({
    configuredPath: "",
    sdkCurrentData: NONE_DATA,
  });

  await reconcileActiveSdkAfterBootstrap({}, "/workspace/app");

  assert.deepEqual(
    writes,
    [],
    "a `sdkPath: null` answer must never repoint alpSdk.path to nothing",
  );
});

test("reconcileActiveSdkAfterBootstrap writes nothing when the envelope itself failed", async () => {
  const { reconcileActiveSdkAfterBootstrap, writes } = register({
    configuredPath: "",
    ok: false,
    sdkCurrentData: undefined,
  });

  await reconcileActiveSdkAfterBootstrap({}, "/workspace/app");

  assert.deepEqual(writes, []);
});

// MAJOR 5 (adversarial review): tan's `readiness.state: "missing"` used to
// still get written, and `setActiveSdk`'s OWN poison-guard then popped a
// "That folder is not an Alp SDK root." error dialog + "Choose Another
// Folder" out of a background task the customer never asked this question of.
test("reconcileActiveSdkAfterBootstrap does not act on a resolved-but-unready SDK", async () => {
  const { reconcileActiveSdkAfterBootstrap, writes, plans } = register({
    configuredPath: "",
    sdkCurrentData: foundData(
      "/home/dev/.alp/sdk/broken",
      "discovery",
      "missing",
    ),
  });

  await reconcileActiveSdkAfterBootstrap({}, "/workspace/app");

  assert.deepEqual(writes, []);
  assert.deepEqual(
    plans,
    [],
    "no error dialog erupting from an unattended background check",
  );
});

// MAJOR 6 (adversarial review): `isEnvelope` only validates that `issues` is
// an array, never each entry's shape -- a `null` entry used to throw
// `Cannot read properties of null (reading 'message')` before any repoint was
// even attempted, and got mislogged upstream as "reconcile failed" even
// though nothing had actually gone wrong with the repoint logic itself.
test("reconcileActiveSdkAfterBootstrap tolerates a malformed issues[] entry instead of throwing", async () => {
  const { reconcileActiveSdkAfterBootstrap, writes } = register({
    configuredPath: "",
    issues: [null, { code: "x", severity: "warning", message: "real one" }],
    sdkCurrentData: NONE_DATA,
  });

  // Must not throw.
  await reconcileActiveSdkAfterBootstrap({}, "/workspace/app");
  assert.deepEqual(writes, []);
});
