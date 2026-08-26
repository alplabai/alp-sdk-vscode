// SPDX-License-Identifier: Apache-2.0
//
// A streamed run that dies on a SIGNAL has to signal completion too.
//
// `runAlpStreamed`'s exit handler split its two outcomes: an ordinary exit
// called `signalStreamedFinished`, and a signal death only wrote a log line —
// "a kill (the Cancel button) is not a failure to report as one", which is the
// right decision about the TOAST and the wrong one about the EVENT.
//
// `onDidFinishTerminalCommand` is not only how a verdict reaches a toast. It is
// also:
//
//   - how `BuildDelegatePty` (src/tasks/vscodeAdapter.ts) learns that the build
//     it is WAITING on has ended. That pty backs the debug `preLaunchTask`, and
//     with no event it never closes — so cancelling a streamed `tan build` that
//     an F5 was queued behind hangs the debug session until the window is
//     reloaded. The pty already does `this.finish(event.code ?? 1)` precisely
//     because "ended with no verdict" must never read as success to a
//     `preLaunchTask`;
//   - how `refreshState()` runs at all after a dispatch (src/extension.ts) — a
//     cancelled build still changed `build/` on disk;
//   - how `recordBuildFinish` records that a build ended (#470), which is what
//     lets the Build Plan panel mark a `system-manifest.yaml` an already-
//     finished build did not update as stale.
//
// The TERMINAL path never had this gap: `util.ts`'s `finish` fires
// `terminalFinished` unconditionally with a possibly-`undefined` code, and
// states the rule this file holds the streamed path to — "an undefined `code`
// means the task ended without its process ever starting … there is no verdict
// to report and the subscriber stays silent". So the fix is symmetry, not a new
// convention: fire the event, carry no exit code, and the subscriber
// (`code === 0` / `else if (code !== undefined)`) stays silent on its own.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const ADAPTER = require.resolve(
  path.join(root, "out", "alpCli", "vscodeAdapter.js"),
);
const REAL_ADAPTER_CORE = require(
  path.join(root, "out", "alpCli", "adapterCore.js"),
);

/**
 * A child that ends the way `end` says: `{ code }` for an ordinary exit,
 * `{ signal }` for a death by signal — the shape Node hands `child.on("exit",
 * (code, signal) => …)`.
 */
function fakeChild(end) {
  const stream = { setEncoding() {}, on() {} };
  return {
    stdout: stream,
    stderr: stream,
    kill() {},
    on(event, handler) {
      if (event !== "exit") return;
      setImmediate(() => handler(end.code ?? null, end.signal ?? null));
    },
  };
}

/** Load the real adapter, driving a child that ends as `end` describes, and
 *  capture every `signalStreamedFinished` call it makes. */
function loadAdapter(end) {
  delete require.cache[ADAPTER];
  const finished = [];
  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
        workspaceFolders: undefined,
      },
      window: {
        // Run the body immediately with a token nobody cancels: this file is
        // about the EXIT, not the Cancel button.
        withProgress: (_options, body) =>
          body(
            { report() {} },
            { isCancellationRequested: false, onCancellationRequested() {} },
          ),
      },
      ProgressLocation: { Notification: 15 },
    },
    child_process: {
      spawn: () => fakeChild(end),
      spawnSync: () => ({ status: 0, stdout: "tan 0.0.0\n", stderr: "" }),
      execFile: () => {},
    },
    "./adapterCore": {
      ...REAL_ADAPTER_CORE,
      resolveAlpBinary: async () => ({ command: "tan", source: "cached" }),
    },
    "../notify/vscodeAdapter": {
      notify: async () => undefined,
      notifyAsync() {},
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: null,
        sdkRoot: null,
        boardYamlPath: null,
        westCwd: null,
        pythonBinary: "python",
      }),
    },
    "../util": {
      log() {},
      appendOutput() {},
      showOutput() {},
      runInTerminal() {},
      reserveStreamedRun: () => true,
      releaseStreamedRun() {},
      isStreamedRunActive: () => false,
      signalStreamedFinished: (name, code) => finished.push({ name, code }),
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let adapter;
  try {
    adapter = require(ADAPTER);
  } finally {
    Module._load = originalLoad;
    delete require.cache[ADAPTER];
  }
  return {
    adapter,
    finished,
    context: {
      extensionPath: root,
      globalStorageUri: { fsPath: path.join(root, "no-such-storage-dir") },
      globalState: { update: async () => {} },
    },
  };
}

test("an ordinary exit reports its code", async () => {
  // The control. A change that fired the event unconditionally with no code
  // would satisfy the signal case below while destroying every verdict.
  const { adapter, finished, context } = loadAdapter({ code: 0 });

  await adapter.runAlpStreamed(context, ["build"], { name: "Alp Build" });

  assert.deepEqual(finished, [{ name: "Alp Build", code: 0 }]);
});

test("a failing exit reports its code", async () => {
  const { adapter, finished, context } = loadAdapter({ code: 2 });

  await adapter.runAlpStreamed(context, ["build"], { name: "Alp Build" });

  assert.deepEqual(finished, [{ name: "Alp Build", code: 2 }]);
});

test("a run killed by a signal still signals that it finished", async () => {
  const { adapter, finished, context } = loadAdapter({ signal: "SIGTERM" });

  await adapter.runAlpStreamed(context, ["build"], { name: "Alp Build" });

  assert.equal(
    finished.length,
    1,
    "no finish event means `BuildDelegatePty` never closes, so an F5 queued " +
      "behind this build waits forever",
  );
  assert.equal(finished[0].name, "Alp Build");
});

test("a signal death carries no exit code, so it cannot read as success", async () => {
  // `["build"]`, not `["flash"]`. This is about the EXIT CODE of a signal
  // death, which has nothing to do with flashing — and a `flash` argv now goes
  // through `gateFlashDispatch`, which refuses a project with no
  // `build/system-manifest.yaml` and spawns nothing, so the assertion below
  // would read an empty array rather than a killed run (#540).
  const { adapter, finished, context } = loadAdapter({ signal: "SIGKILL" });

  await adapter.runAlpStreamed(context, ["build"], { name: "Alp Build" });

  assert.equal(
    finished[0].code,
    undefined,
    "a signal death HAS no exit code. Reporting 0 would tell a preLaunchTask " +
      "to go ahead and debug a build that was killed, and would raise the " +
      'success toast (and "Show Result") for a run that was stopped',
  );
});
