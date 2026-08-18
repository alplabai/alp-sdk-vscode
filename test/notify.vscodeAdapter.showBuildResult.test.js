// SPDX-License-Identifier: Apache-2.0
//
// Behavioural coverage for the "Show Result" action (#331's last remaining
// item): the presenter's ACTIONS table must map `showBuildResult` to
// `alp.showBuildPlan` — the same command `package.json` binds to the Build
// Plan panel's own open action — so picking the button actually reveals the
// panel. Loads the REAL compiled presenter (`out/notify/vscodeAdapter.js`)
// under a fake `vscode`, the same technique `util.terminalFinish.test.js`
// uses for `out/util.js`: swap Node's module loader for `vscode` only for the
// duration of the synchronous require, so no other test file sharing the
// process is affected.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

function loadPresenter(fake) {
  const modPath = require.resolve(
    path.join(root, "out", "notify", "vscodeAdapter.js"),
  );
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request === "vscode"
      ? fake
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

/** A minimal fake `vscode` sufficient to drive the presenter's `show()` path:
 *  a toast whose one button is immediately "picked", and a spy on
 *  `commands.executeCommand` so a presenter-run action's real target is
 *  provable, not just its title. */
function makeFakeVscode() {
  const executed = [];
  const shown = [];
  const fake = {
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {} }),
      showInformationMessage: (message, _options, ...titles) => {
        shown.push({ kind: "info", message, titles });
        return Promise.resolve(titles[0]);
      },
      showWarningMessage: (message, _options, ...titles) => {
        shown.push({ kind: "warning", message, titles });
        return Promise.resolve(titles[0]);
      },
      showErrorMessage: (message, _options, ...titles) => {
        shown.push({ kind: "error", message, titles });
        return Promise.resolve(titles[0]);
      },
      setStatusBarMessage: () => undefined,
      terminals: [],
    },
    commands: {
      executeCommand: (id, ...args) => {
        executed.push({ id, args });
        return Promise.resolve(undefined);
      },
    },
    workspace: {},
    // `util.ts` (imported transitively by the presenter, for
    // log/showOutput/revealRunInTerminal) constructs one at module load for
    // its `terminalFinished` emitter — required just to let the require
    // succeed, never fired in this test.
    EventEmitter: class {
      constructor() {
        this._listeners = new Set();
        this.event = (fn) => {
          this._listeners.add(fn);
          return { dispose: () => this._listeners.delete(fn) };
        };
      }
      fire(e) {
        this._listeners.forEach((fn) => fn(e));
      }
    },
  };
  return { fake, executed, shown };
}

test('ACTIONS.showBuildResult renders as the "Show Result" button and runs alp.showBuildPlan when picked', async () => {
  const { fake, executed, shown } = makeFakeVscode();
  const presenter = loadPresenter(fake);

  const picked = await presenter.notify({
    severity: "info",
    channel: "toast",
    message: "Alp Build finished.",
    actions: [{ id: "showBuildResult" }],
  });

  // The button title is what the toast actually renders — proven by reading
  // it back off the fake `showInformationMessage` call, not by pattern-
  // matching the source (which would couple the assertion to how Prettier
  // happens to wrap the ACTIONS table entry).
  assert.deepEqual(
    shown.map((s) => s.titles),
    [["Show Result"]],
  );
  // A presenter-run action (has a `run` in ACTIONS) resolves notify() with
  // undefined — the id is returned to the caller only for caller-handled
  // actions (retry, startAnyway, …), which this is not.
  assert.equal(picked, undefined);
  assert.deepEqual(executed, [{ id: "alp.showBuildPlan", args: [] }]);
});
