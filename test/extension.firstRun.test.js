// SPDX-License-Identifier: Apache-2.0
//
// Telling a FIRST INSTALL apart from an UPGRADE, on the one activation where
// the difference matters.
//
// `alp.lastActivatedVersion` landed in 0.3.7, so on the very first activation
// after upgrading FROM 0.3.6 or earlier the marker is absent — and treating
// absent as "fresh install" misreports the entire existing customer base
// exactly once each, on the activation where a support question is most
// likely. Observed in a real old->new upgrade before this was fixed: a 0.3.6
// profile that had already downloaded a tan CLI logged
//
//     Alp SDK extension activating — v0.3.7 (first activation on this machine)
//
// State written by the older build is what tells the two apart, so these tests
// drive the REAL `activate()` out of `out/extension.js` against a fake host
// whose only interesting property is what globalState already holds.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Load out/extension.js with `stubs` standing in for the requires named.
 *  Swaps Node's loader only for the duration of the synchronous require, so it
 *  cannot leak into another test file sharing the process. */
function loadExtension(stubs) {
  const modPath = require.resolve(path.join(root, "out", "extension.js"));
  // `vsce package` runs `bundle:ext`, which OVERWRITES out/extension.js with a
  // single esbuild bundle — every dependency inlined, so `Module._load` has
  // nothing left to intercept and the failure surfaces as a baffling
  // "Class extends value undefined". `tsc --build` is incremental and will not
  // undo it, so say what happened instead of letting the next reader debug
  // vscode-languageclient for an hour.
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

/** Activate against a globalState pre-loaded with `seed`, and return every
 *  line the extension logged plus the state it left behind. */
function activateWith(seed, version = "0.3.7") {
  const lines = [];
  const state = new Map(Object.entries(seed));

  const vscodeStub = {
    // Everything below activation's own first few statements is stubbed to a
    // no-op: this test is about ONE decision, and a real registration would
    // drag the whole extension in.
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
    extension: { id: "AlpLabAI.alp-sdk", packageJSON: { version } },
    globalState: {
      get: (key) => state.get(key),
      update: (key, value) => {
        state.set(key, value);
        return Promise.resolve();
      },
    },
    workspaceState: { get: () => undefined, update: () => Promise.resolve() },
    globalStorageUri: { fsPath: path.join(root, ".test-storage") },
  };

  // Only the log line is asserted, so `../util`'s `log` is the one stub that
  // has to be faithful; the rest of activation is allowed to be inert.
  const ext = loadExtension({
    vscode: vscodeStub,
    // `lsp/client` pulls in `vscode-languageclient`, which subclasses real
    // vscode classes at module load and cannot run against a fake. Nothing to
    // do with the decision under test. BOTH specifiers are needed: extension.js
    // asks for `./lsp/client`, and lsp/commands.js asks for `./client` — the
    // stub is keyed on the request string, not the resolved file.
    "./lsp/client": { startLanguageServer: noop, stopLanguageServer: noop },
    "./client": {
      startLanguageServer: noop,
      stopLanguageServer: noop,
      requestEffectiveConfigPreview: noop,
    },
    "./util": {
      log: (message) => lines.push(String(message)),
      showOutput: noop,
      runInTerminal: noop,
      isRunInTerminalActive: () => false,
      onDidFinishTerminalCommand: () => disposable,
      disposeTaskTracking: noop,
      revealRunInTerminal: noop,
    },
  });

  try {
    ext.activate(context);
  } catch {
    // Activation's tail touches surfaces this test deliberately does not build.
    // The decision under test runs in its first statements, so a later throw is
    // not a failure here — the log line has already been emitted.
  }
  return { lines, state };
}

/** The one line activation logs about itself. */
const activationLine = (lines) =>
  lines.find((l) => l.includes("extension activating")) ?? "";

test("a genuinely empty machine reports a first activation", () => {
  const { lines } = activateWith({});
  assert.match(activationLine(lines), /first activation on this machine/);
});

test("state from a build older than the marker reads as an upgrade, not a fresh install", () => {
  // 0.3.6 and earlier never wrote `alp.lastActivatedVersion`, but every one of
  // these was written by those builds. Each alone must be enough.
  for (const key of [
    "alp.tanSelfHealGaveUpPin",
    "alp.setupOrchestrator.lastShownFingerprint",
    "alp.lastBootstrapAt",
  ]) {
    const { lines } = activateWith({ [key]: "whatever-value" });
    const line = activationLine(lines);
    assert.doesNotMatch(
      line,
      /first activation on this machine/,
      `${key} proves a previous build ran, so this is an upgrade — got: ${line}`,
    );
    assert.match(line, /upgraded from a build older than/, `for ${key}`);
  }
});

test("a known previous version is named in the upgrade line", () => {
  const { lines } = activateWith(
    { "alp.lastActivatedVersion": "0.3.7" },
    "0.4.0",
  );
  assert.match(activationLine(lines), /upgraded from v0\.3\.7/);
});

test("an ordinary re-activation says nothing extra", () => {
  const { lines } = activateWith(
    { "alp.lastActivatedVersion": "0.3.7" },
    "0.3.7",
  );
  const line = activationLine(lines);
  assert.doesNotMatch(line, /first activation/);
  assert.doesNotMatch(line, /upgraded/);
});

test("the marker is recorded so the NEXT upgrade is detectable precisely", () => {
  const { state } = activateWith({}, "0.3.7");
  assert.equal(state.get("alp.lastActivatedVersion"), "0.3.7");
});
