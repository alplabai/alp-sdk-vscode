// SPDX-License-Identifier: Apache-2.0
//
// Walkthrough step 1 on a machine with no git.
//
// `handleRequestSdkInstall` is the ONLY SDK-install implementation and it is a
// `cp.spawn("git", ["clone", …])`. On a clean Windows 11 box there is no git,
// so the spawn never starts a process and Node raises ENOENT — and the shipped
// toast said "Alp: couldn't install SDK <version>." with one Retry button that
// re-spawned the same missing binary. Nothing on any surface said "git".
//
// What is asserted here is the customer-visible outcome, not an internal
// predicate: the real notify PLANNER and the real notify PRESENTER are loaded,
// with only `vscode` faked, so `message` is the toast text and `titles` are the
// button captions. The spawn stub calls the REAL `child_process.spawn` with a
// binary name that does not exist, so the ENOENT is Node's own on this host —
// not a hand-built Error that could drift from what a customer's machine
// produces.
//
// Both branches are covered, because collapsing them is the tempting wrong
// fix: a clone that RAN and exited non-zero (no network, a proxy that refuses
// CONNECT, a tag that does not exist) must keep Retry and must NOT tell a
// customer to install a git they already have.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const realCp = require("node:child_process");

const root = path.join(__dirname, "..");

/** A binary name no host has. `cp.spawn` of it produces a genuine ENOENT. */
const MISSING_BINARY = "alp-no-such-git-binary-xyz";

/** Same `Module._load` swap the other adapter tests use
 *  (test/deps.adapter.test.js, test/bootstrap.noWorkspace.test.js). */
function loadWithStubs(relPath, stubs) {
  const modPath = require.resolve(path.join(root, "out", relPath));
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

/**
 * Run one Install click and collect every customer-visible surface.
 *
 * `spawn` decides which failure is simulated: `"missing"` swaps the binary name
 * for one that does not exist (real ENOENT); `"exitCode"` runs a real process
 * that exits non-zero, which is what a failed-but-started clone looks like.
 */
async function driveInstall(spawnMode) {
  const toasts = [];
  const channel = [];
  const posted = [];

  const log = (line, level) => channel.push({ level: level ?? "info", line });

  const presenter = loadWithStubs("notify/vscodeAdapter.js", {
    vscode: {
      window: {
        showErrorMessage: (message, _options, ...titles) => {
          toasts.push({ severity: "error", message, titles });
          return Promise.resolve(undefined);
        },
        showWarningMessage: (message, _options, ...titles) => {
          toasts.push({ severity: "warning", message, titles });
          return Promise.resolve(undefined);
        },
        showInformationMessage: (message, _options, ...titles) => {
          toasts.push({ severity: "info", message, titles });
          return Promise.resolve(undefined);
        },
        setStatusBarMessage: (message) =>
          toasts.push({ severity: "statusBar", message, titles: [] }),
      },
      commands: { executeCommand: async () => undefined },
      env: { openExternal: async () => true },
      Uri: { parse: (u) => u, file: (p) => p },
      workspace: { openTextDocument: async () => ({}) },
    },
    "../project/vscodeAdapter": { collectProjectContext: () => ({}) },
    "../util": { log, showOutput: () => {}, revealRunInTerminal: () => {} },
  });

  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alp-sdk-install-"));
  try {
    const handler = loadWithStubs("ideHub/sdkManagerMessages.js", {
      vscode: {
        window: {
          withProgress: (_opts, task) =>
            task(
              { report() {} },
              { onCancellationRequested: () => ({ dispose() {} }) },
            ),
        },
        workspace: { getConfiguration: () => ({ inspect: () => undefined }) },
        commands: { executeCommand: async () => undefined },
        ConfigurationTarget: { Global: 1, Workspace: 2 },
        ProgressLocation: { Notification: 15 },
      },
      child_process: {
        spawn: (_cmd, args, opts) =>
          spawnMode === "missing"
            ? realCp.spawn(MISSING_BINARY, args, opts)
            : realCp.spawn(process.execPath, ["-e", "process.exit(128)"], opts),
      },
      "../alpCli/vscodeAdapter": {
        proxyEnvAdditions: () => ({}),
        runAlpCommand: async () => ({ outcome: {} }),
      },
      "../notify/vscodeAdapter": presenter,
      "../sdk/activeSdk": {
        clearActiveSdk: async () => {},
        setActiveSdk: async () => {},
        warnIfWestManifestDangling: () => false,
      },
      "../sdk/settingsWrite": { writeAlpSetting: async () => true },
      "../util": { log },
      "./vscodeAdapter": { sdkCacheRoot: () => cacheRoot },
    });

    const consumed = handler.createSdkMessageHandler({
      context: {},
      post: (msg) => posted.push(msg),
      refresh: async () => {},
    })({ type: "requestSdkInstall", version: "v0.13.0" });
    assert.equal(consumed, true, "the handler must consume requestSdkInstall");

    // The handler is fire-and-forget (`void handleRequestSdkInstall`), so wait
    // for the terminal progress message rather than a promise nobody returns.
    for (let i = 0; i < 200 && !posted.some((m) => m.done); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // The toast is planned after that post; give the microtask queue a turn.
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
  return { toasts, channel, posted };
}

test("no git on the box: the toast names Git and offers a way to get it", async () => {
  const { toasts } = await driveInstall("missing");

  assert.equal(toasts.length, 1, "exactly one toast for one failure");
  const [toast] = toasts;
  assert.equal(toast.severity, "error");
  assert.equal(
    toast.message,
    "Alp: installing SDK v0.13.0 needs Git, and Git isn't installed on this machine.",
  );
  // The customer sentence, not just the channel. Before this fix the sentence
  // was "Alp: couldn't install SDK v0.13.0." — which named nothing.
  assert.match(toast.message, /Git/);
  assert.deepEqual(toast.titles, ["Download Git", "Show Output"]);
});

test("no git on the box: Retry is NOT offered", async () => {
  const { toasts } = await driveInstall("missing");
  // A Retry that re-spawns a binary that does not exist is worse than no
  // button: it reads as "transient" and the customer clicks it forever.
  assert.equal(
    toasts[0].titles.includes("Retry"),
    false,
    "Retry re-runs the identical failing spawn and can never succeed",
  );
});

test("no git on the box: the errno stays in the channel, never the toast", async () => {
  const { toasts, channel, posted } = await driveInstall("missing");

  assert.equal(
    /ENOENT|spawn /.test(toasts[0].message),
    false,
    "the errno must not reach the customer sentence",
  );
  // …but it must still be diagnosable. The presenter logs `detail`, and it is
  // the ONLY place it is written.
  assert.ok(
    channel.some((entry) => entry.line.includes("ENOENT")),
    "the raw spawn error must reach the 'Alp SDK' output channel",
  );
  // The panel's own inline line says it in prose too — that line is what stays
  // on screen after the toast is dismissed.
  const done = posted.find((msg) => msg.done);
  assert.equal(done.success, false);
  assert.match(done.log, /Git isn't installed/);
});

test("a clone that RAN and failed keeps Retry and never blames git", async () => {
  const { toasts, channel } = await driveInstall("exitCode");

  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].message, "Alp: couldn't install SDK v0.13.0.");
  assert.deepEqual(toasts[0].titles, ["Retry", "Show Output"]);
  // No network, a proxy refusing CONNECT, a tag that does not exist — none of
  // them is fixed by installing git, and every one of them can succeed on a
  // second press.
  assert.equal(
    /Git/.test(toasts[0].message),
    false,
    "a started-then-failed clone must not be reported as a missing git",
  );
  assert.ok(
    channel.some((entry) => entry.line.includes("exited with code 128")),
    "the real exit code still reaches the channel",
  );
});
