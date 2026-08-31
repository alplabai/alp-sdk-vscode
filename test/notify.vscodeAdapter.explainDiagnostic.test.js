// SPDX-License-Identifier: Apache-2.0
//
// Behavioural coverage for the `explainDiagnostic` notify action (#617): the
// presenter's ACTIONS table must map it to `alp.explainDiagnosticCode`,
// FORWARDING the picked action's `arg` (the ALP-Bxxx code) — the same command
// `loader.ts` registers the real `tan explain --code <code>` handler under.
// Loads the REAL compiled presenter (`out/notify/vscodeAdapter.js`) under a
// fake `vscode`, the same technique
// `notify.vscodeAdapter.showBuildResult.test.js` uses.

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
 *  a toast whose picked button is set by the test, and a spy on
 *  `commands.executeCommand` so a presenter-run action's real target AND
 *  argument are provable, not just its title. */
function makeFakeVscode(pickTitle) {
  const executed = [];
  const shown = [];
  const fake = {
    window: {
      createOutputChannel: () => ({ appendLine() {}, show() {} }),
      showInformationMessage: (message, _options, ...titles) => {
        shown.push({ kind: "info", message, titles });
        return Promise.resolve(pickTitle ?? titles[0]);
      },
      showWarningMessage: (message, _options, ...titles) => {
        shown.push({ kind: "warning", message, titles });
        return Promise.resolve(pickTitle ?? titles[0]);
      },
      showErrorMessage: (message, _options, ...titles) => {
        shown.push({ kind: "error", message, titles });
        return Promise.resolve(pickTitle ?? titles[0]);
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

test("ACTIONS.explainDiagnostic renders its title override and forwards `arg` to alp.explainDiagnosticCode", async () => {
  const { fake, executed, shown } = makeFakeVscode("Explain ALP-B003");
  const presenter = loadPresenter(fake);

  const picked = await presenter.notify({
    severity: "error",
    channel: "toast",
    message:
      "Alp: Validating board.yaml: ALP-B003: 'verbose' is not one of […]",
    actions: [
      {
        id: "explainDiagnostic",
        arg: "ALP-B003",
        title: "Explain ALP-B003",
      },
    ],
  });

  // The title on screen is `loader.ts`'s per-code override, not the ACTIONS
  // table's generic fallback — proven by reading it back off the fake
  // `showErrorMessage` call rather than the source.
  assert.deepEqual(
    shown.map((s) => s.titles),
    [["Explain ALP-B003", "Show Output"]],
  );
  // A presenter-run action (has a `run` in ACTIONS) resolves notify() with
  // undefined, same contract as every other `run`-bearing id.
  assert.equal(picked, undefined);
  assert.deepEqual(executed, [
    { id: "alp.explainDiagnosticCode", args: ["ALP-B003"] },
  ]);
});

test("two distinct codes on one plan render as two DISTINCT buttons, not one", () => {
  const { fake, shown } = makeFakeVscode("Explain ALP-B002");
  const presenter = loadPresenter(fake);

  return presenter
    .notify({
      severity: "error",
      channel: "toast",
      message: "Alp: Validating board.yaml: two issues found (+1 more)",
      actions: [
        { id: "explainDiagnostic", arg: "ALP-B002", title: "Explain ALP-B002" },
        { id: "explainDiagnostic", arg: "ALP-B003", title: "Explain ALP-B003" },
      ],
    })
    .then(() => {
      assert.deepEqual(
        shown.map((s) => s.titles),
        [["Explain ALP-B002", "Explain ALP-B003", "Show Output"]],
      );
    });
});

test("a click with no arg runs nothing — no alp.explainDiagnosticCode(undefined)", async () => {
  const { fake, executed } = makeFakeVscode("Explain");
  const presenter = loadPresenter(fake);

  await presenter.notify({
    severity: "info",
    channel: "toast",
    message: "Alp: test",
    actions: [{ id: "explainDiagnostic" }],
  });

  assert.deepEqual(
    executed,
    [],
    "an explainDiagnostic action with no `arg` must not spawn `tan explain " +
      "--code undefined`",
  );
});
