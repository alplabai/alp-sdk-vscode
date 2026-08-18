// SPDX-License-Identifier: Apache-2.0
//
// #331's last remaining item: the build-finish toast/status-bar message must
// offer "Show Result" (reveals the Build Plan panel, `alp.showBuildPlan") —
// but ONLY for a run whose result that panel actually reflects. The panel
// renders `build/system-manifest.yaml`, and per the SDK's own docs
// (`alp-sdk-upstream/docs/cli.md`: "tan build seeds its own
// system-manifest.yaml … from --emit system-manifest") only a `tan build` run
// (`BUILD_RUN_NAME`) refreshes that file — `tan flash`/`image`/`clean`/
// `renode` do not. Attaching the action to any of those would reveal a panel
// with nothing to do with what just finished.
//
// Drives the REAL `onDidFinishTerminalCommand` subscriber registered by
// `activate()` in `out/extension.js`, the same way `extension.firstRun.test.js`
// drives real `activate()` logic: a fake `vscode` host, "./util" and
// "./notify/vscodeAdapter" stubbed so the subscriber's own inputs (the finish
// event) and outputs (the notification plan) are directly observable, with no
// real toast rendering needed.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

function loadExtension(stubs) {
  const modPath = require.resolve(path.join(root, "out", "extension.js"));
  const size = require("node:fs").statSync(modPath).size;
  assert.ok(
    size < 200_000,
    `out/extension.js is ${size} bytes — that is the packaged esbuild bundle, ` +
      `not the tsc output this test loads. Run \`npx tsc --build --force\`.`,
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

const noop = () => undefined;
const disposable = { dispose: noop };

/** A minimal VS Code `Event<T>` stand-in, same shape as
 *  `util.terminalFinish.test.js`'s fakeEvent. */
function fakeEvent() {
  const listeners = new Set();
  const event = (fn) => {
    listeners.add(fn);
    return { dispose: () => listeners.delete(fn) };
  };
  event.fire = (e) => listeners.forEach((fn) => fn(e));
  return event;
}

/** Activates the real extension against a fully-stubbed host, capturing:
 *  - the `onDidFinishTerminalCommand` subscriber `activate()` registers, so
 *    the test can fire synthetic finish events directly, and
 *  - every plan handed to `notifyAsync`, so the actions it carries are
 *    directly assertable with no real toast rendering involved. */
function activateAndCapture() {
  const plans = [];
  let subscriber;

  const vscodeStub = {
    commands: { registerCommand: () => disposable, executeCommand: noop },
    window: {
      createOutputChannel: () => ({
        appendLine: noop,
        show: noop,
        dispose: noop,
      }),
      registerWebviewViewProvider: () => disposable,
      createStatusBarItem: () => ({
        show: noop,
        hide: noop,
        dispose: noop,
        text: "",
      }),
      onDidChangeWindowState: () => disposable,
      showErrorMessage: noop,
    },
    workspace: {
      onDidChangeConfiguration: () => disposable,
      onDidChangeWorkspaceFolders: () => disposable,
      onDidSaveTextDocument: () => disposable,
      createFileSystemWatcher: () => ({
        onDidCreate: () => disposable,
        onDidChange: () => disposable,
        onDidDelete: () => disposable,
        dispose: noop,
      }),
      getConfiguration: () => ({ get: () => undefined, update: noop }),
      workspaceFolders: undefined,
    },
    languages: { registerCodeActionsProvider: () => disposable },
    tasks: {
      registerTaskProvider: () => disposable,
      onDidEndTaskProcess: () => disposable,
      // Registered directly in extension.ts (not via ./util) right before the
      // subscriber under test — without this the array literal that carries
      // both throws HERE first, and the subscriber below is never captured.
      onDidStartTask: () => disposable,
    },
    EventEmitter: class {
      constructor() {
        this.event = () => disposable;
      }
      fire() {}
      dispose() {}
    },
    Uri: { file: (p) => ({ fsPath: p, path: p, scheme: "file" }) },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
  };

  const context = {
    subscriptions: [],
    extension: { id: "AlpLabAI.alp-sdk", packageJSON: { version: "0.5.2" } },
    globalState: {
      get: () => undefined,
      update: () => Promise.resolve(),
    },
    workspaceState: { get: () => undefined, update: () => Promise.resolve() },
    globalStorageUri: { fsPath: path.join(root, ".test-storage") },
  };

  const ext = loadExtension({
    vscode: vscodeStub,
    "./lsp/client": { startLanguageServer: noop, stopLanguageServer: noop },
    "./client": {
      startLanguageServer: noop,
      stopLanguageServer: noop,
      requestEffectiveConfigPreview: noop,
    },
    "./util": {
      log: noop,
      showOutput: noop,
      runInTerminal: noop,
      isRunActive: () => false,
      disposeTaskTracking: noop,
      revealRunInTerminal: noop,
      // The two run-name constants the subscriber under test gates on. This
      // stub replaces the whole "./util" module, so these values are NOT
      // read from the real src/util.ts — a rename of either constant there
      // would not be caught here; this file only proves the subscriber's own
      // gating logic against whatever name it is handed.
      BUILD_RUN_NAME: "Alp Build",
      FLASH_RUN_NAME: "Alp Flash",
      // Captured so the test can fire finish events directly; `activate()`
      // calls this once with the real subscriber function.
      onDidFinishTerminalCommand: (fn) => {
        subscriber = fn;
        return disposable;
      },
    },
    // Bypasses real toast rendering entirely: every plan the subscriber
    // builds (via the REAL, unstubbed `./notify/service.js`) is captured
    // here instead of reaching `vscode.window.show*Message`.
    "./notify/vscodeAdapter": {
      setExtensionId: noop,
      notify: async (plan) => {
        plans.push(plan);
        return undefined;
      },
      notifyAsync: (plan) => {
        plans.push(plan);
      },
    },
  });

  try {
    ext.activate(context);
  } catch {
    // Everything after the subscriber's registration (dozens of further
    // command/panel registrations this test does not build) is allowed to
    // throw — the subscriber has already been captured by the time it does,
    // the same reasoning extension.firstRun.test.js relies on for its own
    // earlier assertion point.
  }

  return { subscriber, plans };
}

test("activate() registers the onDidFinishTerminalCommand subscriber", () => {
  const { subscriber } = activateAndCapture();
  assert.equal(typeof subscriber, "function");
});

test("a successful Alp Build finish offers Show Result", () => {
  const { subscriber, plans } = activateAndCapture();
  subscriber({ name: "Alp Build", code: 0 });

  const plan = plans.at(-1);
  assert.equal(plan.channel, "toast", "an action-bearing success is a toast");
  assert.deepEqual(plan.actions, [{ id: "showBuildResult" }]);
});

test("a successful Alp Flash finish does NOT offer Show Result", () => {
  const { subscriber, plans } = activateAndCapture();
  subscriber({ name: "Alp Flash", code: 0 });

  const plan = plans.at(-1);
  // Flash never refreshes build/system-manifest.yaml -- the panel would have
  // nothing to do with this run, so the bare status-bar shape is unchanged.
  assert.equal(plan.channel, "statusBar");
  assert.deepEqual(plan.actions, []);
});

// Success-only, deliberately: a FAILED build can leave a PRIOR green build's
// `build/system-manifest.yaml` on disk (the file this run never got to
// rewrite), and the panel's payload carries no timestamp to tell that apart
// from a fresh result — so "Show Result" on a failure toast could present
// yesterday's green build as today's outcome. The failure toast keeps only
// the actions that are always trustworthy: the terminal/channel reveal (the
// real error) and Run Doctor.
test("a failed Alp Build finish does NOT offer Show Result — a stale manifest could pass as this run's", () => {
  const { subscriber, plans } = activateAndCapture();
  subscriber({ name: "Alp Build", code: 1, mode: "channel" });

  const plan = plans.at(-1);
  assert.deepEqual(plan.actions, [{ id: "showOutput" }, { id: "runDoctor" }]);
});

test("a failed Alp Flash finish carries no Show Result action", () => {
  const { subscriber, plans } = activateAndCapture();
  subscriber({ name: "Alp Flash", code: 1, mode: "terminal" });

  const plan = plans.at(-1);
  assert.deepEqual(plan.actions, [
    { id: "showTerminal", arg: "Alp Flash" },
    { id: "runDoctor" },
  ]);
});

test("an undefined exit code (task never started) raises no plan at all, build or not", () => {
  const { subscriber, plans } = activateAndCapture();
  subscriber({ name: "Alp Build", code: undefined });
  assert.deepEqual(plans, []);
});
