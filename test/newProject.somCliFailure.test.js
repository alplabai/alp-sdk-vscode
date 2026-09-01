// SPDX-License-Identifier: Apache-2.0
//
// `fetchSomModules` (`src/ideHub/newProjectFlowPanel.ts`) reads an EMPTY
// `soms` list two different ways: `tan presets` reporting
// `presets.sdk-root-unresolved` on an otherwise-successful envelope, or `tan
// presets` failing outright (unresolvable binary, non-zero exit). Before
// #611, only the first case toasted a warning — a genuine CLI failure fell
// through the SAME `soms.length === 0` branch silently and swapped in the
// static `E1M_MODULES` catalogue with nothing on screen saying the CLI, not
// the SDK, is why the Hardware list is generic.
//
// Driven through the real panel (the same `Module._load` swap
// `test/cancellation.sweep.test.js` uses), firing the wizard's own `"ready"`
// message and reading the `projectTemplatesData` post it produces.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

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

const STATIC_MODULES = [
  { id: "STATIC-SOM", displayName: "Static SoM", family: "other", cores: [] },
];

/** Open the real panel, stubbing `tan` so `presets` answers with
 *  `presetsOutcome` while `explain`/`examples` (fetchTemplates' own calls)
 *  answer with an inert, well-formed envelope that cannot itself fail. */
function driveReady(presetsOutcome) {
  const plans = [];
  const posted = [];
  const { NewProjectFlowPanel } = load("ideHub/newProjectFlowPanel", {
    vscode: {
      window: {
        createWebviewPanel: () => ({
          webview: {
            set html(_v) {},
            onDidReceiveMessage: (cb) => {
              onMessage = cb;
              return { dispose() {} };
            },
            postMessage: async (msg) => {
              posted.push(msg);
              return true;
            },
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
    // The cwd seam these four catalogue reads now resolve through (#605).
    // Stubbed rather than left real: the genuine one reads `vscode.workspace`,
    // which this harness does not build.
    "../project/vscodeAdapter": {
      readOnlyProjectCwd: () => "/home/dev/proj",
      collectProjectContext: () => ({ workspaceRoot: "/home/dev/proj" }),
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args) => {
        if (args[0] === "presets") return presetsOutcome;
        // `fetchTemplates`'s own `explain`/`examples` calls — inert so the
        // template half of `reloadCatalog` never itself fails or toasts.
        return { outcome: { envelope: { data: {}, issues: [] } } };
      },
    },
    "./messages": { PROTOCOL_VERSION: 1, emptyAlpIdeState: () => ({}) },
    "./projectScaffold": { E1M_MODULES: STATIC_MODULES },
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
    "../util": { log: () => {} },
  });

  let onMessage;
  NewProjectFlowPanel.open({
    extensionUri: "/ext",
    globalState: { get: () => null, update: async () => undefined },
  });
  return {
    fire: (msg) => onMessage(msg),
    plans,
    posted,
    onMessage: () => onMessage,
  };
}

/** Wait for the catalog post `reloadCatalog` produces — it is voided from
 *  `handleMessage`, so the test polls for the message rather than awaiting a
 *  promise nobody returns. */
async function untilCatalogPosted(posted) {
  for (let i = 0; i < 200; i += 1) {
    if (posted.some((m) => m.type === "projectTemplatesData")) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("an unresolved SDK (ok, but flagged) still warns and falls back", async () => {
  const drive = driveReady({
    outcome: {
      ok: true,
      envelope: {
        command: "presets",
        ok: true,
        exitCode: 0,
        data: { soms: [] },
        issues: [
          {
            code: "presets.sdk-root-unresolved",
            severity: "warning",
            message: "alp-sdk root is unresolved.",
          },
        ],
      },
    },
  });
  drive.fire({ type: "ready" });
  await untilCatalogPosted(drive.posted);

  const catalog = drive.posted.find((m) => m.type === "projectTemplatesData");
  assert.deepEqual(catalog.modules, STATIC_MODULES);
  assert.equal(
    drive.plans.length,
    1,
    "the known degraded-SDK case must still warn",
  );
});

test("a genuine CLI failure (not merely an unresolved SDK) also warns instead of falling back silently", async () => {
  const drive = driveReady({
    outcome: {
      ok: false,
      envelope: null,
      kind: "unknown",
      severity: "error",
      message: "Alp: the tan CLI could not be found.",
    },
  });
  drive.fire({ type: "ready" });
  await untilCatalogPosted(drive.posted);

  const catalog = drive.posted.find((m) => m.type === "projectTemplatesData");
  assert.deepEqual(
    catalog.modules,
    STATIC_MODULES,
    "the static catalogue is still the correct fallback",
  );
  assert.equal(
    drive.plans.length,
    1,
    "a genuine CLI failure must be reported — not conflated with the silent, " +
      "known-degraded 'no SDK resolved' case",
  );
});

test("an unresolved SDK carrying the code but NO message still warns — hasIssueCode, not unresolvedSdkReason", async () => {
  // Adversarial review (#611 follow-up): switching the boolean check from a
  // hand-rolled `.some(i => i.code === ...)` to `unresolvedSdkReason` quietly
  // added a non-empty-`message` precondition (`src/alpCli/service.ts`'s
  // `unresolvedSdkReason` skips any issue whose `message` is absent or `""`).
  // The `else if (!outcome.ok)` arm cannot catch this case either — `presets`
  // reports an unresolved SDK as `ok: true` — so a message-less issue used to
  // be reported NOWHERE at all. Latent at the pinned tan (it always sends a
  // message), but this pins the case directly rather than depending on that.
  const drive = driveReady({
    outcome: {
      ok: true,
      envelope: {
        command: "presets",
        ok: true,
        exitCode: 0,
        data: { soms: [] },
        issues: [
          {
            code: "presets.sdk-root-unresolved",
            severity: "warning",
            message: "",
          },
        ],
      },
    },
  });
  drive.fire({ type: "ready" });
  await untilCatalogPosted(drive.posted);

  const catalog = drive.posted.find((m) => m.type === "projectTemplatesData");
  assert.deepEqual(catalog.modules, STATIC_MODULES);
  assert.equal(
    drive.plans.length,
    1,
    "a message-less presets.sdk-root-unresolved issue must still warn — it " +
      "must not fall through to being reported nowhere",
  );
});
