// SPDX-License-Identifier: Apache-2.0
//
// `BuildPlanPanel` (src/ideHub/buildPlanPanel.ts) serves its refresh from TWO
// triggers that must not be treated alike: the webview's own
// `requestBuildPlan` message (posted on mount — the user just opened "Alp:
// Build Plan") and the constructor's board.yaml/system-manifest.yaml file
// watcher (a file save, nobody's direct ask). Only the first may let a
// from-scratch tan CLI download show ADR 0021's consent dialog.
//
// THE CALL THAT CARRIES THAT DISTINCTION IS `tan size` NOW, not `build
// --plan`. `--plan`, `--manifest` and `--manifest-from` are all deferred at
// the pin (tan-cli#427) and the panel no longer spawns for any of them (#541),
// so `size` is the only handler here with an `interactive` flag to get wrong.
// The two consent tests below therefore drive the post-build path — a
// workspace folder and an existing `build/system-manifest.yaml` — because
// `handleRequestSliceSizes` returns early with `report: null` and spawns
// NOTHING when there is no manifest on disk, and a consent assertion over zero
// spawns asserts nothing at all.
//
// The third test is the other half of #541: the watcher must fire no doomed
// call, and the panel must still SAY that the plan is unavailable and name the
// upstream issue.

const test = require("node:test");
const MANIFEST_YAML = [
  "schema_version: 1",
  "generated_by: tan 0.6.0",
  "hw_info:",
  "  sku: E1M-AEN801",
  "slices:",
  "  - core_id: m55_hp",
  "    os: zephyr",
  "    status: ok",
  "ipc: []",
  "helper_mcus: []",
  "boot_order: []",
].join("\n");

const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

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
 * Mount the REAL `BuildPlanPanel` over a fake webview panel and fake file
 * watchers, with `../alpCli/vscodeAdapter` replaced so every `runAlpCommand`
 * call (and the `interactive` option it was given) is captured. Returns
 * handles to drive it: `requestBuildPlan()` (the webview message) and
 * `fileChanged()` (the board.yaml/system-manifest.yaml watcher firing).
 *
 * Every field is independently overridable, since `collectProjectContext()`
 * is stubbed directly (never the real resolver) and `openBoardYaml`
 * (#484) reads `.boardYamlPath` off that same stub,
 * separately from `.workspaceRoot`:
 *
 *  - `workspaceRoot` defaults to the fixed root every pre-existing test
 *    relies on; pass `null` for no workspace folder open at all.
 *  - `boardYamlPath` defaults to the plain join every pre-existing test
 *    assumed too; pass an explicit value to simulate a custom/absolute
 *    `alpSdk.boardYamlPath` — see the `openBoardYaml` tests below. (A GENUINE
 *    multi-root resolution — which folder `resolveWorkspaceRoot` picks when
 *    board.yaml is not under `workspaceFolders[0]` — is proven against the
 *    real resolver in `test/project.service.test.js`; this file stubs
 *    `collectProjectContext()` wholesale and so cannot re-prove that, only
 *    that `openBoardYaml` trusts whatever `boardYamlPath` it is handed.)
 *  - `showTextDocument` defaults to a stub that records into `opened` and
 *    resolves; pass a rejecting one to exercise the "file could not be
 *    opened" failure path.
 *  - `clipboardWriteText` defaults to a stub that records into `clipboard`
 *    and resolves; pass a rejecting one to exercise the "clipboard write
 *    refused" failure path. `vscode.env.clipboard.writeText` returns a real
 *    promise that really does reject (no focus, a remote or web host, another
 *    process holding the OS clipboard), so this override is the only way to
 *    reach that branch.
 */
function mountPanel({
  workspaceRoot = "/home/dev/proj",
  boardYamlPath = workspaceRoot ? path.join(workspaceRoot, "board.yaml") : null,
  showTextDocument: showTextDocumentOverride = null,
  clipboardWriteText: clipboardWriteTextOverride = null,
} = {}) {
  const calls = [];
  const posted = [];
  // #484: what `openBoardYaml`/`copyText` actually did, captured the
  // same way `calls`/`posted` capture everything else this panel does —
  // never inferred from an unchanged count (see the tests below for why).
  const opened = [];
  const logs = [];
  const clipboard = [];
  // #484: every plan `notifyAsync` was handed —
  // the user-visible half. A raw `log()` call alone reaches only the "Alp
  // SDK" output channel, which nothing surfaces on its own; this is what
  // proves a failure also reaches the toast/status-bar layer a customer
  // actually sees.
  const notifications = [];
  let onMessage = () => {};
  const watcherHandlers = [];
  const panel = {
    webview: {
      html: "",
      onDidReceiveMessage(handler) {
        onMessage = handler;
        return { dispose() {} };
      },
      postMessage(msg) {
        posted.push(msg);
        return Promise.resolve(true);
      },
    },
    reveal() {},
    onDidDispose() {
      return { dispose() {} };
    },
  };

  // The default success stub is built HERE, inside the function body, not as
  // a parameter default — a parameter default's closure cannot see `opened`
  // (declared above, in the body), only sibling parameters and the outer
  // module scope.
  const showTextDocumentStub =
    showTextDocumentOverride ??
    ((uri) => {
      opened.push(uri.fsPath);
      return Promise.resolve({});
    });

  // Same reason as `showTextDocumentStub` above: a parameter default cannot
  // close over `clipboard`, which is declared in this body.
  const clipboardWriteTextStub =
    clipboardWriteTextOverride ??
    ((text) => {
      clipboard.push(text);
      return Promise.resolve();
    });

  const { BuildPlanPanel } = loadWithStubs("ideHub/buildPlanPanel.js", {
    // A manifest on disk, so the one remaining spawn (`tan size`) actually
    // runs — see this file's header.
    fs: {
      existsSync: () => true,
      statSync: () => ({ mtimeMs: 0 }),
      // #580: the panel reads the manifest now rather than posting `manifest:
      // null`, so the stub has to be able to answer.
      readFileSync: () => MANIFEST_YAML,
    },
    vscode: {
      window: {
        createWebviewPanel: () => panel,
        workspaceFolders: workspaceRoot
          ? [{ uri: { fsPath: workspaceRoot } }]
          : undefined,
        // #484: `openBoardYaml` calls this directly with a `Uri`.
        showTextDocument: showTextDocumentStub,
      },
      workspace: {
        get workspaceFolders() {
          return workspaceRoot
            ? [{ uri: { fsPath: workspaceRoot } }]
            : undefined;
        },
        createFileSystemWatcher: () => ({
          onDidChange(handler) {
            watcherHandlers.push(handler);
            return { dispose() {} };
          },
          onDidCreate() {
            return { dispose() {} };
          },
          onDidDelete() {
            return { dispose() {} };
          },
        }),
      },
      ViewColumn: { Active: 1 },
      Uri: {
        joinPath: () => ({}),
        parse: (value) => value,
        file: (fsPath) => ({ fsPath }),
      },
      env: {
        openExternal: async () => true,
        clipboard: { writeText: clipboardWriteTextStub },
      },
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_context, args, cwd, options) => {
        calls.push({ args, options });
        return { outcome: { ok: true, envelope: null, message: "" } };
      },
      runAlpStreamed: async () => {},
    },
    "./webviewHtml": { buildWebviewHtml: () => "<html></html>" },
    // #484: a capturing stub, not a no-op — see
    // `notifications` above.
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => notifications.push(plan),
    },
    // #607: the panel's readers now resolve `cwd` through
    // `collectProjectContext()`, not `workspaceFolders[0]` directly. The real
    // resolver needs `vscode.workspace.getConfiguration`, absent from this
    // file's `vscode` stub, so it is stubbed here directly — `workspaceRoot:
    // null` when the test wants no workspace folder open at all,
    // `boardYamlPath` independently overridable for #484's `openBoardYaml`
    // (NOT re-derived from `workspaceRoot` by the handler under test, so
    // this stub must not silently keep them coupled either).
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot, boardYamlPath }),
    },
    "../util": {
      BUILD_RUN_NAME: "build",
      FLASH_RUN_NAME: "flash",
      isStreamedRunActive: () => false,
      releaseStreamedRun: () => {},
      reserveStreamedRun: () => true,
      log: (message) => logs.push(message),
    },
  });

  BuildPlanPanel.open({ extensionUri: {} });

  return {
    calls,
    posted,
    opened,
    logs,
    clipboard,
    notifications,
    requestBuildPlan: () => onMessage({ type: "requestBuildPlan" }),
    fileChanged: () => watcherHandlers.forEach((handler) => handler()),
    openBoardYaml: () => onMessage({ type: "openBoardYaml" }),
    copyText: (text) => onMessage({ type: "copyText", text }),
  };
}

test("BuildPlanPanel: the webview's requestBuildPlan (panel open) DOES ask tan CLI download consent", async () => {
  const { calls, requestBuildPlan } = mountPanel();
  requestBuildPlan();
  await new Promise((resolve) => setImmediate(resolve));

  const sizeCalls = calls.filter((c) => c.args[0] === "size");
  assert.ok(sizeCalls.length > 0, "requestBuildPlan must run `tan size`");
  for (const call of sizeCalls) {
    assert.equal(
      call.options?.interactive,
      true,
      "the webview posts requestBuildPlan on mount — i.e. the user just opened " +
        "the panel — so this must be interactive, or an unanswered consent " +
        "setting silently paints nothing",
    );
  }
});

test("BuildPlanPanel: a board.yaml/system-manifest.yaml watcher refresh never asks consent", async () => {
  const { calls, fileChanged } = mountPanel();
  fileChanged();
  await new Promise((resolve) => setImmediate(resolve));

  const sizeCalls = calls.filter((c) => c.args[0] === "size");
  assert.ok(
    sizeCalls.length > 0,
    "the watcher must still refresh the slice sizes — a build changes them, " +
      "and `tan size` is a live command at this pin",
  );
  for (const call of sizeCalls) {
    assert.notEqual(
      call.options?.interactive,
      true,
      "a file save is not a direct user ask — an interactive resolution here " +
        "would pop ADR 0021's consent modal out of a board.yaml save",
    );
  }
});

test("BuildPlanPanel: no trigger spawns a deferred `tan build` flag, and the panel says why", async () => {
  // #541. `--plan`, `--manifest` and `--manifest-from` all PARSE, so the old
  // calls exited without a usage error and the failure arrived three layers
  // from its cause. Both triggers are checked: the watcher one is the worse of
  // the two, because it fired two doomed subprocesses on every board.yaml save.
  const { calls, posted, requestBuildPlan, fileChanged } = mountPanel();
  requestBuildPlan();
  fileChanged();
  await new Promise((resolve) => setImmediate(resolve));

  for (const flag of ["--plan", "--manifest", "--manifest-from"]) {
    assert.deepEqual(
      calls.filter((c) => c.args.includes(flag)),
      [],
      `\`tan build ${flag}\` is deferred at this pin (tan-cli#427) — spawning ` +
        "it spends a process to learn what the pin already determines",
    );
  }

  // The user-facing half, which must NOT regress: before this, the CLI's own
  // `cli.command-deferred` message reached the view and named tan-cli#427.
  const plan = posted.find((m) => m.type === "buildPlanData");
  assert.ok(plan, "the panel must still post a buildPlanData");
  assert.equal(plan.plan, null);
  assert.match(plan.error, /--plan/);
  assert.match(plan.error, /tan-cli#427/);
  assert.match(plan.error, /issues\/427/, "with the URL tan itself printed");

  assert.match(
    plan.error,
    /retired/,
    "tan-cli#427 closed by RETIRING `--plan`. The message must not still " +
      "read as a wait — the flag is not on its way.",
  );

  // #580: the manifest is READ now. `--manifest-from` was retired in favour of
  // reading `build/system-manifest.yaml`, which needs no CLI at all — two
  // other sites in this repo (`src/debug.ts`, `src/flash/gate.ts`) had been
  // doing exactly that the whole time while this panel waited.
  const manifest = posted.find((m) => m.type === "systemManifestData");
  assert.ok(manifest, "and a systemManifestData");
  assert.ok(
    manifest.manifest,
    "the panel posted no manifest even though one is on disk and parses — " +
      "the renderer in BuildPlanView.tsx has been correct and unreachable " +
      "since it was written",
  );
  assert.equal(manifest.manifest.hw_info.sku, "E1M-AEN801");
  assert.equal(
    manifest.error,
    undefined,
    "a manifest that parsed is not an error state",
  );
  assert.equal(
    manifest.postBuild,
    true,
    "the on-disk facts are still posted, and they matter MORE now than when " +
      "nothing was rendered: they are what dates the manifest on screen",
  );
});

const WORKSPACE_ROOT = "/home/dev/proj";

test("copyText writes the given string to the clipboard", async () => {
  const { clipboard, copyText } = mountPanel({ workspaceRoot: WORKSPACE_ROOT });
  copyText("alp_default_rpmsg — carve-out — some reason");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(clipboard, ["alp_default_rpmsg — carve-out — some reason"]);
});

// ── #484: `openBoardYaml` ───────────────────────────────────────────────────
//
// The file opened is `collectProjectContext().boardYamlPath`, resolved by
// the HOST, never re-derived here as `path.join(workspaceRoot,
// "board.yaml")` — that join gets a custom or absolute `alpSdk.boardYamlPath`
// silently wrong. Each test below sets `boardYamlPath` independently of
// `workspaceRoot` in the stub — exactly the coupling a hardcoded join would
// have assumed.
//
// #484: `openBoardYaml` is now the ONLY way any
// string reaches the filesystem from this panel at all, and it takes no
// webview input whatsoever — `OpenBoardYamlMessage` carries no `path` field.
// The sibling `openWorkspaceFile` handler (a webview-supplied,
// containment-checked relative path) was deleted outright: it had no
// product caller, and its own tests are deleted with it. See the commit
// message for the two containment traps its removal costs — an
// absolute path discarding `path.resolve`'s root argument, and a bare
// `startsWith` accepting a sibling directory — recorded there so the
// knowledge survives for whoever adds a real webview-named-path control
// later.

test("openBoardYaml opens a custom, relative alpSdk.boardYamlPath", async () => {
  // As if `alpSdk.boardYamlPath` were configured to "config/board.yaml":
  // resolved relative to the workspace root, but not the plain
  // "<root>/board.yaml" a hardcoded literal would have joined.
  const { opened, notifications, openBoardYaml } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
    boardYamlPath: path.join(WORKSPACE_ROOT, "config", "board.yaml"),
  });
  openBoardYaml();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, [path.join(WORKSPACE_ROOT, "config", "board.yaml")]);
  assert.deepEqual(
    notifications,
    [],
    "a successful open must not also raise a notification",
  );
});

test("openBoardYaml opens an absolute alpSdk.boardYamlPath OUTSIDE the workspace root, unrefused", async () => {
  // The critical case: this path does NOT resolve under WORKSPACE_ROOT at
  // all — exactly what a legitimately configured absolute
  // `alpSdk.boardYamlPath` can be. `openBoardYaml` takes no webview input at
  // all and so has no containment check to run this past in the first
  // place — it opens whatever the host itself resolved.
  const outsideRoot = "/opt/shared-boards/e1m.board.yaml";
  const { opened, notifications, openBoardYaml } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
    boardYamlPath: outsideRoot,
  });
  openBoardYaml();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, [outsideRoot], "must open it, not refuse it");
  assert.deepEqual(notifications, []);
});

test("openBoardYaml trusts boardYamlPath verbatim, never re-deriving it from workspaceRoot", async () => {
  // #484: this test used to be titled as a
  // "multi-root workspace" case, but it never exercised multi-root
  // RESOLUTION — `collectProjectContext()` is stubbed wholesale here, so
  // `resolveWorkspaceRoot`'s real folder-picking logic (which folder
  // actually holds board.yaml when it is not `workspaceFolders[0]`) never
  // runs. That real resolution is proven against the real resolver in
  // `test/project.service.test.js` ("resolveProjectContext picks the active
  // board.yaml root over workspaceFolders[0] in a multi-root workspace").
  // What THIS test actually pins, honestly: `openBoardYaml` opens
  // `boardYamlPath` exactly as given, never recomputing
  // `path.join(workspaceRoot, "board.yaml")` from `workspaceRoot` alone —
  // the mutation in this task's report (regressing to that join) is what
  // kills this test, not a multi-root claim it never tested.
  const someWorkspaceRoot = "/home/dev/ws/pkg-b";
  const { opened, notifications, openBoardYaml } = mountPanel({
    workspaceRoot: someWorkspaceRoot,
    boardYamlPath: path.join(someWorkspaceRoot, "config", "board.yaml"),
  });
  openBoardYaml();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    opened,
    [path.join(someWorkspaceRoot, "config", "board.yaml")],
    "must be boardYamlPath verbatim — a re-derived " +
      'path.join(workspaceRoot, "board.yaml") would open ' +
      `${path.join(someWorkspaceRoot, "board.yaml")} instead`,
  );
  assert.deepEqual(notifications, []);
});

// ── #484: every failure path is USER-VISIBLE ────────────────────────────────
//
// A raw `log()` call alone reaches only the "Alp SDK" output channel, which
// nothing surfaces on its own — and a bare `void` on a rejecting promise
// reaches nothing at all: the button did nothing, silently. All three paths
// below go through `notifyAsync`, the same mechanism every other
// user-facing failure in `buildPlanPanel.ts` uses.

test("openBoardYaml notifies (not just logs) when no board.yaml is resolved, without throwing", async () => {
  const { opened, notifications, openBoardYaml } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
    boardYamlPath: null,
  });
  assert.doesNotThrow(() => openBoardYaml());
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, []);
  assert.equal(
    notifications.length,
    1,
    "no board.yaml resolved must raise exactly one user-visible notification",
  );
  // `planPrecondition("noBoardYaml")` — the SAME toast every other
  // no-board.yaml surface in this extension already shows, reused rather
  // than inventing new copy. Always "warning": a project with no board.yaml
  // yet is a first-run state, not a fault.
  assert.equal(notifications[0].message, "No board.yaml in this folder yet.");
  assert.equal(notifications[0].severity, "warning");
});

test("openBoardYaml notifies when the file cannot actually be opened", async () => {
  const rejection = new Error("ENOENT: no such file or directory");
  const boardYamlPath = path.join(WORKSPACE_ROOT, "board.yaml");
  const { opened, notifications, openBoardYaml } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
    boardYamlPath,
    showTextDocument: () => Promise.reject(rejection),
  });
  openBoardYaml();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    opened,
    [],
    "the failing stub never records a successful open",
  );
  assert.equal(
    notifications.length,
    1,
    "a rejected showTextDocument must raise exactly one user-visible " +
      "notification, not an unhandled rejection with a dead button and " +
      "nothing on screen",
  );
  const plan = notifications[0];
  // `planFailure`'s own backstop demotes a `cause` carrying an errno (this
  // one: "ENOENT") out of the customer-facing message and into `detail` —
  // asserted here, not assumed, so a future edit that stops using
  // `planFailure` (and starts interpolating the raw error straight into the
  // toast) is caught.
  assert.equal(plan.message, "Opening board.yaml failed.");
  assert.match(plan.detail ?? "", /ENOENT/);
  assert.equal(plan.severity, "error");
});

test("copyText notifies when the clipboard write is refused", async () => {
  // The twin of the test above, on the OTHER handler added alongside it.
  // `writeText` returned a promise nobody awaited and nobody caught, so a
  // refusal — no window focus, a remote or web host without clipboard
  // permission, another process holding the OS clipboard — became an
  // unhandled rejection in the extension host and the Copy button on a
  // blocked finding just did nothing.
  const rejection = new Error("EBUSY: the clipboard is held by another app");
  const { clipboard, notifications, copyText } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
    clipboardWriteText: () => Promise.reject(rejection),
  });
  assert.doesNotThrow(() => copyText("alp_default_rpmsg — carve-out"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    clipboard,
    [],
    "the failing stub never records a successful write",
  );
  assert.equal(
    notifications.length,
    1,
    "a rejected clipboard.writeText must raise exactly one user-visible " +
      "notification, not an unhandled rejection with a dead button and " +
      "nothing on screen",
  );
  const plan = notifications[0];
  // Asserted, not assumed, for the same reason as the sibling above:
  // `planFailure`'s backstop demotes an errno-carrying `cause` out of the
  // customer-facing message and into `detail`, and an edit that stops going
  // through `planFailure` would interpolate the raw error into the toast.
  assert.equal(plan.message, "Copying to the clipboard failed.");
  assert.match(plan.detail ?? "", /EBUSY/);
  assert.equal(plan.severity, "error");
});
