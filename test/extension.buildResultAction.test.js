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
      // Never read by the subscriber under test: its #553 manifest read takes
      // the RUN's cwd off the finish event, not the workspace root, because
      // `alpBuild` does not always build the root.
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

// ── #540: a non-zero flash exit is not evidence that a flash failed ────────
//
// At the 0.6.0 pin an UNARMED confirm gate exits non-zero for a run that
// deliberately previewed and wrote nothing; a missing backend tool exits
// before a slice is touched; a multi-slice run can exit non-zero having
// already programmed the slices ahead of the one that stopped it. One exit
// number cannot tell those apart, so the toast must not pick one.
test("a failed Alp Flash finish never claims the flash failed", () => {
  const { subscriber, plans } = activateAndCapture();
  subscriber({ name: "Alp Flash", code: 1, mode: "channel" });

  const plan = plans.at(-1);
  assert.doesNotMatch(
    plan.message,
    /fail/i,
    "the exit status does not say a write was attempted and lost",
  );
  assert.match(plan.message, /did not complete/);
  // And it warns before a re-flash, because a partially programmed board is
  // one of the outcomes this exit code covers.
  assert.match(plan.message, /whether any slice was written/);
  assert.match(plan.message, /read the log before re-flashing/);
  // The number itself stays channel-only, as the seam's contract requires.
  assert.equal(plan.detail, "exit 1");
});

test("every other run still gets the plain failure sentence", () => {
  const { subscriber, plans } = activateAndCapture();
  subscriber({ name: "Alp Build", code: 2, mode: "channel" });
  assert.equal(plans.at(-1).message, "Alp Build failed.");
});

// ---------------------------------------------------------------------------
// #553: a green build must not hide a blocked IPC link
//
// `tan init --cores` scaffolds a default `ipc:` entry whenever a companion
// core is named. On a SoM that has not been HW-mapped it resolves
// `status: blocked` with a concrete reason, the build succeeds and exits 0,
// and nothing said so. These drive the REAL subscriber against a REAL manifest
// on disk — the pure rule and the wording are pinned separately in
// `test/systemManifest.ipcHealth.test.js`; what is pinned here is that
// anything LOOKS at all, which is the whole defect.
// ---------------------------------------------------------------------------

/** A throwaway project directory holding `build/system-manifest.yaml`, as the
 *  run's own cwd — which is what the finish event carries and what the
 *  subscriber must read, since `alpBuild` does not always build the workspace
 *  root. */
function projectWithManifest(yaml) {
  const fs = require("node:fs");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-ipc-notice-"));
  if (yaml !== undefined) {
    fs.mkdirSync(path.join(dir, "build"), { recursive: true });
    fs.writeFileSync(path.join(dir, "build", "system-manifest.yaml"), yaml);
  }
  return dir;
}

/** The shape a dual-M55 AEN project ships, verbatim from a generated file. */
const BLOCKED_MANIFEST = `schema_version: 1
hw_info: {}
slices: []
helper_mcus: []
ipc:
- name: alp_default_rpmsg
  kind: rpmsg
  endpoints:
  - m55_hp
  - a32_cluster
  status: blocked
  reason: memory_map.base is TBD for region 'mram_main' in SoM E1M-AEN801
`;

test("a green build with a blocked IPC link says so, after saying it finished", () => {
  const { subscriber, plans } = activateAndCapture();
  subscriber({
    name: "Alp Build",
    code: 0,
    mode: "channel",
    cwd: projectWithManifest(BLOCKED_MANIFEST),
  });

  // The success toast is still first and still unqualified — the build DID
  // succeed, and this must not turn a green run red.
  assert.equal(plans[0].message, "Alp Build finished.");
  const notice = plans.at(-1);
  assert.notEqual(notice, plans[0], "nothing was said about the ipc link");
  assert.equal(notice.severity, "warning");
  assert.match(notice.message, /succeeded/);
  assert.match(notice.message, /alp_default_rpmsg/);
  assert.match(notice.message, /blocked/);
  // The reason is the only actionable half, and it must survive verbatim.
  assert.match(notice.detail, /memory_map\.base is TBD for region 'mram_main'/);
  // …and be one click away rather than buried, since `detail` is
  // channel-only by this repo's convention.
  assert.deepEqual(
    notice.actions.map((a) => a.id),
    ["showOutput"],
  );
});

test("the manifest read follows the RUN's cwd, not the workspace root", () => {
  // The defect this guards: `alpBuild` sends `["--project", <example>,
  // "build"]` when the active project is not the target, and tan writes THAT
  // project's manifest. Reading the root's would name an IPC link from a
  // project the build never compiled. `workspaceFolders` is undefined in this
  // harness, so a subscriber reaching for the root finds nothing and this
  // assertion fails.
  const { subscriber, plans } = activateAndCapture();
  subscriber({
    name: "Alp Build",
    code: 0,
    mode: "channel",
    cwd: projectWithManifest(BLOCKED_MANIFEST),
  });
  assert.match(plans.at(-1).message, /alp_default_rpmsg/);
});

test("a finish event with no cwd says nothing", () => {
  // Terminal-mode runs do not carry one. Silence is the safe direction;
  // guessing a directory is how a notice ends up describing another project.
  const { subscriber, plans } = activateAndCapture();
  subscriber({ name: "Alp Build", code: 0, mode: "terminal" });
  assert.equal(plans.length, 1);
});

test("a manifest whose links are all ok says nothing extra", () => {
  const { subscriber, plans } = activateAndCapture();
  subscriber({
    name: "Alp Build",
    code: 0,
    mode: "channel",
    cwd: projectWithManifest(BLOCKED_MANIFEST.replace("blocked", "ok")),
  });
  assert.equal(plans.length, 1, "a healthy link must not raise a toast");
});

test("no manifest is silence, not a second toast", () => {
  // A green build with nothing on disk to describe. An extra "could not read
  // the manifest" would be noise about a file the customer never asked this
  // code to open.
  const { subscriber, plans } = activateAndCapture();
  subscriber({
    name: "Alp Build",
    code: 0,
    mode: "channel",
    cwd: projectWithManifest(),
  });
  assert.equal(plans.length, 1);
});

test("a FAILED build raises no IPC notice", () => {
  // The manifest on disk may be an earlier build's. The failure toast carries
  // what matters; adding a link's status would describe that earlier build.
  const { subscriber, plans } = activateAndCapture();
  subscriber({
    name: "Alp Build",
    code: 1,
    mode: "channel",
    cwd: projectWithManifest(BLOCKED_MANIFEST),
  });
  assert.equal(plans.length, 1);
  assert.match(plans[0].message, /failed/);
});

test("a flash never raises an IPC notice, even with a blocked manifest", () => {
  // Only `tan build` writes this file — `tan flash`/`image`/`renode` never do
  // and `tan clean` deletes it.
  const { subscriber, plans } = activateAndCapture();
  subscriber({
    name: "Alp Flash",
    code: 0,
    mode: "channel",
    cwd: projectWithManifest(BLOCKED_MANIFEST),
  });
  assert.equal(plans.length, 1);
});
