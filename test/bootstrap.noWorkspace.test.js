// SPDX-License-Identifier: Apache-2.0
//
// The one guard in `alp.installDependencies` that protects the customer's
// disk, and the run it must NOT block.
//
// `tan bootstrap` creates a venv and a west workspace in its cwd. With no
// folder open there is no cwd to hand it: `runAlpInTerminal` would pass
// `cwd: undefined`, the child would inherit the extension host's own working
// directory (on Windows, the VS Code install directory), and bootstrap would
// scaffold a west workspace there. Nothing about that failure is visible —
// the terminal succeeds.
//
// So this drives the REAL registered command handler out of `out/bootstrap.js`
// (same `Module._load` swap as test/setupOrchestrator.service.test.js) with
// the workspace root as the only variable, and asserts on the two things that
// actually matter: was a process spawned, and with which cwd. A source-level
// grep could not tell those apart, and the whole suite stayed green with the
// guard deleted before this file existed.
//
// `src/notify/service.ts` and `src/alpCli/service.ts` are pure, so they are
// loaded FOR REAL — the asserted sentence is the one the customer sees, not a
// copy of it in a stub.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Load out/bootstrap.js with `stubs` standing in for the requires named.
 *  Swaps Node's loader only for the duration of the synchronous require, so it
 *  never leaks into another test file sharing the process. */
function loadBootstrap(stubs) {
  const modPath = require.resolve(path.join(root, "out", "bootstrap.js"));
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

/** Sentinel standing in for loader.ts's CANCELLED — the pre-flight stub never
 *  returns it, so the win32 path always falls through to the real run. */
const CANCELLED = Symbol("CANCELLED");

/**
 * Register the bootstrap commands against a fake host whose only interesting
 * property is `workspaceRoot`, and collect every terminal spawn, pre-flight
 * probe and notification plan.
 */
function register(workspaceRoot) {
  const handlers = new Map();
  const spawns = [];
  const preflights = [];
  const plans = [];

  const { registerBootstrapCommand } = loadBootstrap({
    vscode: {
      commands: {
        registerCommand(id, handler) {
          handlers.set(id, handler);
          return { dispose() {} };
        },
        executeCommand: async () => undefined,
      },
      env: { openExternal: async () => true },
      Uri: { parse: (value) => value },
    },
    "./alpCli/vscodeAdapter": {
      runAlpInTerminal: async (...args) => {
        spawns.push(args);
      },
    },
    "./loader": {
      CANCELLED,
      // An envelope with no issues: neither the host-level refusal nor the
      // prerequisites-missing one fires, so the win32 pre-flight falls through
      // to the real run — the path this file needs to reach.
      runAlpWithProgress: async (...args) => {
        preflights.push(args);
        return {
          outcome: { envelope: { issues: [] }, severity: "warning" },
          raw: { stdout: "", stderr: "" },
          source: "test",
        };
      },
    },
    "./project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot }),
    },
    "./util": { log() {} },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return undefined;
      },
    },
  });

  registerBootstrapCommand({});
  return { handlers, spawns, preflights, plans };
}

// Both ids run the same handler: the palette/Setup-view one and the id the
// webview's "Initialize Workspace" / "Activate workspace" buttons post. A
// guard on only one of them still lets the other scaffold in the wrong place.
for (const command of ["alp.installDependencies", "alp.bootstrap"]) {
  test(`${command} with no folder open never spawns tan`, async () => {
    const { handlers, spawns, preflights, plans } = register(null);

    await handlers.get(command)();

    assert.deepEqual(
      spawns,
      [],
      "with no workspace root the child would inherit the extension host's " +
        "cwd and create a venv + west workspace there — nothing may spawn",
    );
    assert.deepEqual(
      preflights,
      [],
      "the win32 pre-flight must not run against an arbitrary directory either",
    );
    assert.equal(plans.length, 1, "exactly one notification, and it explains");
    assert.equal(plans[0].message, "Open a folder to bootstrap the toolchain.");
  });
}

test("alp.installDependencies with a folder open runs tan in that folder", async () => {
  const { handlers, spawns, plans } = register("/w");

  await handlers.get("alp.installDependencies")();

  assert.equal(spawns.length, 1, "the guard must not block a real bootstrap");
  const [, argv, options] = spawns[0];
  assert.deepEqual(argv, ["bootstrap"]);
  assert.equal(options.cwd, "/w", "tan must run in the open folder");
  assert.equal(options.name, "Alp Bootstrap");
  assert.deepEqual(plans, [], "nothing to tell the customer on the happy path");
});
