// SPDX-License-Identifier: Apache-2.0
//
// `requestNewProjectPreview` end to end (#616), driven through the REAL panel
// (the same `Module._load` swap `test/newProject.somCliFailure.test.js` and
// `test/cancellation.sweep.test.js` use), not just the pure `planInitArgv`
// branch matrix (`test/wizard.initArgv.test.js`) or the narrower in isolation
// (`test/project.initPreview.test.js`).
//
// What THOSE two files cannot see: whether the panel actually sends
// `--preview` on the wire, whether a failed or unreadable `tan init --preview`
// answers `files: null` rather than an empty-looking `[]`, and whether that
// failure reaches the "Alp SDK" output channel without also blocking the
// wizard (preview is an aid, never a gate — see NewProjectPreviewDataMessage).

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

/** A minimal, well-formed `{ outcome }` for a call that succeeds. */
function stubbedEnvelope(data, issues = []) {
  return { outcome: { ok: true, envelope: { ok: true, data, issues } } };
}

/** Open the real panel. `initAnswer` is a function `(args) => outcome` for the
 *  ONE call under test — every other call (`explain`/`examples`/`presets`) is
 *  answered with a fixed, minimal catalogue so `"ready"` succeeds quietly. */
function openPanel(initAnswer) {
  const posted = [];
  const logs = [];
  const sentArgs = [];
  let onMessage;

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
    "../project/vscodeAdapter": {
      readOnlyProjectCwd: () => "/home/dev/proj",
      collectProjectContext: () => ({ workspaceRoot: "/home/dev/proj" }),
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args) => {
        sentArgs.push(args);
        if (args[0] === "explain" && !args.includes("--template")) {
          return stubbedEnvelope({ available: { projectTemplates: ["blinky"] } });
        }
        if (args[0] === "explain" && args.includes("--template")) {
          return stubbedEnvelope({
            summary: "Blinky",
            details: ["A minimal starter."],
          });
        }
        if (args[0] === "examples") {
          return stubbedEnvelope({ examples: [] });
        }
        if (args[0] === "presets") {
          return stubbedEnvelope({
            soms: [
              {
                sku: "E1M-AEN801",
                displayName: "E1M-AEN801",
                family: "alif-ensemble",
                cores: [{ id: "m55_hp", os: "zephyr" }],
              },
            ],
          });
        }
        if (args[0] === "init") {
          return initAnswer(args);
        }
        throw new Error(`unscripted tan call: ${args.join(" ")}`);
      },
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
      notifyAsync: () => undefined,
    },
    "../util": {
      log: (line) => logs.push(line),
      showOutput: () => {},
    },
  });

  NewProjectFlowPanel.open({
    extensionUri: "/ext",
    globalState: { get: () => null, update: async () => undefined },
  });
  return { fire: (msg) => onMessage(msg), posted, logs, sentArgs };
}

/** Poll for a posted message of the given type — `handleMessage` is voided
 *  from `onDidReceiveMessage`, so nothing here returns a promise to await. */
async function untilPosted(posted, type) {
  for (let i = 0; i < 200; i += 1) {
    const found = posted.find((m) => m.type === type);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`no "${type}" message posted within the poll window`);
}

const REQUEST = {
  type: "requestNewProjectPreview",
  templateId: "blinky",
  moduleId: "E1M-AEN801",
  projectName: "my-project",
  destination: "/Users/dev/Alp Projects",
};

test("a successful tan init --preview reports its file list, and sends --preview on the wire", async () => {
  const drive = openPanel(() =>
    stubbedEnvelope({
      preview: true,
      written: [],
      sdkPinned: null,
      fileChanges: [
        { relativePath: "board.yaml", kind: "new" },
        { relativePath: "src/main.c", kind: "new" },
      ],
    }),
  );

  drive.fire({ type: "ready" });
  await untilPosted(drive.posted, "projectTemplatesData");
  drive.fire(REQUEST);
  const preview = await untilPosted(drive.posted, "newProjectPreviewData");

  assert.deepEqual(preview.files, [
    { relativePath: "board.yaml", kind: "new" },
    { relativePath: "src/main.c", kind: "new" },
  ]);

  const initCall = drive.sentArgs.find((a) => a[0] === "init");
  assert.ok(initCall.includes("--preview"), "the preview pass must send --preview");
  assert.ok(
    initCall.includes(REQUEST.destination),
    "the preview must resolve into the SAME destination Create would use",
  );
});

test("a refused tan init --preview answers files: null — never an empty list read as 'nothing to create'", async () => {
  const drive = openPanel(() => ({
    outcome: {
      ok: false,
      envelope: {
        ok: false,
        exitCode: 2,
        data: {},
        issues: [
          {
            code: "init.som-unsupported",
            severity: "error",
            message: "no vendored scaffold for this SoM",
          },
        ],
      },
      severity: "error",
      message: "Alp: tan init failed.",
    },
  }));

  drive.fire({ type: "ready" });
  await untilPosted(drive.posted, "projectTemplatesData");
  drive.fire(REQUEST);
  const preview = await untilPosted(drive.posted, "newProjectPreviewData");

  assert.equal(
    preview.files,
    null,
    "a refused preview must answer null, not [] — [] would render as " +
      '"this creates nothing" for a project the customer never gets a real ' +
      "chance to see the files of",
  );
});

test("an ok:true envelope whose data does not narrow (no fileChanges[]) also answers null, and is logged", async () => {
  const drive = openPanel(() =>
    stubbedEnvelope({ preview: true, written: [] }), // no `fileChanges` at all
  );

  drive.fire({ type: "ready" });
  await untilPosted(drive.posted, "projectTemplatesData");
  drive.fire(REQUEST);
  const preview = await untilPosted(drive.posted, "newProjectPreviewData");

  assert.equal(
    preview.files,
    null,
    "`ok: true` with an unreadable payload is NOT a preview of zero files " +
      "(the `written ?? []` failure, #611/#517) — it must still be `null`",
  );
  assert.ok(
    drive.logs.some((l) => l.includes("did not narrow")),
    "the unreadable payload must reach the 'Alp SDK' output channel, not be swallowed",
  );
});

test("issues on a SUCCESSFUL preview still reach the output channel", async () => {
  const drive = openPanel(() =>
    stubbedEnvelope(
      { fileChanges: [{ relativePath: "board.yaml", kind: "new" }] },
      [{ code: "init.notice", severity: "info", message: "heads up" }],
    ),
  );

  drive.fire({ type: "ready" });
  await untilPosted(drive.posted, "projectTemplatesData");
  drive.fire(REQUEST);
  await untilPosted(drive.posted, "newProjectPreviewData");

  assert.ok(
    drive.logs.some((l) => l.includes("info: heads up")),
    "issues[] must reach the channel on every outcome, including ok:true",
  );
});
