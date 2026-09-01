// SPDX-License-Identifier: Apache-2.0
//
// The six build/flash commands that must refuse to spawn `tan` with no folder
// open — and the run they must NOT block.
//
// `tan build/image/flash/clean/renode/run` all WRITE where they run. With no
// folder open there is no cwd to hand the child: `runAlpInTerminal` takes
// `cwd: string | undefined`, so passing an unresolved `westCwd()` still
// compiles, the child inherits the extension host's own working directory (on
// Windows, the VS Code install directory) and a `build/` tree lands there.
// Nothing about that failure is visible — the terminal succeeds.
//
// Two guards cover the six, and they are SEPARATE on purpose: five share
// `resolveOrchestratorTarget`, and `alp.westRunNativeSim` does not route
// through it at all. Deleting either one leaves the other path spawning. So
// this drives the REAL registered handlers out of `out/west.js` (same
// `Module._load` swap as test/bootstrap.noWorkspace.test.js) with the workspace
// context as the only variable, and asserts on the two things that matter: was
// a process spawned, and with which cwd.
//
// `src/notify/service.ts` is pure, so it is loaded FOR REAL — the asserted
// sentences are the ones the customer sees, not copies of them in a stub.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

// `warnIfCliCannotBuildSom` (#606) lives in its own compiled module,
// `src/build/somCliFloorGuard.ts`, which `west.js` requires and which
// captures `probeTanVersion`/`notifyAsync` at LOAD time. Only `modPath` was
// cache-busted below; left cached across `register()` calls it would keep
// serving the FIRST call's stubs to every later one. Same trap and fix as
// test/proxyEnv.nonTanChildren.test.js's `ALP_ADAPTER`.
const SOM_FLOOR_GUARD = require.resolve(
  path.join(root, "out", "build", "somCliFloorGuard.js"),
);

/** Load out/west.js with `stubs` standing in for the requires named. Swaps
 *  Node's loader only for the duration of the synchronous require, so it never
 *  leaks into another test file sharing the process. */
function loadWest(stubs) {
  const modPath = require.resolve(path.join(root, "out", "west.js"));
  delete require.cache[modPath];
  delete require.cache[SOM_FLOOR_GUARD];
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
    delete require.cache[SOM_FLOOR_GUARD];
  }
}

/**
 * Register the west commands against a fake host whose only interesting
 * property is the workspace context, and collect every terminal spawn,
 * envelope command and notification plan.
 */
function register(workspaceContext) {
  const handlers = new Map();
  const spawns = [];
  const envelopeRuns = [];
  const plans = [];

  const { registerWestCommands } = loadWest({
    vscode: {
      commands: {
        registerCommand(id, handler) {
          handlers.set(id, handler);
          return { dispose() {} };
        },
      },
      // The fallback app prompt: accept whatever default the command offers, so
      // the happy path reaches the spawn instead of stopping on a cancel.
      window: { showInputBox: async ({ value }) => value },
    },
    "./alpCli/vscodeAdapter": {
      runAlpInTerminal: async (...args) => {
        spawns.push(args);
      },
      // build/image/flash/clean/renode stream into the "Alp SDK" channel now
      // (#333); this file is about the no-folder guard, so both dispatch seams
      // land in the same `spawns` list and the assertions stay mode-agnostic.
      runAlpStreamed: async (...args) => {
        spawns.push(args);
      },
      // The Renode core picker probes the running tan; a multi-slice manifest
      // is not what this file exercises, so answer "unknown version" and let
      // the picker stay out of the way.
      probeTanVersion: async () => null,
      runAlpCommand: async (...args) => {
        envelopeRuns.push(args);
        return { outcome: { ok: true }, raw: {}, source: "test" };
      },
    },
    // `warnIfCliCannotBuildSom` (#606) lives one directory deeper than
    // `west.ts`, so its OWN requires are spelled "../..." rather than
    // "./..." — both spellings need stubbing or the "../" ones fall through
    // to the real, vscode-heavy modules. See SOM_FLOOR_GUARD's comment above.
    "../alpCli/vscodeAdapter": { probeTanVersion: async () => null },
    "../notify/vscodeAdapter": { notifyAsync() {} },
    "../util": { log() {} },
    "./west/vscodeAdapter": {
      collectWestWorkspaceContext: () => workspaceContext,
      executeWestPlan: () => {},
      // Overlay already present, so the native_sim run never detours into
      // `tan generate` — this file is about the guard, not the overlay.
      nativeSimOverlayExists: () => true,
    },
    // The plain-west plan builders are only reachable from alp.westFlash /
    // alp.westUpdate, neither of which is under test here; stubbed so the file
    // doesn't depend on a built packages/alp-core/dist.
    "@alp-sdk/core/west/service": {
      createWestFlashPlan: () => ({}),
      createWestUpdatePlan: () => ({}),
    },
    "./util": {
      log() {},
      BUILD_RUN_NAME: "Alp Build",
      FLASH_RUN_NAME: "Alp Flash",
    },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return undefined;
      },
    },
  });

  registerWestCommands({});
  return { handlers, spawns, envelopeRuns, plans };
}

/** Every command that shells `tan` into a directory, with the sentence it must
 *  show instead when there is no directory, and the run it must still allow.
 *  `alp.westRunNativeSim` is last and is the one NOT covered by
 *  `resolveOrchestratorTarget`. */
const COMMANDS = [
  {
    id: "alp.westBuild",
    message: "Open a folder to build this project.",
    terminal: "Alp Build",
    argv: ["--project", "examples/peripheral-io/gpio-button-led", "build"],
  },
  {
    id: "alp.westAlpImage",
    message: "Open a folder to build a flash image.",
    terminal: "Alp Image",
    argv: ["image", "examples/multicore/rpmsg-v2n"],
  },
  {
    id: "alp.westAlpFlash",
    message: "Open a folder to flash this device.",
    terminal: "Alp Flash",
    argv: ["flash", "examples/multicore/rpmsg-v2n"],
  },
  {
    id: "alp.westAlpClean",
    message: "Open a folder to clean this project.",
    terminal: "Alp Clean",
    argv: ["clean", "examples/multicore/rpmsg-v2n"],
  },
  {
    id: "alp.westRunNativeSim",
    message: "Open a folder to run this project.",
    terminal: "Alp Run (native_sim)",
    argv: ["run"],
  },
];

/** Nothing resolves: no folder open, no `alpSdk.westCwd` override. */
const NO_WORKSPACE = {
  workspaceRoot: null,
  sdkRoot: null,
  boardYamlPath: null,
  westCwd: null,
  pythonBinary: "python3",
};

for (const command of COMMANDS) {
  test(`${command.id} with no folder open never spawns tan`, async () => {
    const { handlers, spawns, envelopeRuns, plans } = register(NO_WORKSPACE);

    await handlers.get(command.id)();

    assert.deepEqual(
      spawns,
      [],
      "with no cwd the child would inherit the extension host's own directory " +
        "and write a build/ there — nothing may spawn",
    );
    assert.deepEqual(
      envelopeRuns,
      [],
      "and no envelope command may run against an arbitrary directory either",
    );
    assert.equal(plans.length, 1, "exactly one notification, and it explains");
    assert.equal(plans[0].message, command.message);
  });

  test(`${command.id} with a folder open runs tan in that folder`, async () => {
    const { handlers, spawns, plans } = register({
      ...NO_WORKSPACE,
      workspaceRoot: "/w",
      westCwd: "/w",
    });

    await handlers.get(command.id)();

    assert.equal(spawns.length, 1, "the guard must not block a real run");
    const [, argv, options] = spawns[0];
    assert.deepEqual(argv, command.argv);
    assert.equal(options.cwd, "/w", "tan must run in the open folder");
    assert.equal(options.name, command.terminal);
    assert.deepEqual(
      plans,
      [],
      "nothing to tell the customer on the happy path",
    );
  });
}
