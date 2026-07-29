// SPDX-License-Identifier: Apache-2.0
//
// "The window went away" is not "the thing failed".
//
// When the extension host tears a window down — reload, close, or a
// folder-open that replaces the workspace — the RPC protocol rejects EVERY
// pending main-thread reply with VS Code's `CancellationError`. An unanswered
// toast is the likeliest pending call, so the rejection lands on whatever
// happened to be awaiting one. Three shipped defects came out of that:
//
//   1. `[setup] readiness check failed: Canceled: Canceled` in the
//      customer-visible channel (two real extension-host transcripts) — a
//      surface whose whole job is "is my machine ready" saying it broke,
//      because the window closed.
//   2. `notifyAsync` had no rejection handler at all, so the same teardown
//      produced an unhandled rejection in the ext host with nothing naming
//      which of the ~85 call sites caused it.
//   3. `StateManager.refresh` answered ANY error with `emptyAlpIdeState()`,
//      repainting a fully provisioned machine as "you have nothing
//      installed" and hiding Build/Flash.
//
// The predicate is pure and structural: `vscode.CancellationError` is not
// importable from a pure module, and `instanceof` would not survive the RPC
// boundary anyway.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const { isCancellation } = require("../out/notify/service.js");

const root = path.join(__dirname, "..");

/** Load a compiled module with `stubs` standing in for its requires. Swaps
 *  Node's loader only for the synchronous require, so it never leaks into
 *  another test file sharing the process. (Same trick as
 *  test/setupOrchestrator.service.test.js.) */
function loadWithStubs(relative, stubs) {
  const modPath = require.resolve(path.join(root, "out", relative));
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

/** VS Code's own `CancellationError`: `constructor() { super("Canceled");
 *  this.name = this.message; }` — name AND message are both "Canceled". */
function cancellationError() {
  const err = new Error("Canceled");
  err.name = "Canceled";
  return err;
}

// ─────────────────────── the predicate's truth table ───────────────────────

test("isCancellation: VS Code's CancellationError shape is a cancellation", () => {
  assert.equal(isCancellation(cancellationError()), true);
  // The error crosses the extension-host RPC boundary, so what actually
  // arrives may be a re-hydrated plain object with no Error prototype. The
  // match is structural precisely so that still classifies.
  assert.equal(isCancellation({ name: "Canceled", message: "Canceled" }), true);
});

test("isCancellation: a REAL error that merely mentions cancellation is NOT one", () => {
  // THE case this predicate exists to get right. Matching on the message
  // alone would swallow real faults — silently, in the one channel the
  // customer is told to read — which is strictly worse than the noisy line
  // the predicate removes.
  assert.equal(
    isCancellation(new Error("Bootstrap was canceled by the user")),
    false,
  );
  assert.equal(
    isCancellation(new Error("west update canceled: connection reset")),
    false,
  );
  // An ordinary Error whose message is EXACTLY "Canceled" but whose name was
  // never set — a message-only match classifies this one as a cancellation.
  assert.equal(isCancellation(new Error("Canceled")), false);
});

test("isCancellation: half a match is no match", () => {
  assert.equal(isCancellation({ name: "Canceled", message: "" }), false);
  assert.equal(
    isCancellation({ name: "Canceled", message: "Canceled by the host" }),
    false,
  );
  assert.equal(isCancellation({ name: "Error", message: "Canceled" }), false);
  // Case matters: "cancelled"/"canceled" are not the value VS Code sets.
  assert.equal(
    isCancellation({ name: "cancelled", message: "cancelled" }),
    false,
  );
});

test("isCancellation: non-objects are never cancellations", () => {
  for (const value of [null, undefined, "Canceled", 0, false, Symbol("x")]) {
    assert.equal(isCancellation(value), false, `${String(value)}`);
  }
});

// ───────────── notifyAsync: the chain that had no rejection handler ─────────

/** Drive `notifyAsync` with a `showWarningMessage` that rejects with `err`.
 *  Returns the lines the output channel was given. */
async function notifyAsyncRejectingWith(err) {
  const logs = [];
  const { notifyAsync } = loadWithStubs(
    path.join("notify", "vscodeAdapter.js"),
    {
      vscode: {
        window: {
          showWarningMessage: async () => {
            throw err;
          },
          showErrorMessage: async () => undefined,
          showInformationMessage: async () => undefined,
          setStatusBarMessage() {},
        },
        commands: { executeCommand: async () => undefined },
      },
      "../util": {
        log: (line, level = "info") => logs.push({ line, level }),
        showOutput() {},
        revealRunInTerminal() {},
      },
      "../project/vscodeAdapter": { collectProjectContext: () => ({}) },
    },
  );

  notifyAsync({
    severity: "warning",
    channel: "toast",
    message: "Bootstrap needs build tools that aren't installed yet.",
    actions: [{ id: "runDoctor" }],
  });
  // Let the rejected chain settle. Without a handler on it this is where the
  // ext host gets an unhandled rejection (and `node --test` fails the file).
  await new Promise((resolve) => setImmediate(resolve));
  return logs;
}

test("notifyAsync: a toast rejected by window teardown is silent, not an unhandled rejection", async () => {
  const logs = await notifyAsyncRejectingWith(cancellationError());
  assert.deepEqual(
    logs.filter((l) => l.line.startsWith("[notify] could not present")),
    [],
    "nothing failed — the window went away while the toast was pending",
  );
});

test("notifyAsync: a real presentation failure is logged, naming the notification", async () => {
  const logs = await notifyAsyncRejectingWith(new Error("channel closed"));
  const reported = logs.filter((l) =>
    l.line.startsWith("[notify] could not present"),
  );
  assert.equal(reported.length, 1, "a real fault must not be silent");
  assert.equal(reported[0].level, "warn");
  assert.equal(
    reported[0].line,
    "[notify] could not present \"Bootstrap needs build tools that aren't " +
      'installed yet.": channel closed',
    "the line has to name WHICH notification failed — that is the whole " +
      "reason the unhandled rejection was undebuggable",
  );
});

// ─────────── StateManager: a failed query is not an empty machine ───────────

/** A `StateManager` over a `queryAlpIdeState` driven by `responses` (each
 *  entry is either a state to resolve or an Error to reject with). */
function stateManager(responses) {
  const logs = [];
  const listeners = [];
  const { StateManager } = loadWithStubs(
    path.join("views", "stateManager.js"),
    {
      vscode: {
        EventEmitter: class {
          get event() {
            return (fn) => listeners.push(fn);
          }
          fire(value) {
            for (const fn of listeners) fn(value);
          }
          dispose() {}
        },
      },
      "../ideHub/vscodeAdapter": {
        queryAlpIdeState: async () => {
          const next = responses.shift();
          if (next instanceof Error) throw next;
          return next;
        },
      },
      "../util": { log: (line, level = "info") => logs.push({ line, level }) },
    },
  );
  return { manager: new StateManager({}), logs, fired: listeners };
}

const PROVISIONED = {
  sdk: {
    activePath: "/opt/alp-sdk",
    version: "0.6.0",
    readiness: "ready",
    localEntries: [],
  },
  setup: {
    pythonAvailable: true,
    westAvailable: true,
    bootstrapRunning: false,
    lastBootstrapAt: null,
    toolVersions: {
      python: "3.11.3",
      west: "1.3.0",
      tan: "0.3.1",
      cmake: "3.28.0",
      ninja: "1.11.1",
    },
  },
  workspace: {
    workspaceRoot: "/w",
    boardYamlExists: true,
    westInitialized: true,
  },
};

test("StateManager: a failed refresh keeps the last good state and marks it stale", async () => {
  const { manager, logs } = stateManager([
    PROVISIONED,
    new Error("spawn ENOENT"),
  ]);

  await manager.refresh();
  assert.equal(manager.state.sdk.readiness, "ready");
  assert.equal(manager.stale, false);

  await manager.refresh();
  assert.equal(
    manager.state.sdk.readiness,
    "ready",
    "a transient spawn hiccup must not repaint a provisioned machine as " +
      "'you have nothing installed' — that hides Build/Flash and sends the " +
      "customer to reinstall an SDK that never went away",
  );
  assert.equal(manager.state.workspace.westInitialized, true);
  assert.equal(manager.stale, true, "the snapshot is old, not wrong");
  assert.deepEqual(
    logs.map((l) => l.level),
    ["warn"],
  );
  assert.match(
    logs[0].line,
    /^Alp IDE state refresh failed; keeping the last known state: /,
  );
});

test("StateManager: a refresh abandoned by window teardown is info, not a failure", async () => {
  const { manager, logs } = stateManager([PROVISIONED, cancellationError()]);
  await manager.refresh();
  await manager.refresh();
  assert.deepEqual(logs, [
    { line: "Alp IDE state refresh abandoned, window closing", level: "info" },
  ]);
  assert.equal(manager.state.sdk.readiness, "ready");
});

test("StateManager: a later good refresh clears stale", async () => {
  const { manager } = stateManager([new Error("spawn ENOENT"), PROVISIONED]);
  await manager.refresh();
  assert.equal(manager.stale, true);
  await manager.refresh();
  assert.equal(manager.stale, false);
  assert.equal(manager.state.sdk.readiness, "ready");
});
