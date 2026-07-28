// SPDX-License-Identifier: Apache-2.0
//
// The other half of the `http.proxy` wiring (#379): the two network-bound child
// processes that are NOT `tan`, driven through the REAL modules that launch
// them. `west update` (`src/west/vscodeAdapter.ts`) clones and fetches from
// GitHub; the SDK install runs `git clone` against GitHub
// (`src/ideHub/sdkManagerMessages.ts`). Both fail on a proxied machine for the
// identical reason `tan sdk list` did, and both were wired for it — with
// nothing loading either module in a test that inspects `env`, so dropping the
// gap-fill from either was a one-line edit the whole suite stayed green for.
//
// `proxyEnvAdditions` is the REAL one in both cases (only `vscode` is stubbed,
// to supply `http.proxy`), so these assert the shipped precedence rule, not a
// double's idea of it.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const WEST_ADAPTER = require.resolve(
  path.join(root, "out", "west", "vscodeAdapter.js"),
);
const SDK_MESSAGES = require.resolve(
  path.join(root, "out", "ideHub", "sdkManagerMessages.js"),
);
// Both modules under test reach `proxyEnvAdditions` through this one, and it
// reads `http.proxy` at CALL time off the `vscode` module it captured at LOAD
// time. Left in the require cache it would keep the FIRST test's stub for every
// later one — every assertion below would then be about whichever harness
// happened to run first, and would pass or fail for reasons unrelated to its
// own subject. Evicted per load so each case gets its own.
const ALP_ADAPTER = require.resolve(
  path.join(root, "out", "alpCli", "vscodeAdapter.js"),
);

/** Load `modulePath` fresh with `stubs` swapped in for the named requires. */
function loadWith(modulePath, stubs) {
  delete require.cache[modulePath];
  delete require.cache[ALP_ADAPTER];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
    delete require.cache[ALP_ADAPTER];
  }
}

/** `http.proxy` = `proxySetting`; every other setting takes its fallback. */
function vscodeStub(proxySetting, extra = {}) {
  return {
    workspace: {
      getConfiguration: (section) => ({
        get: (key, fallback) =>
          section === "http" && key === "proxy" ? proxySetting : fallback,
      }),
    },
    ...extra,
  };
}

/** Run `fn` with `process.env` patched, then put it back exactly. A patch value
 *  of `undefined` DELETES the variable — assigning it would store the string
 *  "undefined", which reads as "the user exported a proxy". */
async function withEnv(patch, fn) {
  const saved = new Map(
    Object.keys(patch).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const NO_PROXY_ENV = {
  HTTPS_PROXY: undefined,
  HTTP_PROXY: undefined,
  ALL_PROXY: undefined,
};

// ── west update ──────────────────────────────────────────────────────────────

/** Run one west plan through the real `executeWestPlan` and return the
 *  `runInTerminal` options it produced. */
function westRunFor(proxySetting, plan) {
  const runs = [];
  const west = loadWith(WEST_ADAPTER, {
    vscode: vscodeStub(proxySetting),
    "../util": { log() {}, runInTerminal: (options) => runs.push(options) },
    "../project/vscodeAdapter": { collectProjectContext: () => ({}) },
  });
  west.executeWestPlan(plan);
  assert.equal(runs.length, 1, "executeWestPlan did not reach runInTerminal");
  return runs[0];
}

test("executeWestPlan hands the proxy to `west update`", async () => {
  const run = await withEnv(NO_PROXY_ENV, () =>
    westRunFor("http://proxy.corp:8080", {
      terminalName: "Alp: West Update",
      args: ["west", "update"],
      westCwd: null,
      env: {},
    }),
  );
  assert.ok(
    run.env,
    "`west update` clones and fetches from GitHub, and this task inherits the " +
      "extension host's environment rather than a login shell's — with no " +
      "`env` it is as blind to http.proxy as `tan sdk list` was",
  );
  assert.equal(run.env.HTTPS_PROXY, "http://proxy.corp:8080");
  assert.equal(run.env.HTTP_PROXY, "http://proxy.corp:8080");
});

test("executeWestPlan lets the plan's own vars win over the proxy gap-fill", async () => {
  const run = await withEnv(NO_PROXY_ENV, () =>
    westRunFor("http://proxy.corp:8080", {
      terminalName: "Alp: West Build",
      args: ["west", "build"],
      westCwd: null,
      // The plan carries the SDK-derived vars. Spreading it last is what keeps
      // a future proxy key from silently shadowing one of them.
      env: { EXTRA_ZEPHYR_MODULES: "/opt/alp-sdk", HTTPS_PROXY: "from-plan" },
    }),
  );
  assert.equal(run.env.EXTRA_ZEPHYR_MODULES, "/opt/alp-sdk");
  assert.equal(run.env.HTTPS_PROXY, "from-plan");
});

test("executeWestPlan leaves an exported proxy alone", async () => {
  const run = await withEnv(
    { HTTPS_PROXY: "http://from-shell:3128", ALL_PROXY: undefined },
    () =>
      westRunFor("http://from-settings:8080", {
        terminalName: "Alp: West Update",
        args: ["west", "update"],
        westCwd: null,
        env: {},
      }),
  );
  assert.equal(
    run.env.HTTPS_PROXY,
    undefined,
    "the variable the user exported is already in the environment this task " +
      "merges into; writing the setting over it is the override this rule bans",
  );
});

// ── the SDK-install `git clone` ──────────────────────────────────────────────

/** Drive the real `requestSdkInstall` handler far enough to reach `cp.spawn`,
 *  and return the options object it was handed. */
async function cloneOptionsFor(proxySetting) {
  let captured = null;
  const sdk = loadWith(SDK_MESSAGES, {
    vscode: vscodeStub(proxySetting, {
      ProgressLocation: { Notification: 15 },
      window: {
        withProgress: (_options, task) =>
          task(
            { report() {} },
            { onCancellationRequested: () => ({ dispose() {} }) },
          ),
      },
    }),
    child_process: {
      spawn: (_command, _args, options) => {
        captured = options;
        return {
          on(event, handler) {
            if (event === "exit") setImmediate(() => handler(0));
          },
        };
      },
      // `execFile` and `spawnSync` are for the REAL `alpCli/vscodeAdapter`
      // loaded transitively — it promisifies `execFile` at module load, so it
      // has to exist even though nothing here calls it.
      execFile: () => {},
      spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
    },
    fs: {
      mkdirSync() {},
      // No existing install, so the handler takes the CLONE branch rather than
      // the "already installed" early return.
      existsSync: () => false,
      readFileSync: () => "",
      rmSync() {},
    },
    // The service is pure and separately tested; here it only has to invoke the
    // adapter, which is the thing under test.
    "@alp-sdk/core/sdk/service": {
      installSdkRelease: (version, cacheRoot, adapter) =>
        adapter(version, path.join(cacheRoot, version)),
    },
    "./vscodeAdapter": { sdkCacheRoot: () => path.join(root, "no-such-cache") },
    "../sdk/activeSdk": {
      clearActiveSdk: async () => {},
      setActiveSdk: async () => {},
      warnIfWestManifestDangling: () => false,
    },
    "../sdk/settingsWrite": { writeAlpSetting: async () => {} },
    "../notify/vscodeAdapter": {
      notify: async () => undefined,
      notifyAsync() {},
    },
    // `../util` and `../project/vscodeAdapter` are stubbed for the REAL
    // `alpCli/vscodeAdapter` this module pulls in transitively — that one has
    // to be the real thing (it owns `proxyEnvAdditions`), but nothing below it
    // should reach a live output channel or the filesystem.
    "../project/vscodeAdapter": { collectProjectContext: () => ({}) },
    "../util": { log() {}, runInTerminal() {} },
  });
  const handled = sdk.createSdkMessageHandler({
    context: {},
    post() {},
    refresh: async () => {},
  })({ type: "requestSdkInstall", version: "v0.6.0" });
  assert.ok(handled, "the handler did not consume requestSdkInstall");
  // The handler is fire-and-forget; let its promise chain settle.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(captured, "cp.spawn was never called — the harness is broken");
  return captured;
}

test("the SDK-install `git clone` gets the proxy, and keeps the rest of the environment", async () => {
  const options = await withEnv(NO_PROXY_ENV, () =>
    cloneOptionsFor("http://proxy.corp:8080"),
  );
  assert.ok(
    options.env,
    "git reads HTTPS_PROXY, and a corporate machine that needs a proxy to " +
      "reach GitHub fails this clone for the identical reason tan did",
  );
  assert.equal(options.env.HTTPS_PROXY, "http://proxy.corp:8080");
  // `env` REPLACES the environment for cp.spawn (unlike ProcessExecution), so
  // the inherited variables have to be carried across explicitly — dropping the
  // spread would take PATH away from `git` and NO_PROXY away from its routing.
  assert.equal(options.env.PATH, process.env.PATH);
});

test("the SDK-install `git clone` leaves an exported proxy alone", async () => {
  const options = await withEnv(
    { HTTPS_PROXY: "http://from-shell:3128", ALL_PROXY: undefined },
    () => cloneOptionsFor("http://from-settings:8080"),
  );
  assert.equal(options.env.HTTPS_PROXY, "http://from-shell:3128");
});
