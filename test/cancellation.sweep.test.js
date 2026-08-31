// SPDX-License-Identifier: Apache-2.0
//
// "The window closed" must never be reported as "your machine is broken".
//
// When the extension host tears down — a window close/reload, or a folder-open
// replacing the workspace — VS Code rejects EVERY pending main-thread RPC with
// a `CancellationError` whose `name` and `message` are both the literal
// "Canceled". A catch that reports that as a failure raises a toast, or writes
// an `[error]` line, about an operation that did not fail: it was abandoned
// along with the window. `String(err)` on one produces the nameless string
// "Canceled: Canceled", which names no operation and no cause.
//
// Every test here drives the REAL fixed function out of `out/` (the
// `Module._load` swap from test/bootstrap.noWorkspace.test.js), with the
// thrown value as the only variable, and asserts BOTH halves:
//
//   1. a cancellation produces no customer-facing failure and no failure-level
//      log line;
//   2. a REAL error still does — including one whose message merely mentions
//      cancellation ("Bootstrap was canceled by the user"), which is why
//      `isCancellation` matches `name` AND `message` instead of searching the
//      text. A silenced real fault is worse than the noisy line being removed.
//
// `src/notify/service.ts` is pure, so it is loaded FOR REAL everywhere below —
// the predicate under test is the shipped one, never a copy in a stub.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Load `out/<rel>.js` with `stubs` standing in for the requires named. Swaps
 *  Node's loader only for the duration of the synchronous require, so it never
 *  leaks into another test file sharing the process. */
function load(rel, stubs) {
  const modPath = require.resolve(path.join(root, "out", `${rel}.js`));
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

/** VS Code's own `CancellationError` as it arrives across the RPC boundary:
 *  the prototype does NOT survive, so only `name`/`message` are left to match
 *  on. Built as a plain Error with both fields set, exactly like the real one
 *  (`this.name = this.message = "Canceled"`). */
function cancellationError() {
  const err = new Error("Canceled");
  err.name = "Canceled";
  return err;
}

/** A GENUINE fault whose text merely mentions cancellation. Every "cancellation
 *  stays silent" assertion below is paired with this one, because a predicate
 *  that matched the message alone would swallow it. */
function realErrorMentioningCancellation() {
  return new Error("Bootstrap was canceled by the user");
}

/** Collect `log(line, level)` calls from a stubbed `../util`. */
function logSpy() {
  const lines = [];
  return {
    lines,
    log: (line, level = "info") => lines.push({ line, level }),
    at: (level) => lines.filter((l) => l.level === level).map((l) => l.line),
  };
}

// ── src/util.ts — vscode.tasks.executeTask rejects at teardown ───────────────
//
// `runInTerminal` dispatches every Alp terminal run (bootstrap, west
// build/flash, "Install tan"). `executeTask` is a main-thread RPC, so a window
// closing over a live build rejects it — and the old handler wrote
// `[terminal] "Alp Bootstrap" failed to start: Canceled: Canceled` at ERROR
// level into the channel the customer is told to check.

/** Drive `runInTerminal` against an `executeTask` that rejects with `rejection`
 *  and return the real channel lines it wrote (util.ts owns its own logger, so
 *  these are the shipped strings, level prefix and all). */
function runTerminalWithRejection(rejection) {
  const channel = [];
  const util = load("util", {
    vscode: {
      window: {
        createOutputChannel: () => ({
          appendLine: (l) => channel.push(l),
          show() {},
        }),
        terminals: [],
      },
      tasks: {
        executeTask: () => Promise.reject(rejection),
        onDidStartTask: () => ({ dispose() {} }),
        onDidEndTaskProcess: () => ({ dispose() {} }),
        onDidEndTask: () => ({ dispose() {} }),
      },
      EventEmitter: class {
        get event() {
          return () => ({ dispose() {} });
        }
        fire() {}
        dispose() {}
      },
      ProcessExecution: class {},
      Task: class {
        constructor(definition, scope, name) {
          this.definition = definition;
          this.scope = scope;
          this.name = name;
        }
      },
      TaskScope: { Workspace: 1 },
      TaskRevealKind: { Always: 1 },
      TaskPanelKind: { Dedicated: 1 },
    },
  });
  util.runInTerminal({
    name: "Alp Bootstrap",
    argv: ["tan", "bootstrap"],
    cwd: "/w",
  });
  return channel;
}

test("util.runInTerminal: a teardown cancellation is not an [error]", async () => {
  const channel = runTerminalWithRejection(cancellationError());
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(
    channel.filter((l) => l.includes("[error]")),
    [],
    "the window closed — nothing failed to start, so nothing may be logged " +
      "at error level in the channel the customer is told to check",
  );
  const line = channel.find((l) => l.includes("Alp Bootstrap"));
  assert.ok(
    line,
    "the abandoned run must still be named — a bare 'Canceled: Canceled' names no operation",
  );
  assert.ok(
    !/failed/i.test(line),
    `an abandoned run must not be worded as a failure, got: ${line}`,
  );
  assert.ok(
    !line.includes("Canceled: Canceled"),
    `the nameless RPC string must never reach the channel, got: ${line}`,
  );
});

test("util.runInTerminal: a real start failure is still an [error]", async () => {
  const channel = runTerminalWithRejection(realErrorMentioningCancellation());
  await new Promise((r) => setImmediate(r));

  const errors = channel.filter((l) => l.includes("[error]"));
  assert.equal(
    errors.length,
    1,
    "a genuine failure to start must still be reported at error level, even " +
      "when its message mentions cancellation — matching the message alone " +
      "would silence it",
  );
  assert.ok(errors[0].includes('"Alp Bootstrap" failed to start'));
  assert.ok(errors[0].includes("Bootstrap was canceled by the user"));
});

// ── src/sdk/settingsWrite.ts — WorkspaceConfiguration.update rejects ─────────
//
// The guard lives at this seam, not in its three callers (setActiveSdk,
// clearActiveSdk, the uninstall pointer-clear): every one of them turns a
// throw from here into a toast. `false` is already each caller's silent path.

/** Drive the real `writeAlpSetting` against an `update()` that rejects. */
async function writeSettingWithRejection(rejection) {
  const plans = [];
  const spy = logSpy();
  const { writeAlpSetting } = load("sdk/settingsWrite", {
    vscode: {
      workspace: {
        getConfiguration: () => ({
          update: () => Promise.reject(rejection),
        }),
        textDocuments: [],
      },
      ConfigurationTarget: { Workspace: 2, Global: 1 },
    },
    "../notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return undefined;
      },
    },
    "../util": { log: spy.log },
  });
  let thrown;
  let returned;
  try {
    returned = await writeAlpSetting("path", "/sdk", 2);
  } catch (err) {
    thrown = err;
  }
  return { plans, spy, thrown, returned };
}

test("settingsWrite: a teardown cancellation is silent and unwritten", async () => {
  const { plans, spy, thrown, returned } =
    await writeSettingWithRejection(cancellationError());

  assert.equal(
    thrown,
    undefined,
    "a closing window must not throw into the caller — every caller turns that into a toast",
  );
  assert.equal(
    returned,
    false,
    "the value was NOT written, so the caller must not be told it was",
  );
  assert.deepEqual(
    plans,
    [],
    "no customer-facing notification for a window that went away",
  );
  assert.deepEqual(spy.at("warn"), [], "and nothing at warn level either");
  const line = spy.lines[0]?.line ?? "";
  assert.ok(
    line.includes("alpSdk.path") && !/failed/.test(line),
    `the log must name the abandoned setting without calling it a failure, got: ${line}`,
  );
});

test("settingsWrite: a real error mentioning cancellation still throws", async () => {
  const { spy, thrown } = await writeSettingWithRejection(
    realErrorMentioningCancellation(),
  );

  assert.ok(
    thrown instanceof Error,
    "a genuine write failure must reach the caller so it can be surfaced — " +
      "`isCancellation` matches name AND message precisely so this survives",
  );
  assert.equal(thrown.message, "Bootstrap was canceled by the user");
  assert.ok(
    spy.lines.some((l) => l.line.includes("alpSdk.path write failed")),
    "and it must still be recorded as a failure in the channel",
  );
});

// ── src/ideHub/vscodeAdapter.ts — the folder-open that IS the teardown ───────
//
// Replacing the workspace tears this extension host down: that is the command
// WORKING. The pending `executeCommand` reply is then rejected, and the New
// Project flow reported it as "creating the project failed" on the one path
// where everything succeeded.

function loadIdeHubAdapter(executeCommand) {
  const spy = logSpy();
  const mod = load("ideHub/vscodeAdapter", {
    vscode: {
      commands: { executeCommand },
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
      env: { shell: undefined },
      Uri: { file: (p) => ({ fsPath: p }) },
    },
    "@alp-sdk/core/sdk/service": {
      checkSdkReadiness: () => ({ state: "ready", issues: [] }),
      listLocalSdkEntries: () => [],
    },
    "@alp-sdk/core/paths": {
      sameUserPath: (a, b) => a === b,
      toPosix: (p) => p,
    },
    "../project/vscodeAdapter": { collectProjectContext: () => ({}) },
    "../environment/vscodeAdapter": {
      resolveWestBinary: () => null,
      venvWestExists: () => false,
      westWorkspaceInitialized: () => false,
    },
    "../alpCli/vscodeAdapter": { probeTanVersion: async () => null },
    "../util": { log: spy.log, isRunActive: () => false },
  });
  return { mod, spy };
}

test("openProjectFolder: the window replacing itself is not a failure", async () => {
  const { mod, spy } = loadIdeHubAdapter(() =>
    Promise.reject(cancellationError()),
  );

  await mod.openProjectFolder({ fsPath: "/w/new-proj" }, false);

  assert.deepEqual(
    spy.at("warn"),
    [],
    "the open SUCCEEDED — the host died because it worked",
  );
  assert.deepEqual(spy.at("error"), []);
  assert.ok(
    spy.lines.some((l) => l.line.includes("/w/new-proj")),
    "the abandoned open must still name the folder it was opening",
  );
});

test("openProjectFolder: a genuine openFolder rejection still propagates", async () => {
  const { mod } = loadIdeHubAdapter(() =>
    Promise.reject(realErrorMentioningCancellation()),
  );

  await assert.rejects(
    () => mod.openProjectFolder({ fsPath: "/w/gone" }, false),
    /Bootstrap was canceled by the user/,
    "a real refusal (a deleted directory, a rejected URI) must still reach the caller",
  );
});

test("openProjectFolder: forceNewWindow keeps this host alive, so a cancellation is real", async () => {
  const { mod } = loadIdeHubAdapter(() => Promise.reject(cancellationError()));

  // Only the REPLACING mode tears this extension host down. With
  // `forceNewWindow` nothing here is going away, so a cancellation means the
  // folder did not open — and the caller (the wizard) disposes its panel right
  // after this resolves. Swallowed, the customer gets a created project, no
  // window, no wizard and no word about any of it.
  await assert.rejects(
    () => mod.openProjectFolder({ fsPath: "/w/new-proj" }, true),
    (err) => err.name === "Canceled",
    "a cancellation in the surviving-host mode must still reach the caller",
  );
});

// ── src/wizard.ts — the activation-path first-run offer ──────────────────────
//
// The readiness-path twin of `maybeOfferSetupPanel` (fixed in #373). Called as
// `void maybeOfferFirstRunWizard(context)` from `activate`, so an unguarded
// rejection was an UNHANDLED one in the extension host, naming nothing.

async function offerFirstRunWithRejection(rejection) {
  const plans = [];
  const spy = logSpy();
  const { maybeOfferFirstRunWizard } = load("wizard", {
    vscode: {
      commands: { registerCommand: () => ({ dispose() {} }) },
      window: {},
    },
    "@alp-sdk/core/wizard/scaffoldArgv": { planScaffoldArgv: () => [] },
    "@alp-sdk/core/wizard/scaffoldPayload": {
      classifyScaffoldRefusal: () => null,
      isScaffoldNoOp: () => false,
      narrowScaffoldResult: () => null,
    },
    "./alpCli/vscodeAdapter": { runAlpCommand: async () => ({}) },
    "./loader": {
      CANCELLED: Symbol("cancelled"),
      runAlpWithProgress: async () => ({}),
    },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return undefined;
      },
    },
    "./project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: "/w",
        // Must NOT exist: the offer is only made when there is no board.yaml.
        boardYamlPath: path.join(
          os.tmpdir(),
          "alp-no-such-board-yaml",
          "board.yaml",
        ),
      }),
    },
    "./util": { log: spy.log },
  });

  await maybeOfferFirstRunWizard({
    workspaceState: {
      get: () => false,
      update: () => Promise.reject(rejection),
    },
  });
  return { plans, spy };
}

test("maybeOfferFirstRunWizard: a teardown cancellation stays out of the channel", async () => {
  const { plans, spy } = await offerFirstRunWithRejection(cancellationError());

  assert.deepEqual(plans, [], "no offer to a window that is closing");
  assert.deepEqual(spy.at("warn"), [], "and nothing worded as a failure");
  assert.ok(
    spy.lines.some((l) => l.line.includes("abandoned")),
    "the abandoned offer is still named, so a support thread can explain the silence",
  );
});

test("maybeOfferFirstRunWizard: a real error is reported and never thrown", async () => {
  const { spy } = await offerFirstRunWithRejection(
    realErrorMentioningCancellation(),
  );

  assert.ok(
    spy.at("warn").some((l) => l.includes("first-run offer failed")),
    "a genuine failure must still be recorded at warn level even though its " +
      "message mentions cancellation",
  );
});

// ── src/ideHub/sdkManagerMessages.ts — SDK Manager webview handlers ──────────
//
// `setActiveSdk`/`clearActiveSdk` both await `alp.views.refresh` (and a toast),
// so a closing window rejects them — and each handler turned that into
// "Alp: couldn't set the active SDK" / "couldn't deactivate the SDK".

function sdkHandlerWith(rejection) {
  const plans = [];
  let refreshes = 0;
  const handle = load("ideHub/sdkManagerMessages", {
    vscode: {
      workspace: { getConfiguration: () => ({ inspect: () => undefined }) },
      window: {},
      commands: { executeCommand: async () => undefined },
      ConfigurationTarget: { Workspace: 2, Global: 1 },
    },
    "@alp-sdk/core/sdk/service": { installSdkRelease: async () => undefined },
    "@alp-sdk/core/paths": { sameUserPath: (a, b) => a === b },
    "../alpCli/vscodeAdapter": { runAlpCommand: async () => ({ outcome: {} }) },
    "../sdk/activeSdk": {
      setActiveSdk: () => Promise.reject(rejection),
      clearActiveSdk: () => Promise.reject(rejection),
      warnIfWestManifestDangling: () => false,
    },
    "../sdk/settingsWrite": { writeAlpSetting: async () => true },
    "../util": { log: () => {} },
    "./vscodeAdapter": { sdkCacheRoot: () => "/cache" },
    "../notify/vscodeAdapter": {
      notify: async () => undefined,
      notifyAsync: (plan) => plans.push(plan),
    },
  }).createSdkMessageHandler({
    context: {},
    post: () => {},
    refresh: async () => {
      refreshes += 1;
    },
  });
  return { handle, plans, refreshCount: () => refreshes };
}

for (const [type, msg] of [
  ["switchSdk", { type: "switchSdk", sdkPath: "/sdk" }],
  ["deactivateSdk", { type: "deactivateSdk" }],
]) {
  test(`sdkManager ${type}: a teardown cancellation raises no toast`, async () => {
    const { handle, plans, refreshCount } = sdkHandlerWith(cancellationError());

    handle(msg);
    await new Promise((r) => setImmediate(r));

    assert.deepEqual(
      plans,
      [],
      "the window closed mid-switch — telling the customer the SDK change " +
        "failed is the closed-window-vs-broken confusion",
    );
    assert.equal(
      refreshCount(),
      0,
      "and nothing repaints a panel that is going away",
    );
  });

  test(`sdkManager ${type}: a real error still raises one`, async () => {
    const { handle, plans } = sdkHandlerWith(realErrorMentioningCancellation());

    handle(msg);
    await new Promise((r) => setImmediate(r));

    assert.equal(plans.length, 1, "a genuine failure must still be surfaced");
    assert.equal(plans[0].severity, "error");
    assert.ok(plans[0].detail.includes("Bootstrap was canceled by the user"));
  });
}

// ── src/alpCli/vscodeAdapter.ts — checkCliVersion, both void call sites ──────
//
// `void checkCliVersion(context)` runs from `activate` and from the
// cliPath/preferGlobalCli config listener. Its body awaits a toast and a
// `globalState.update`; unguarded, a closing window made that an unhandled
// rejection in the host. The binary probe below is `process.execPath
// --version`, whose output is not a native `tan <x.y.z>` line, so the real
// code path reaches `warnAboutResolvedBinary` -> the notify that rejects.

async function checkCliVersionWith(rejection) {
  const spy = logSpy();
  const { checkCliVersion } = load("alpCli/vscodeAdapter", {
    vscode: {
      workspace: {
        getConfiguration: () => ({ get: (_k, d) => d }),
      },
      window: {},
      commands: {},
      Uri: { file: (p) => ({ fsPath: p }) },
    },
    "./adapterCore": {
      resolveAlpBinary: async () => ({
        command: process.execPath,
        source: "cliPath",
      }),
      resolutionInputFromDeps: () => ({}),
      downloadCli: async () => undefined,
      runAlpAsync: async () => ({}),
    },
    "../project/vscodeAdapter": { collectProjectContext: () => ({}) },
    "../notify/vscodeAdapter": {
      notify: () => Promise.reject(rejection),
      notifyAsync: () => {},
    },
    "../util": { log: spy.log, runInTerminal: () => {} },
  });

  await checkCliVersion({
    extensionPath: "/ext",
    globalStorageUri: { fsPath: "/gs" },
    globalState: { get: () => undefined, update: async () => undefined },
  });
  return spy;
}

test("checkCliVersion: a teardown cancellation never escapes and never warns", async () => {
  const spy = await checkCliVersionWith(cancellationError());

  assert.deepEqual(
    spy.at("warn"),
    [],
    "both call sites are `void checkCliVersion(...)`, so a rejection here is " +
      "an unhandled one naming nothing — and a closing window is not a warning",
  );
  assert.ok(
    spy.lines.some((l) => l.line.includes("version check abandoned")),
    "the abandoned check is named instead",
  );
});

test("checkCliVersion: a real error is caught, named, and warned", async () => {
  const spy = await checkCliVersionWith(realErrorMentioningCancellation());

  const warns = spy.at("warn");
  assert.ok(
    warns.some((l) => l.includes("version check failed")),
    "a genuine failure must still be recorded — and still not thrown, since " +
      "nothing awaits this function",
  );
  assert.ok(
    warns.some((l) => l.includes("Bootstrap was canceled by the user")),
  );
});

// ── src/alpCli/vscodeAdapter.ts — the two that raise a TOAST ────────────────
//
// The loudest members of the swept class, and the only two that were untested:
// `ensureTanCliProvisioned` (activation) and `updateAlpCli` (`alp.updateCli`)
// each wrap a binary download in `window.withProgress`. That progress
// notification is a main-thread RPC, so a closing window rejects the whole
// await — and each catch raised a customer-facing failure toast ("Couldn't
// download the tan CLI…", "The tan CLI update failed."). Both guards were
// provably deletable with the rest of this suite green before this block
// existed; that is exactly what these four fixtures close.

/** Load the real adapter with `withProgress` rejecting, and collect every plan
 *  the failure path raises. `resolutionInputFromDeps` returns `{}`, so the REAL
 *  `decideBinarySource` answers "download" and the fetch branch is reached for
 *  real in both functions — nothing about the decision is stubbed. */
function cliDownloadWith(rejection) {
  const plans = [];
  const spy = logSpy();
  const mod = load("alpCli/vscodeAdapter", {
    vscode: {
      workspace: { getConfiguration: () => ({ get: (_k, d) => d }) },
      // The RPC that rejects at teardown. Rejecting it (rather than the
      // download inside it) is the honest teardown shape: the host cancels the
      // pending reply, so the callback's own `cancelled` flag is never set —
      // which is precisely why the user-pressed-Cancel guard above these two
      // does not cover this case.
      window: { withProgress: () => Promise.reject(rejection) },
      commands: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      ProgressLocation: { Notification: 15 },
    },
    "./adapterCore": {
      resolveAlpBinary: async () => ({
        command: process.execPath,
        source: "download",
      }),
      resolutionInputFromDeps: () => ({}),
      downloadCli: async () => undefined,
      runAlpAsync: async () => ({}),
    },
    "../project/vscodeAdapter": { collectProjectContext: () => ({}) },
    "../notify/vscodeAdapter": {
      // `resolutionInputFromDeps` answers `{}` (a real fresh install), so
      // `ensureTanCliProvisioned`'s consent gate awaits this once, for the
      // confirm dialog, before it ever reaches `withProgress` — the RPC this
      // fixture is actually about. Answering with the dialog's own action
      // simulates the user accepting, so the teardown/real-error split below
      // still exercises `withProgress`, not the consent step.
      notify: async (plan) => plan.actions[0]?.id,
      notifyAsync: (plan) => plans.push(plan),
    },
    "../util": { log: spy.log, runInTerminal: () => {} },
  });
  const context = {
    extensionPath: "/ext",
    globalStorageUri: { fsPath: "/gs" },
    globalState: { get: () => undefined, update: async () => undefined },
  };
  return { mod, context, plans, spy };
}

for (const [fn, toast] of [
  ["ensureTanCliProvisioned", "Couldn't download the tan CLI"],
  ["updateAlpCli", "The tan CLI update failed."],
]) {
  test(`${fn}: a teardown cancellation raises no failure toast`, async () => {
    const { mod, context, plans, spy } = cliDownloadWith(cancellationError());

    await mod[fn](context);

    assert.deepEqual(
      plans,
      [],
      `the window closed mid-download — "${toast}" for a window the customer ` +
        "just closed is the closed-window-vs-broken confusion at its loudest",
    );
    assert.deepEqual(spy.at("warn"), [], "and nothing at warn level either");
    assert.ok(
      spy.lines.some((l) => l.line.includes("abandoned")),
      "the abandoned fetch is still named, so a support thread can explain the silence",
    );
  });

  test(`${fn}: a real error mentioning cancellation still toasts`, async () => {
    const { mod, context, plans } = cliDownloadWith(
      realErrorMentioningCancellation(),
    );

    await mod[fn](context);

    assert.equal(
      plans.length,
      1,
      "a genuine download failure must still reach the customer, even when " +
        "its message mentions cancellation — matching the message alone would " +
        "silence the only signal that the CLI is missing",
    );
    assert.equal(plans[0].severity, "error");
    assert.ok(
      plans[0].message.includes(toast),
      `the shipped sentence must survive, got: ${plans[0].message}`,
    );
    assert.ok(plans[0].detail.includes("Bootstrap was canceled by the user"));
  });
}

// ── src/ideHub/newProjectFlowPanel.ts — the voided message pump ─────────────
//
// `void this.handleMessage(msg)` had no rejection handler at all, and the
// create path ENDS in the workspace-replacing folder open — so the wizard's
// own success was the likeliest producer of an unhandled rejection naming
// nothing.

/** Open the real panel against a fake webview and return the message callback
 *  it registered, plus everything the failure path can produce. */
function newProjectPanelWith(rejection) {
  const plans = [];
  const spy = logSpy();
  let onMessage;
  const { NewProjectFlowPanel } = load("ideHub/newProjectFlowPanel", {
    vscode: {
      window: {
        // The RPC that rejects at teardown. `handleMessage` does NOT catch it
        // (unlike `sendState`, which swallows its own query failure), so it is
        // the honest stand-in for every unguarded await in this pump — right up
        // to the workspace-replacing folder open the create path ends in.
        showOpenDialog: () => Promise.reject(rejection),
        createWebviewPanel: () => ({
          webview: {
            set html(_v) {},
            onDidReceiveMessage: (cb) => {
              onMessage = cb;
              return { dispose() {} };
            },
            postMessage: async () => true,
          },
          onDidDispose: () => ({ dispose() {} }),
          reveal() {},
          dispose() {},
        }),
      },
      ViewColumn: { One: 1 },
      Uri: { joinPath: (...p) => p.join("/"), file: (p) => ({ fsPath: p }) },
      commands: { executeCommand: async () => undefined },
      env: { openExternal: async () => true },
    },
    "../alpCli/vscodeAdapter": { runAlpCommand: async () => ({ outcome: {} }) },
    "./messages": {
      PROTOCOL_VERSION: 1,
      emptyAlpIdeState: () => ({}),
      E1M_MODULES: [],
    },
    "./projectScaffold": { E1M_MODULES: [] },
    "./projectSettings": { buildProjectSettings: () => ({}) },
    "./setupOrchestrator": { resetSetupNudge: async () => undefined },
    "./vscodeAdapter": {
      openProjectFolder: async () => undefined,
      queryAlpIdeState: async () => ({}),
    },
    "./webviewHtml": {
      buildWebviewHtml: () => "",
      runWebviewCommand: () => {},
    },
    "../notify/vscodeAdapter": {
      notify: async () => undefined,
      notifyAsync: (plan) => plans.push(plan),
    },
    "../util": { log: spy.log },
  });

  NewProjectFlowPanel.open({
    extensionUri: "/ext",
    globalState: { get: () => null, update: async () => undefined },
  });
  return { fire: (msg) => onMessage(msg), plans, spy };
}

test("newProjectFlowPanel: a teardown cancellation is not a wizard error", async () => {
  const { fire, plans, spy } = newProjectPanelWith(cancellationError());

  fire({ type: "pickProjectLocation" });
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(
    plans,
    [],
    "the wizard's own success (the new project's window opening) must not " +
      "raise an 'unexpected error' toast on the way out",
  );
  assert.ok(
    spy.lines.some((l) => l.line.includes('"pickProjectLocation" abandoned')),
    "and the abandoned message is named, not left as a nameless unhandled rejection",
  );
});

test("newProjectFlowPanel: a real handler error is surfaced with its message named", async () => {
  const { fire, plans } = newProjectPanelWith(
    realErrorMentioningCancellation(),
  );

  fire({ type: "pickProjectLocation" });
  await new Promise((r) => setImmediate(r));

  assert.equal(
    plans.length,
    1,
    "a genuine wizard fault must still reach the customer",
  );
  assert.ok(
    plans[0].detail.startsWith("pickProjectLocation:"),
    `the failing message type must be named in the detail, got: ${plans[0].detail}`,
  );
});

// ── the predicate itself ─────────────────────────────────────────────────────

test("isCancellation matches name AND message, never the message alone", () => {
  const { isCancellation } = require(
    path.join(root, "out", "notify", "service.js"),
  );

  assert.equal(isCancellation(cancellationError()), true);
  assert.equal(
    isCancellation(realErrorMentioningCancellation()),
    false,
    "a real fault whose text mentions cancellation must NOT be swallowed",
  );
  // The prototype does not survive the RPC boundary, so a plain object with the
  // right shape must match — this is why the check is structural.
  assert.equal(isCancellation({ name: "Canceled", message: "Canceled" }), true);
  assert.equal(
    isCancellation({ name: "Canceled", message: "Canceled by user" }),
    false,
  );
  assert.equal(isCancellation({ message: "Canceled" }), false);
  assert.equal(isCancellation(null), false);
  assert.equal(isCancellation("Canceled"), false);
});
