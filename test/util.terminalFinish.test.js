// SPDX-License-Identifier: Apache-2.0
//
// Wiring checks for the terminal-finish refresh signal (P1.7): the hub panels
// used to refresh their status a blind `setTimeout(..., 8000/1200)` after
// kicking off a webview command, so a bootstrap or `west` build that ran
// longer than the guess left the status stale. Now `runInTerminal` fires
// `onDidFinishTerminalCommand` when its spawned process exits, and each panel
// keeps a standing subscription that refreshes on that real signal — no race,
// no one-shot, no blind delay. These are cheap source-level checks (the
// runtime behaviour is covered by the e2e harness) so they catch a panel that
// regresses to a blind timer, or a lost emitter fire, without needing
// `vsce package` + electron.
//
// `runInTerminal` runs `argv` via a VS Code Task (`ProcessExecution`), not a
// wrapper shell terminal — a real trade-off follows from that: the task's
// terminal can stay open after the process ends ("press any key to close"),
// so "the terminal closed" is no longer the same moment as "the command
// finished". The finish signal must therefore come from
// `vscode.tasks.onDidEndTaskProcess` (the real process-exit event), not
// `Terminal.onDidCloseTerminal` — the assertions below pin exactly that, so a
// revert to the old `shellPath`/`sendText`/`onDidCloseTerminal` design (or a
// half-revert that quietly drops back to `shellPath` while keeping this
// comment) fails here instead of only failing silently at runtime.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf-8");

const PANELS = [
  "src/ideHub/overviewPanel.ts",
  "src/ideHub/hubViewProvider.ts",
  "src/ideHub/existingProjectFlowPanel.ts",
  "src/ideHub/setupFlowPanel.ts",
];

test("util.ts exports the terminal-finish signal", () => {
  const util = read("src/util.ts");
  assert.match(
    util,
    /export const onDidFinishTerminalCommand =/,
    "util must export onDidFinishTerminalCommand",
  );
});

test("runInTerminal fires the terminal-finish signal off the task's real process-exit event", () => {
  const util = read("src/util.ts");
  // The wiring is: onDidEndTaskProcess -> a `finish` callback -> the fire.
  // Pin all three so a revert to onDidCloseTerminal-driven firing (see the
  // file header comment above for why that event no longer means "the
  // command finished") fails here instead of only failing at runtime.
  assert.match(
    util,
    /vscode\.tasks\.onDidEndTaskProcess\(/,
    "runInTerminal's finish signal must be wired off vscode.tasks.onDidEndTaskProcess",
  );
  assert.match(
    util,
    /terminalFinished\.fire\(\{\s*name,\s*code\s*\}\)/,
    "the finish handler must fire terminalFinished({name, code})",
  );
  assert.doesNotMatch(
    util,
    /vscode\.window\.onDidCloseTerminal\(/,
    "runInTerminal must not drive its finish signal off Terminal.onDidCloseTerminal",
  );
});

test("runInTerminal runs argv with no shell in between (ProcessExecution, not shellPath/sendText)", () => {
  const util = read("src/util.ts");
  assert.match(
    util,
    /new vscode\.ProcessExecution\(\s*options\.argv\[0\],\s*options\.argv\.slice\(1\)/,
    "runInTerminal must spawn options.argv via ProcessExecution as an argv array",
  );
  assert.doesNotMatch(
    util,
    /shellPath/,
    "runInTerminal must not fall back to a wrapper-shell terminal (shellPath/shellArgs)",
  );
  assert.doesNotMatch(
    util,
    /\.sendText\(/,
    "runInTerminal must not sendText a hand-built command line into a shell",
  );
});

test("every hub panel keeps a standing refresh-on-terminal-finish subscription", () => {
  for (const rel of PANELS) {
    const src = read(rel);
    assert.match(
      src,
      /onDidFinishTerminalCommand\(\(\) => void this\.refresh\(\)\)/,
      `${rel} must subscribe to onDidFinishTerminalCommand`,
    );
  }
});

test("no hub panel refreshes on a blind setTimeout", () => {
  for (const rel of PANELS) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      /setTimeout\(\(\) => (?:void )?this\.refresh\(\)/,
      `${rel} must not refresh on a blind setTimeout`,
    );
  }
});

// ── behavioural coverage: a minimal fake `vscode`, no @vscode/test-electron ──
//
// The source-level checks above pin SPELLING, not behaviour -- they can't
// catch a wiring bug in the reservation/generation bookkeeping itself. This
// loads the real compiled out/util.js under a fake `vscode` (Node
// module-resolution stubbed for the duration of the require only) and drives
// it with hand-fired events, the same way the real extension host would.

/** A minimal VS Code `Event<T>` stand-in: calling it subscribes (returning a
 *  Disposable); `.fire(e)` re-broadcasts to every current subscriber. */
function fakeEvent() {
  const listeners = new Set();
  const event = (fn) => {
    listeners.add(fn);
    return { dispose: () => listeners.delete(fn) };
  };
  event.fire = (e) => listeners.forEach((fn) => fn(e));
  return event;
}

function makeFakeVscode() {
  const onDidStartTask = fakeEvent();
  const onDidEndTaskProcess = fakeEvent();
  const onDidEndTask = fakeEvent();
  const terminated = [];
  // The exact TaskExecution objects executeTask() handed back, in dispatch
  // order -- tests must fire events using THESE objects (not a hand-rolled
  // stand-in), since util.ts's WeakMap-based generation tracking is keyed off
  // object identity.
  const executed = [];
  // Any toast util.ts raises on its own. This must stay EMPTY: the #332
  // finish verdict is planned and presented by the
  // onDidFinishTerminalCommand subscriber in src/extension.ts, so util.ts's
  // job is only to fire the event exactly once with the real exit code. A
  // toast appearing here again means the verdict was re-inlined, taking its
  // exit-number wording and its missing action button with it.
  const toasts = [];
  const warnings = [];
  const fake = {
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {} }),
      showInformationMessage: (message) => {
        toasts.push({ kind: "info", message });
        return Promise.resolve(undefined);
      },
      showErrorMessage: (message) => {
        toasts.push({ kind: "error", message });
        return Promise.resolve(undefined);
      },
      showWarningMessage: (message, ...actions) => {
        warnings.push({ message, actions });
        return Promise.resolve(undefined);
      },
      terminals: [],
    },
    tasks: {
      executeTask: (task) => {
        const execution = {
          task,
          terminate: () => terminated.push(task.definition),
        };
        executed.push(execution);
        return Promise.resolve(execution);
      },
      onDidStartTask,
      onDidEndTaskProcess,
      onDidEndTask,
    },
    EventEmitter: class {
      constructor() {
        this._event = fakeEvent();
      }
      get event() {
        return this._event;
      }
      fire(e) {
        this._event.fire(e);
      }
    },
    ProcessExecution: class {
      constructor(command, args, options) {
        Object.assign(this, { command, args, options });
      }
    },
    Task: class {
      constructor(definition, scope, name, source, execution) {
        Object.assign(this, { definition, scope, name, source, execution });
      }
    },
    TaskScope: { Workspace: 1 },
    TaskRevealKind: { Always: 1 },
    TaskPanelKind: { Dedicated: 1 },
  };
  return {
    fake,
    onDidStartTask,
    onDidEndTaskProcess,
    onDidEndTask,
    terminated,
    executed,
    toasts,
    warnings,
  };
}

/** Require a FRESH out/util.js with `vscode` resolving to `fake` -- swaps
 *  Node's module loader only for the duration of the synchronous require
 *  (util.ts's top-level `require("vscode")`), then restores it, so this
 *  never leaks into any other test file sharing the process. */
function loadUtil(fake) {
  const utilPath = require.resolve(path.join(root, "out", "util.js"));
  delete require.cache[utilPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request === "vscode"
      ? fake
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return require(utilPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[utilPath];
  }
}

test("runInTerminal: process-end then task-end fires terminalFinished exactly once", async () => {
  const {
    fake,
    onDidStartTask,
    onDidEndTaskProcess,
    onDidEndTask,
    executed,
    toasts,
  } = makeFakeVscode();
  const util = loadUtil(fake);
  const fires = [];
  util.onDidFinishTerminalCommand((e) => fires.push(e));

  util.runInTerminal({ name: "west build", argv: ["west", "build"] });
  await Promise.resolve(); // let executeTask's .then() settle
  assert.equal(util.isRunInTerminalActive("west build"), true);

  const execution = executed[0];
  onDidStartTask.fire({ execution });
  onDidEndTaskProcess.fire({ execution, exitCode: 0 });
  onDidEndTask.fire({ execution }); // the same run's backstop event, arriving late

  assert.deepEqual(fires, [{ name: "west build", code: 0 }]);
  assert.equal(util.isRunInTerminalActive("west build"), false);
  // util.ts raises NO toast of its own any more: #332's glanceable verdict is
  // planned and presented by the onDidFinishTerminalCommand subscriber in
  // src/extension.ts (a status-bar line on success), so that a FAILED run gets
  // real actions instead of a toast naming only its exit number. What util.ts
  // still owns — and what this pins — is firing the event exactly once.
  assert.deepEqual(toasts, []);
});

test("runInTerminal: a nonzero exit code is reported on the event, not as a toast (#332)", async () => {
  const { fake, onDidStartTask, onDidEndTaskProcess, executed, toasts } =
    makeFakeVscode();
  const util = loadUtil(fake);
  const fires = [];
  util.onDidFinishTerminalCommand((e) => fires.push(e));

  util.runInTerminal({ name: "tan bootstrap", argv: ["tan", "bootstrap"] });
  await Promise.resolve();

  const execution = executed[0];
  onDidStartTask.fire({ execution });
  onDidEndTaskProcess.fire({ execution, exitCode: 2 });

  assert.deepEqual(fires, [{ name: "tan bootstrap", code: 2 }]);
  // The failure verdict rides on the event, not on a toast raised here: the
  // subscriber in src/extension.ts turns a defined non-zero code into a plan
  // whose message names the run (never the exit number -- that is `detail`,
  // logged to the channel) and which carries "Show Terminal" + "Run Doctor".
  assert.deepEqual(toasts, []);
});

test("runInTerminal: task-end alone (no process ever started) fires terminalFinished exactly once", async () => {
  const { fake, onDidStartTask, onDidEndTask, executed, toasts } =
    makeFakeVscode();
  const util = loadUtil(fake);
  const fires = [];
  util.onDidFinishTerminalCommand((e) => fires.push(e));

  util.runInTerminal({ name: "Install tan", argv: ["missing-binary"] });
  await Promise.resolve();

  const execution = executed[0];
  onDidStartTask.fire({ execution }); // the task starts; its process never spawns
  onDidEndTask.fire({ execution });
  onDidEndTask.fire({ execution }); // idempotence: a duplicate end must not re-fire

  assert.deepEqual(fires, [{ name: "Install tan", code: undefined }]);
  assert.equal(util.isRunInTerminalActive("Install tan"), false);
  // An undefined code carries no verdict (the task ended without its process
  // ever starting), so #332's silence rule holds -- claiming success OR
  // failure here would be a guess.
  assert.deepEqual(toasts, []);
});

test("runInTerminal: the reservation is synchronous, so a caller can block a concurrent same-named run (#146)", () => {
  const { fake } = makeFakeVscode();
  const util = loadUtil(fake);

  util.runInTerminal({ name: "west flash", argv: ["west", "flash"] });
  // True IMMEDIATELY, before executeTask's Thenable has any chance to
  // resolve -- this is what lets executeWestPlan's isRunInTerminalActive
  // pre-check reject a second dispatch instead of racing it (issue #146).
  assert.equal(util.isRunInTerminalActive("west flash"), true);
});

test("runInTerminal: a second dispatch of an already-active name is refused, not raced (#146 root fix)", async () => {
  const { fake, executed, terminated, warnings } = makeFakeVscode();
  const util = loadUtil(fake);

  util.runInTerminal({ name: "Alp Bootstrap", argv: ["tan", "bootstrap"] });
  util.runInTerminal({ name: "Alp Bootstrap", argv: ["tan", "bootstrap"] });
  await Promise.resolve();

  // Only the FIRST dispatch's task ever ran -- the second never reached
  // executeTask at all, so there is no window where two `tan bootstrap`
  // processes can run concurrently against the same venv.
  assert.equal(executed.length, 1);
  // The refused run is not silently dropped: it warns (and never terminates
  // the live one -- a bare terminate() would have hit a genuinely-running
  // flash mid-write, the #146 hazard in the other direction).
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /Alp Bootstrap.*still running/);
  assert.equal(terminated.length, 0);
  assert.equal(util.isRunInTerminalActive("Alp Bootstrap"), true);
});

test("runInTerminal: concurrent runs under DIFFERENT names are unaffected", async () => {
  const { fake, executed } = makeFakeVscode();
  const util = loadUtil(fake);

  util.runInTerminal({ name: "Alp Build", argv: ["tan", "build"] });
  util.runInTerminal({ name: "Alp Flash", argv: ["tan", "flash"] });
  await Promise.resolve();

  assert.equal(executed.length, 2);
  assert.equal(util.isRunInTerminalActive("Alp Build"), true);
  assert.equal(util.isRunInTerminalActive("Alp Flash"), true);
});
