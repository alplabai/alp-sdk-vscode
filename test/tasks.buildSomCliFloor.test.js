// SPDX-License-Identifier: Apache-2.0
//
// #606: the third `tan build` spawn site that skipped the #502 Renesas
// CLI-floor warning — the `alp:build active target` task, which is also what
// `--pre-launch-task` runs before a debug session (`src/debug/service.ts`).
// A Renesas customer hitting this from F5 got the bare Kconfig abort with no
// chance to see the warning at all, since a `preLaunchTask` failure dialog
// names no cause beyond "task failed".
//
// `BuildDelegatePty` (src/tasks/vscodeAdapter.ts) is not exported — this
// drives it through the real, registered `AlpTaskProvider`, the same object
// VS Code's Tasks API would hold, by stubbing `vscode.tasks.
// registerTaskProvider` to capture it.
//
// `warnIfCliCannotBuildSom` lives in its own compiled module,
// src/build/somCliFloorGuard.ts, which captures `probeTanVersion` /
// `notifyAsync` at LOAD time — see test/west.somCliFloor.test.js's
// `SOM_FLOOR_GUARD` comment for why its cache entry is busted alongside this
// file's own module.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const SOM_FLOOR_GUARD = require.resolve(
  path.join(root, "out", "build", "somCliFloorGuard.js"),
);

const boardYaml = (sku) => `som:\n  sku: ${sku}\ncores: {}\n`;

const PROJECT = "/work/renesas-control";

/** A `vscode.EventEmitter` double that supports exactly one listener, which
 *  is all `BuildDelegatePty` ever attaches. */
class FakeEmitter {
  constructor() {
    this._cb = undefined;
  }
  get event() {
    return (cb) => {
      this._cb = cb;
      return { dispose: () => (this._cb = undefined) };
    };
  }
  fire(value) {
    if (this._cb) this._cb(value);
  }
}

/**
 * Register the real `AlpTaskProvider`, resolve the "build active target"
 * task's pty, open it, and collect every spawn + notification.
 *
 * @param opts.sku     board.yaml's declared SoM
 * @param opts.probed  what `probeTanVersion` answers
 */
async function driveBuildTask(opts) {
  const terminalSpawns = [];
  const notified = [];

  const modPath = require.resolve(
    path.join(root, "out", "tasks", "vscodeAdapter.js"),
  );
  delete require.cache[modPath];
  delete require.cache[SOM_FLOOR_GUARD];
  const stubs = {
    fs: {
      existsSync: (p) => String(p).endsWith("board.yaml"),
      readFileSync: () => boardYaml(opts.sku),
    },
    vscode: {
      EventEmitter: FakeEmitter,
      CustomExecution: class {
        constructor(callback) {
          this.callback = callback;
        }
      },
      Task: class {
        constructor(definition, scope, name, source, execution) {
          this.definition = definition;
          this.execution = execution;
          this.name = name;
        }
      },
      TaskScope: { Workspace: 1 },
      TaskRevealKind: { Always: 1 },
      tasks: {
        registerTaskProvider: (_type, provider) => {
          stubs.__provider = provider;
          return { dispose() {} };
        },
      },
    },
    "../alpCli/vscodeAdapter": {
      runAlpInTerminal: async (_ctx, args, options) => {
        terminalSpawns.push({ args: [...args], cwd: options?.cwd });
      },
      probeTanVersion: async () => opts.probed ?? null,
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot: PROJECT }),
    },
    "../util": {
      BUILD_RUN_NAME: "Alp Build",
      isRunActive: () => false,
      onDidFinishTerminalCommand: () => ({ dispose() {} }),
      log() {},
    },
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => notified.push(plan),
    },
    // `./service` (src/tasks/service.ts) is loaded FOR REAL, not stubbed:
    // it is pure (no `vscode`), and stubbing it here is a trap — the SAME
    // literal specifier `"./service"` is also what src/alpCli/somCliFloor.ts
    // uses for ITS OWN sibling (src/alpCli/service.ts, for `isCliBehind`),
    // and `Module._load`'s override matches by STRING, not by which file is
    // asking. A stub here silently answers alpCli/somCliFloor.ts's request
    // too, dropping `isCliBehind` and throwing inside `somCliFloorWarning` —
    // caught by `dispatchBuild`'s own `.then(resolve, reject)`, so the whole
    // warning AND the build spawn both vanish with no error surfaced here.
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let registerAlpTaskProvider;
  try {
    ({ registerAlpTaskProvider } = require(modPath));
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
    delete require.cache[SOM_FLOOR_GUARD];
  }

  registerAlpTaskProvider({});
  const [task] = stubs.__provider.provideTasks();
  const pty = await task.execution.callback();
  pty.open();
  // `warnIfCliCannotBuildSom` + `runAlpInTerminal` both resolve async.
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  return { terminalSpawns, notified };
}

const floorNotices = (notified) =>
  notified.filter((p) => p.dedupeKey === "som-cli-floor");

test("build active target: an old tan on a Renesas project is warned before the build runs", async () => {
  const { terminalSpawns, notified } = await driveBuildTask({
    sku: "E1M-V2N101",
    probed: "0.5.1",
  });

  const notices = floorNotices(notified);
  assert.equal(
    notices.length,
    1,
    "the pre-launch-task build must run the #502 Renesas CLI-floor warning " +
      "— got " +
      JSON.stringify(notified),
  );
  assert.match(notices[0].message, /E1M-V2N101/);
  assert.equal(
    terminalSpawns.length,
    1,
    "this is a warning, not a gate — the build must still run",
  );
});

test("build active target: a current tan on a Renesas project is silent", async () => {
  const { terminalSpawns, notified } = await driveBuildTask({
    sku: "E1M-V2N102",
    probed: "0.6.0",
  });

  assert.deepEqual(floorNotices(notified), []);
  assert.equal(terminalSpawns.length, 1);
});

test("build active target: a non-Renesas project is silent", async () => {
  const { terminalSpawns, notified } = await driveBuildTask({
    sku: "E1M-AEN801",
    probed: "0.4.1",
  });

  assert.deepEqual(floorNotices(notified), []);
  assert.equal(terminalSpawns.length, 1);
});
