// SPDX-License-Identifier: Apache-2.0
//
// BLOCKER found on adversarial review of #605/#606: `BuildDelegatePty.open()`
// (src/tasks/vscodeAdapter.ts) only guarded the CLI-floor WARNING on
// `this.cwd` — the actual `runAlpInTerminal(["build"], { cwd: this.cwd })`
// dispatch ran unconditionally, in an `else`-less path, even when
// `collectProjectContext()` answers `{ workspaceRoot: null }`. That is
// exactly the state `alp.showBuildPlan`/`alp.buildModel` were already fixed
// to refuse in this same diff (`src/ideHub/buildPlanPanel.ts`'s
// `requireWorkspace`, `src/models/panel.ts`'s `buildModel`) — and this task
// is what `--pre-launch-task` runs on F5, so it is reached on every debug
// session with no folder open, not just an explicit Build click.
//
// `runAlpInTerminal`'s own doc (`src/alpCli/vscodeAdapter.ts`) names the
// hazard: an omitted cwd reaches `child_process.spawn` unset, the child
// inherits the extension host's own directory (on Windows, the VS Code
// INSTALL DIRECTORY), and `tan build` WRITES a `build/` tree there.
//
// Same `Module._load` swap and `SOM_FLOOR_GUARD` cache-bust as
// test/tasks.buildSomCliFloor.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const SOM_FLOOR_GUARD = require.resolve(
  path.join(root, "out", "build", "somCliFloorGuard.js"),
);

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
 * task's pty, open it, and collect every spawn, notification, exit code and
 * terminal line.
 *
 * @param opts.workspaceRoot what `collectProjectContext` resolves.
 *   `undefined` (not `null`) is deliberate: `createBuildTask`'s own
 *   `?? undefined` means that is the ACTUAL value `BuildDelegatePty`'s
 *   constructor receives when nothing resolves, so the double must answer
 *   the same shape a `?? undefined` produces, not the raw `null` upstream.
 */
async function driveBuildTask(opts) {
  const terminalSpawns = [];
  const notified = [];
  const written = [];
  let closeCode;

  const modPath = require.resolve(
    path.join(root, "out", "tasks", "vscodeAdapter.js"),
  );
  delete require.cache[modPath];
  delete require.cache[SOM_FLOOR_GUARD];
  const stubs = {
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
      probeTanVersion: async () => null,
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot: opts.workspaceRoot }),
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
    // `./service` (src/tasks/service.ts) loads FOR REAL — see
    // test/tasks.buildSomCliFloor.test.js's comment for why stubbing it is a
    // trap (the same literal specifier also names src/alpCli/service.ts from
    // src/alpCli/somCliFloor.ts's perspective).
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
  pty.onDidWrite((line) => written.push(line));
  pty.onDidClose((code) => (closeCode = code));
  pty.open();
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));

  return { terminalSpawns, notified, written, closeCode };
}

test("build active target with no folder open never spawns tan", async () => {
  const { terminalSpawns } = await driveBuildTask({ workspaceRoot: null });

  assert.deepEqual(
    terminalSpawns,
    [],
    "with no workspace root the child inherits the extension host's cwd " +
      "(on Windows, the VS Code install directory) and `tan build` WRITES " +
      "a build/ tree there",
  );
});

test("build active target with no folder open explains why nothing ran", async () => {
  const { notified, written } = await driveBuildTask({ workspaceRoot: null });

  assert.equal(notified.length, 1, "exactly one refusal notice");
  assert.match(notified[0].message, /folder/i);
  assert.ok(
    written.some((line) => /folder/i.test(line)),
    "the Tasks terminal itself must also say why nothing ran, not just a " +
      "toast the customer may have missed — got " +
      JSON.stringify(written),
  );
});

test("build active target with no folder open closes with a non-zero code, never a silent success", async () => {
  const { closeCode } = await driveBuildTask({ workspaceRoot: null });

  // A 0 exit tells a `preLaunchTask` "go ahead and debug" — this refusal
  // must never read as a build that succeeded.
  assert.notEqual(closeCode, 0);
  assert.notEqual(closeCode, undefined);
});

test("build active target with a folder open still runs normally", async () => {
  const { terminalSpawns, notified } = await driveBuildTask({
    workspaceRoot: "/work/proj",
  });

  assert.equal(terminalSpawns.length, 1, "the guard must not block a real run");
  assert.equal(terminalSpawns[0].cwd, "/work/proj");
  assert.deepEqual(
    notified,
    [],
    "nothing to tell the customer on the happy path",
  );
});
