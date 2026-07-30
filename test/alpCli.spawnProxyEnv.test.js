// SPDX-License-Identifier: Apache-2.0
//
// The WIRING half of the `http.proxy` fix: that the env `proxyEnvOverrides`
// computes actually reaches `cp.spawn`, driven through the REAL `runAlpCommand`
// in out/alpCli/vscodeAdapter.js.
//
// Why this file exists as well as alpCli.proxyEnv.test.js: the pure function
// can be perfect and the fix still be entirely absent. `spawnAlpAsync` shipped
// as `cp.spawn(command, args, { cwd, signal })` — dropping `env` from that
// object again is a one-token edit that breaks nothing, typechecks (every
// `SpawnOptions` field is optional) and leaves the pure test green. This file
// is the assertion that fails when that happens. The adapter is loaded with its
// host requires swapped out via the same `Module._load` trick
// test/alpCli.aheadWarning.test.js uses; `runAlpAsync` is the REAL one, so the
// call chain from `runAlpCommand` to `cp.spawn` is the shipped one.
//
// `process.env` is mutated and restored around the precedence case on purpose:
// that IS the input the adapter reads, and stubbing it away would test a
// different function from the one that ships.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const ADAPTER = require.resolve(
  path.join(root, "out", "alpCli", "vscodeAdapter.js"),
);
const REAL_ADAPTER_CORE = require(
  path.join(root, "out", "alpCli", "adapterCore.js"),
);

/** A child that produces no output and exits 0 the moment it is listened to. */
function fakeChild() {
  const stream = { setEncoding() {}, on() {} };
  return {
    stdout: stream,
    stderr: stream,
    kill() {},
    on(event, handler) {
      if (event === "close") setImmediate(() => handler(0));
    },
  };
}

/**
 * Load a FRESH copy of the real adapter with `http.proxy` set to
 * `proxySetting`, and hand back both child-launch seams it can reach:
 * `cp.spawn` options (the in-process envelope path) and every `runInTerminal`
 * call (the TERMINAL path).
 *
 * `runInTerminal` used to be stubbed here as a bare no-op, which made both
 * terminal seams structurally invisible to this file — `runAlpInTerminal` could
 * lose its `env` with the whole suite still green, and that is the seam `tan
 * bootstrap` runs on: the command that downloads Zephyr and the pip packages,
 * i.e. the one that needs the proxy most.
 */
function loadAdapter(proxySetting) {
  delete require.cache[ADAPTER];
  let captured = null;
  const terminalRuns = [];
  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: (section) => ({
          get: (key, fallback) =>
            section === "http" && key === "proxy" ? proxySetting : fallback,
        }),
      },
    },
    child_process: {
      spawn: (_command, _args, options) => {
        captured = options;
        return fakeChild();
      },
      spawnSync: () => ({ status: 0, stdout: "tan 0.0.0\n", stderr: "" }),
      execFile: () => {},
    },
    "./adapterCore": {
      ...REAL_ADAPTER_CORE,
      // The one seam replaced: resolution would otherwise hit the filesystem
      // and, with nothing installed, try to DOWNLOAD. Everything downstream of
      // it — `runAlpAsync`, the curried spawner, `spawnAlpAsync` — is real.
      resolveAlpBinary: async () => ({ command: "tan", source: "cached" }),
    },
    "../notify/vscodeAdapter": {
      notify: async () => undefined,
      notifyAsync() {},
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: null,
        sdkRoot: null,
        boardYamlPath: null,
        westCwd: null,
        pythonBinary: "python",
      }),
    },
    "../util": {
      log() {},
      runInTerminal(options) {
        terminalRuns.push(options);
      },
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let adapter;
  try {
    adapter = require(ADAPTER);
  } finally {
    Module._load = originalLoad;
    delete require.cache[ADAPTER];
  }
  return {
    adapter,
    terminalRuns,
    spawnOptions: () => captured,
    // The REAL extension path: `installTanCliGlobally` refuses (and never
    // reaches `runInTerminal`) when the bundled installer is missing, so this
    // has to point where `media/tan-install/` actually is.
    context: {
      extensionPath: root,
      globalStorageUri: { fsPath: path.join(root, "no-such-storage-dir") },
      // `installTanCliGlobally` clears a stored consent decline on invocation
      // — a bare stub, this file doesn't assert on it.
      globalState: { update: async () => {} },
    },
  };
}

/**
 * Run one `tan` envelope command through the real adapter with `http.proxy` set
 * to `proxySetting`, and return the options object `cp.spawn` was handed.
 */
async function spawnOptionsFor(proxySetting) {
  const { adapter, spawnOptions, context } = loadAdapter(proxySetting);
  await adapter.runAlpCommand(context, ["sdk", "list"]);
  const captured = spawnOptions();
  assert.ok(captured, "cp.spawn was never called — the harness is broken");
  return captured;
}

/** The single `runInTerminal` options object `fn(adapter, context)` produced. */
async function terminalRunFor(proxySetting, fn) {
  const { adapter, terminalRuns, context } = loadAdapter(proxySetting);
  await fn(adapter, context);
  assert.equal(
    terminalRuns.length,
    1,
    "expected exactly one runInTerminal call — the harness is broken",
  );
  return terminalRuns[0];
}

/** Run `fn` with `process.env` patched, then put it back exactly. A patch value
 *  of `undefined` DELETES the variable — assigning it would store the string
 *  "undefined", which reads as "the user exported a proxy" and silently
 *  inverts every case below. */
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

test("http.proxy reaches the spawned tan as HTTPS_PROXY and HTTP_PROXY", async () => {
  const options = await withEnv(
    { HTTPS_PROXY: undefined, HTTP_PROXY: undefined, ALL_PROXY: undefined },
    () => spawnOptionsFor("http://proxy.corp:8080"),
  );
  assert.ok(
    options.env,
    "spawnAlpAsync passed no `env`, so the child inherits process.env verbatim " +
      "and http.proxy is ignored — this is issue #379 back again",
  );
  assert.equal(options.env.HTTPS_PROXY, "http://proxy.corp:8080");
  assert.equal(options.env.HTTP_PROXY, "http://proxy.corp:8080");
  // `env` REPLACES the environment for cp.spawn, so the rest of it has to be
  // carried across explicitly or the child loses PATH and every other variable.
  assert.equal(options.env.PATH, process.env.PATH);
});

test("an exported HTTPS_PROXY survives into the child, unchanged", async () => {
  const options = await withEnv(
    {
      HTTPS_PROXY: "http://from-shell:3128",
      NO_PROXY: "github.internal.corp",
      ALL_PROXY: undefined,
    },
    () => spawnOptionsFor("http://from-settings:8080"),
  );
  assert.equal(
    options.env.HTTPS_PROXY,
    "http://from-shell:3128",
    "the IDE setting must not overwrite a proxy the user exported deliberately",
  );
  assert.equal(
    options.env.NO_PROXY,
    "github.internal.corp",
    "NO_PROXY has no VS Code setting, so dropping it here would take a machine " +
      "that correctly goes direct and push it through the proxy",
  );
});

test("no http.proxy set: the child's environment is process.env unchanged", async () => {
  const options = await withEnv(
    { HTTPS_PROXY: undefined, HTTP_PROXY: undefined, ALL_PROXY: undefined },
    () => spawnOptionsFor(""),
  );
  assert.equal(options.env.HTTPS_PROXY, undefined);
  assert.equal(options.env.HTTP_PROXY, undefined);
  assert.deepEqual({ ...options.env }, { ...process.env });
});

// ── the TERMINAL seams ───────────────────────────────────────────────────────
//
// `ProcessExecution` MERGES its `env` into the parent's, so these two carry
// ADDITIONS only — asserting `PATH` survives (as the cp.spawn cases above do)
// would be asserting the opposite contract.

test("runAlpInTerminal hands the proxy to the terminal — this is the tan bootstrap seam", async () => {
  const run = await withEnv(
    { HTTPS_PROXY: undefined, HTTP_PROXY: undefined, ALL_PROXY: undefined },
    () =>
      terminalRunFor("http://proxy.corp:8080", (adapter, context) =>
        adapter.runAlpInTerminal(context, ["bootstrap"], {
          name: "Alp: Bootstrap",
          cwd: undefined,
        }),
      ),
  );
  assert.ok(
    run.env,
    "runAlpInTerminal passed no `env`, so `tan bootstrap` — the command that " +
      "downloads Zephyr and the pip packages — runs with no proxy at all. A " +
      "ProcessExecution task is not a login shell: it inherits the extension " +
      "host's environment, not the user's profile, so nothing else supplies it",
  );
  assert.equal(run.env.HTTPS_PROXY, "http://proxy.corp:8080");
  assert.equal(run.env.HTTP_PROXY, "http://proxy.corp:8080");
});

test("runAlpInTerminal leaves an exported proxy alone", async () => {
  const run = await withEnv(
    { HTTPS_PROXY: "http://from-shell:3128", ALL_PROXY: undefined },
    () =>
      terminalRunFor("http://from-settings:8080", (adapter, context) =>
        adapter.runAlpInTerminal(context, ["build"], {
          name: "Alp: Build",
          cwd: undefined,
        }),
      ),
  );
  assert.equal(
    run.env.HTTPS_PROXY,
    undefined,
    "an exported HTTPS_PROXY is already in the parent environment this task " +
      "merges into, so the gap-filler must write NOTHING for it — writing the " +
      "setting here would override the variable the user chose",
  );
});

test("installTanCliGlobally hands the proxy to the installer script", async () => {
  const run = await withEnv(
    { HTTPS_PROXY: undefined, HTTP_PROXY: undefined, ALL_PROXY: undefined },
    () =>
      terminalRunFor("http://proxy.corp:8080", (adapter, context) => {
        adapter.installTanCliGlobally(context);
      }),
  );
  assert.equal(run.name, "Install tan");
  assert.ok(
    run.env,
    "the bundled installer's ENTIRE job is to download tan from GitHub — " +
      "without the proxy it is the one script guaranteed to fail on the " +
      "machines this fix exists for",
  );
  assert.equal(run.env.HTTPS_PROXY, "http://proxy.corp:8080");
});
