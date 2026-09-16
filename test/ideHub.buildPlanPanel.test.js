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
 * (#484 Task 7 fix round 1) reads `.boardYamlPath` off that same stub,
 * separately from `.workspaceRoot`:
 *
 *  - `workspaceRoot` defaults to the fixed root every pre-existing test
 *    relies on; pass `null` for no workspace folder open at all.
 *  - `boardYamlPath` defaults to the plain join every pre-existing test
 *    assumed too; pass an explicit value to simulate a custom/absolute
 *    `alpSdk.boardYamlPath` or a multi-root layout where it does not sit
 *    under `workspaceRoot` at all — see the `openBoardYaml` tests below.
 *  - `showTextDocument` defaults to a stub that records into `opened` and
 *    resolves; pass a rejecting one to exercise the "file could not be
 *    opened" failure path (finding 2).
 */
function mountPanel({
  workspaceRoot = "/home/dev/proj",
  boardYamlPath = workspaceRoot ? path.join(workspaceRoot, "board.yaml") : null,
  showTextDocument: showTextDocumentOverride = null,
} = {}) {
  const calls = [];
  const posted = [];
  // #484 Task 7: what `openWorkspaceFile`/`openBoardYaml`/`copyText`
  // actually did, captured the same way `calls`/`posted` capture everything
  // else this panel does — never inferred from an unchanged count (see the
  // tests below for why).
  const opened = [];
  const logs = [];
  const clipboard = [];
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
        // #484 Task 7: `openWorkspaceFile`/`openBoardYaml` call this
        // directly with a `Uri` (never `openTextDocument` first) — mirrors
        // the brief's own sketch.
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
        clipboard: {
          writeText: async (text) => {
            clipboard.push(text);
          },
        },
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
    "../notify/vscodeAdapter": { notifyAsync() {} },
    // #607: the panel's readers now resolve `cwd` through
    // `collectProjectContext()`, not `workspaceFolders[0]` directly. The real
    // resolver needs `vscode.workspace.getConfiguration`, absent from this
    // file's `vscode` stub, so it is stubbed here directly — `workspaceRoot:
    // null` when the test wants no workspace folder open at all,
    // `boardYamlPath` independently overridable for #484 Task 7's
    // `openBoardYaml` (fix round 1, finding 1: NOT re-derived from
    // `workspaceRoot` by the handler under test, so this stub must not
    // silently keep them coupled either).
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot, boardYamlPath }),
    },
    "../util": {
      BUILD_RUN_NAME: "build",
      FLASH_RUN_NAME: "flash",
      isStreamedRunActive: () => false,
      releaseStreamedRun: () => {},
      reserveStreamedRun: () => true,
      // #484 Task 7: `openWorkspaceFile`/`openBoardYaml` log every refusal
      // AND every open failure — captured here so both are POSITIVE,
      // checkable facts, not an inference from a count that merely did not
      // move.
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
    requestBuildPlan: () => onMessage({ type: "requestBuildPlan" }),
    fileChanged: () => watcherHandlers.forEach((handler) => handler()),
    openWorkspaceFile: (relativePath) =>
      onMessage({ type: "openWorkspaceFile", path: relativePath }),
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

// ── #484 Task 7: `openWorkspaceFile` / `copyText` ───────────────────────────
//
// This is the only place on this branch where a string the WEBVIEW supplies
// reaches the filesystem, so the containment check is tested past the
// obvious `../..` case. Every refusal below is asserted through `opened`
// staying put AND `logs` gaining a specific, matching entry — never through
// `opened.length` alone, which would pass identically whether the handler
// refused on purpose or merely threw for an unrelated reason (an unknown
// message type, a typo in a property name) before ever reaching the
// containment check.
const WORKSPACE_ROOT = "/home/dev/proj";

test("openWorkspaceFile opens a path inside the workspace", async () => {
  const { opened, logs, openWorkspaceFile } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
  });
  openWorkspaceFile("board.yaml");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, [path.join(WORKSPACE_ROOT, "board.yaml")]);
  assert.deepEqual(logs, [], "a successful open must not also log a refusal");
});

test("openWorkspaceFile refuses a classic ../.. traversal", async () => {
  const { opened, logs, openWorkspaceFile } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
  });
  openWorkspaceFile("../../etc/passwd");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, [], "nothing must open");
  assert.equal(logs.length, 1, "the refusal must be logged, not silent");
  assert.match(logs[0], /refused/);
  assert.match(logs[0], /outside the workspace root/);
});

test("openWorkspaceFile refuses an absolute path, which discards the workspace root outright", async () => {
  // `path.resolve(root, "/etc/passwd")` returns `/etc/passwd` — the root is
  // discarded whenever the second argument is itself absolute — so a check
  // that only looks for ".." in the raw input would never see this one.
  const { opened, logs, openWorkspaceFile } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
  });
  openWorkspaceFile("/etc/passwd");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /refused/);
  assert.match(logs[0], /outside the workspace root/);
});

test("openWorkspaceFile refuses a sibling directory that merely shares the root as a string prefix", async () => {
  // Built FROM the mounted root, so it is real: `${WORKSPACE_ROOT}-evil/x`
  // resolves to a directory that sits next to the workspace, not inside it.
  // `resolved.startsWith(root)` — the naive fix for the absolute-path hole
  // above — is TRUE for this path, because "/home/dev/proj-evil/x" really
  // does start with the literal string "/home/dev/proj". The mutation test
  // in this task's report reproduces exactly that swap and shows this case
  // then passes.
  const sibling = `${WORKSPACE_ROOT}-evil/x`;
  const { opened, logs, openWorkspaceFile } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
  });
  openWorkspaceFile(sibling);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /refused/);
  assert.match(logs[0], /outside the workspace root/);
});

test("openWorkspaceFile refuses everything when no workspace folder is open, without throwing", async () => {
  const { opened, logs, openWorkspaceFile } = mountPanel({
    workspaceRoot: null,
  });
  assert.doesNotThrow(() => openWorkspaceFile("board.yaml"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /refused/);
  assert.match(logs[0], /no workspace folder is open/);
});

test("copyText writes the given string to the clipboard", async () => {
  const { clipboard, copyText } = mountPanel({ workspaceRoot: WORKSPACE_ROOT });
  copyText("alp_default_rpmsg — carve-out — some reason");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(clipboard, ["alp_default_rpmsg — carve-out — some reason"]);
});

// ── #484 Task 7 fix round 1, finding 1: `openBoardYaml` ─────────────────────
//
// The file opened is `collectProjectContext().boardYamlPath`, resolved by
// the HOST, never a webview string and never re-derived here as
// `path.join(workspaceRoot, "board.yaml")` — that join gets a custom or
// absolute `alpSdk.boardYamlPath`, and a multi-root workspace where
// board.yaml is not under `workspaceFolders[0]`, silently wrong. Each test
// below sets `boardYamlPath` independently of `workspaceRoot` in the stub —
// exactly the coupling a hardcoded join would have assumed.

test("openBoardYaml opens a custom, relative alpSdk.boardYamlPath", async () => {
  // As if `alpSdk.boardYamlPath` were configured to "config/board.yaml":
  // resolved relative to the workspace root, but not the plain
  // "<root>/board.yaml" a hardcoded literal would have joined.
  const { opened, logs, openBoardYaml } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
    boardYamlPath: path.join(WORKSPACE_ROOT, "config", "board.yaml"),
  });
  openBoardYaml();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, [path.join(WORKSPACE_ROOT, "config", "board.yaml")]);
  assert.deepEqual(logs, []);
});

test("openBoardYaml opens an absolute alpSdk.boardYamlPath OUTSIDE the workspace root, unrefused", async () => {
  // The critical case: this path does NOT resolve under WORKSPACE_ROOT at
  // all — exactly what a legitimately configured absolute
  // `alpSdk.boardYamlPath` can be. If this went through
  // `openWorkspaceFile`'s webview-string containment check, it would be
  // refused as "outside the workspace root"; `openBoardYaml` must open it
  // anyway, because a HOST-resolved path is not a webview-supplied string.
  const outsideRoot = "/opt/shared-boards/e1m.board.yaml";
  const { opened, logs, openBoardYaml } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
    boardYamlPath: outsideRoot,
  });
  openBoardYaml();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, [outsideRoot], "must open it, not refuse it");
  assert.deepEqual(logs, []);
});

test("openBoardYaml opens the board.yaml of a multi-root workspace, even though it is not under workspaceFolders[0]", async () => {
  // `resolveWorkspaceRoot` (@alp-sdk/core/project/service) already picks
  // whichever folder actually holds the configured board.yaml as its
  // `workspaceRoot` answer — so a naive `workspaceFolders[0]` (here, a
  // sibling "docs" folder with no board.yaml at all) is never even the
  // `workspaceRoot` this stub reports. What this test pins is narrower and
  // still real: `openBoardYaml` must use `boardYamlPath` VERBATIM, never
  // recompute it from `workspaceRoot` — the two are independently set here,
  // the same way a real multi-root resolution can hand back a
  // `workspaceRoot` whose OWN literal "board.yaml" join would still be
  // right, while a stale local re-derivation elsewhere in this file would
  // not be.
  const multiRootWorkspaceRoot = "/home/dev/ws/pkg-b";
  const { opened, logs, openBoardYaml } = mountPanel({
    workspaceRoot: multiRootWorkspaceRoot,
    boardYamlPath: path.join(multiRootWorkspaceRoot, "board.yaml"),
  });
  openBoardYaml();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, [path.join(multiRootWorkspaceRoot, "board.yaml")]);
  assert.deepEqual(logs, []);
});

test("openBoardYaml refuses (and logs) when no board.yaml is resolved, without throwing", async () => {
  const { opened, logs, openBoardYaml } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
    boardYamlPath: null,
  });
  assert.doesNotThrow(() => openBoardYaml());
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /no board\.yaml resolved/);
});

// ── #484 Task 7 fix round 1, finding 2: a rejected `showTextDocument` is
//    observable, not a silent dead button ──────────────────────────────────

test("openWorkspaceFile logs when the file cannot actually be opened (e.g. it does not exist)", async () => {
  const rejection = new Error("ENOENT: no such file or directory");
  const { opened, logs, openWorkspaceFile } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
    showTextDocument: () => Promise.reject(rejection),
  });
  openWorkspaceFile("board.yaml");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    opened,
    [],
    "the failing stub never records a successful open",
  );
  assert.equal(
    logs.length,
    1,
    "a rejected showTextDocument must be logged, not an unhandled rejection " +
      "with a dead button and nothing on screen",
  );
  assert.match(logs[0], /could not open/);
  assert.match(
    logs[0],
    new RegExp(rejection.message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

test("openBoardYaml logs when the file cannot actually be opened", async () => {
  const rejection = new Error("ENOENT: no such file or directory");
  const boardYamlPath = path.join(WORKSPACE_ROOT, "board.yaml");
  const { opened, logs, openBoardYaml } = mountPanel({
    workspaceRoot: WORKSPACE_ROOT,
    boardYamlPath,
    showTextDocument: () => Promise.reject(rejection),
  });
  openBoardYaml();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(opened, []);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /could not open/);
  assert.match(
    logs[0],
    new RegExp(rejection.message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});
