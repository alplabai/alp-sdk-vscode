// SPDX-License-Identifier: Apache-2.0
//
// The tan payloads the build-plan panel reads through an `as` cast, and the
// runtime check that stands between a renamed tan field and a panel that either
// crashes mid-render or drops a column without saying so.
//
// The predicate is pure and tested directly; the CALL SITE is tested through
// the compiled panel with `vscode` and the CLI adapter stubbed, because a pure
// test cannot notice a call site that was never wired (or was later deleted).
// Delete `checkTanPayload(...)` from `src/ideHub/buildPlanPanel.ts` and the
// "names the command" test below goes red.
//
// ONE CALL SITE, NOT THREE, SINCE #541 — and the loss is real, so it is stated
// rather than quietly absorbed. `build --plan` and `build --manifest*` are
// DEFERRED at the pin (tan-cli#427): they parse, they do nothing, and the panel
// no longer spawns them, so no payload of either shape can arrive and there is
// nothing left for a call-site test to drive. `BUILD_PLAN_SHAPE` and
// `SYSTEM_MANIFEST_SHAPE` are still defined, still exported and still tested
// PURELY below — what is gone is the end-to-end proof that the panel routes a
// bad payload of those two shapes into an error rather than a crash. That proof
// comes back with the spawns, when tan implements the flags. `size` is live and
// keeps its call-site test; `build --materialise` is live and keeps its own in
// test/ideHub.materialiseGuard.test.js.
//
// WHAT IS NOT ASSERTED: that these field names are the ones tan actually emits.
// Nothing in this repo can know that — `build --plan`, `build --manifest*` and
// `size` are in NEITHER list of tan's frozen `data` fields (tan-cli
// `contract/README.md`): not in the frozen table, and not in the two rows that
// file names as deliberately uncovered. Filed as alplabai/tan-cli#200. This
// file pins what the extension DEPENDS on; the day tan freezes those rows,
// test/tanContract.test.js is where the two get compared.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

const {
  checkTanPayload,
  BUILD_PLAN_SHAPE,
  SYSTEM_MANIFEST_SHAPE,
  SIZE_REPORT_SHAPE,
} = require("../packages/alp-core/dist/tanPayloadShape.js");

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

/** A `build --plan` payload carrying every field the view reads. */
const PLAN = {
  schemaVersion: 1,
  generatedBy: "alp 0.6.0",
  boardYaml: "./board.yaml",
  sku: "E1M-AEN801",
  buildRoot: "build",
  slices: [],
  sharedArtefacts: [],
  warnings: [],
};

/** A `build --manifest` payload carrying every field the view reads. */
const MANIFEST = {
  schema_version: 1,
  generated_by: "alp 0.6.0",
  hw_info: { sku: "E1M-AEN801" },
  slices: [],
  ipc: [],
  helper_mcus: [],
  boot_order: [],
};

/** A `size` payload carrying every field the view reads. */
const SIZES = {
  schema: "alp-size/1",
  slices: [],
  summary: { over_budget: [], unknown_budget: [] },
};

test("a complete payload passes each shape", () => {
  assert.equal(checkTanPayload(PLAN, BUILD_PLAN_SHAPE, "build --plan"), null);
  assert.equal(
    checkTanPayload(MANIFEST, SYSTEM_MANIFEST_SHAPE, "build --manifest"),
    null,
  );
  assert.equal(checkTanPayload(SIZES, SIZE_REPORT_SHAPE, "size"), null);
});

test("a renamed field is named in the message, with the command", () => {
  const { slices, ...renamed } = PLAN;
  const message = checkTanPayload(
    { ...renamed, images: slices },
    BUILD_PLAN_SHAPE,
    "build --plan",
  );
  assert.ok(message, "a plan with no `slices` must not read as usable");
  assert.match(message, /tan build --plan/);
  assert.match(message, /`slices` \(expected an array\)/);
});

test("every missing field is listed, not just the first", () => {
  const message = checkTanPayload({}, BUILD_PLAN_SHAPE, "build --plan");
  for (const field of Object.keys(BUILD_PLAN_SHAPE)) {
    assert.match(message, new RegExp(`\`${field}\``));
  }
});

test("a field of the wrong kind fails as loudly as a missing one", () => {
  // tan turning a list into a keyed object is the change a presence-only check
  // would wave through, and the view's `plan.slices.filter` would throw on.
  const message = checkTanPayload(
    { ...PLAN, slices: { m55_he: {} } },
    BUILD_PLAN_SHAPE,
    "build --plan",
  );
  assert.match(message, /`slices` \(expected an array\)/);
});

test("no data object at all is reported as exactly that", () => {
  for (const empty of [null, undefined, [], "text", 7]) {
    const message = checkTanPayload(empty, SIZE_REPORT_SHAPE, "size");
    assert.match(message, /no `data` object/);
    assert.match(message, /tan size/);
  }
});

test("an additive tan field never fails a payload the extension can read", () => {
  // The whole reason the shapes list what is READ rather than what is
  // DECLARED: tan's payloads grow, and a check that rejected an unknown key
  // would break a working panel on tan's next minor release.
  assert.equal(
    checkTanPayload(
      { ...PLAN, sysbuild: true, toolchainVariant: "zephyr" },
      BUILD_PLAN_SHAPE,
      "build --plan",
    ),
    null,
  );
});

test("a declared-but-unread field is not required", () => {
  // Each of these is in the payload's TypeScript interface and is read by
  // nothing in this repo. Requiring them would turn a tan cleanup into a dead
  // panel for no gain.
  const dropped = {
    "build --plan": [
      [BUILD_PLAN_SHAPE, PLAN, ["schemaVersion", "generatedBy", "buildRoot"]],
    ],
    "build --manifest": [
      [
        SYSTEM_MANIFEST_SHAPE,
        MANIFEST,
        ["schema_version", "generated_by", "hw_info", "boot_order"],
      ],
    ],
    size: [[SIZE_REPORT_SHAPE, SIZES, ["schema", "summary"]]],
  };
  for (const [command, cases] of Object.entries(dropped)) {
    for (const [shape, payload, fields] of cases) {
      const stripped = { ...payload };
      for (const field of fields) delete stripped[field];
      assert.equal(
        checkTanPayload(stripped, shape, command),
        null,
        `dropping ${fields.join("/")} broke \`tan ${command}\``,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The three call sites
// ---------------------------------------------------------------------------

/** Require `out/ideHub/buildPlanPanel.js` with the host modules stubbed, the
 *  same `Module._load` swap test/deps.adapter.test.js uses. */
function loadPanel(stubs) {
  const modPath = require.resolve(
    path.join(root, "out", "ideHub", "buildPlanPanel.js"),
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

/**
 * Open the panel with `runAlpCommand` answering from `envelopeFor(args)`, send
 * one `requestBuildPlan`, and return every message posted to the webview.
 *
 * `fs.existsSync` is forced true so the post-build path runs at all: `size` is
 * requested only when `build/system-manifest.yaml` exists, and returns early
 * with `report: null` otherwise.
 */
async function drivePanel(envelopeFor) {
  const posted = [];
  let onMessage = () => {};
  const watcher = {
    onDidChange: () => ({ dispose() {} }),
    onDidCreate: () => ({ dispose() {} }),
    onDidDelete: () => ({ dispose() {} }),
    dispose() {},
  };
  const { BuildPlanPanel } = loadPanel({
    fs: { existsSync: () => true },
    vscode: {
      // `buildPlanPanel` imports `runAlpStreamed` (#333), which pulls in
      // `../util`. That module builds the "Alp SDK" output channel AND an
      // `EventEmitter` at LOAD time, so both have to exist before a single
      // assertion runs — otherwise the require throws and the panel never gets
      // far enough to be told anything about a payload shape.
      EventEmitter: class {
        constructor() {
          this.event = () => ({ dispose() {} });
        }
        fire() {}
        dispose() {}
      },
      window: {
        createOutputChannel: () => ({
          appendLine() {},
          append() {},
          show() {},
          clear() {},
          dispose() {},
        }),
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
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "/home/dev/proj" } }],
        createFileSystemWatcher: () => watcher,
      },
      ViewColumn: { Active: 1 },
      Uri: { joinPath: (...p) => p.join("/"), parse: (v) => v },
      env: { openExternal: async () => true },
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args) => ({
        outcome: {
          message: "unused — every stubbed call succeeds",
          envelope: { ok: true, data: envelopeFor(args) },
        },
      }),
      runAlpInTerminal: async () => {},
    },
    "./webviewHtml": { buildWebviewHtml: () => "<html></html>" },
    "../notify/vscodeAdapter": { notifyAsync() {} },
  });

  BuildPlanPanel.open({ extensionUri: "/ext" });
  onMessage({ type: "requestBuildPlan" });
  // Three independent async handlers; a few macrotask turns settles all of them.
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
  return posted;
}

/** The one live payload shape the panel still fetches. `command` names which
 *  argv loses `field`; anything else comes back complete. */
const withDropped = (command, field) => (args) => {
  const payload = args[0] === "size" ? { ...SIZES } : { ...MANIFEST };
  if (args[0] === command) delete payload[field];
  return payload;
};

test("call site: a `size` payload with no `slices` reaches the panel as an error, not a missing column", async () => {
  const posted = await drivePanel(withDropped("size", "slices"));
  const msg = posted.find((m) => m.type === "sliceSizesData");
  assert.ok(msg, "the panel posted no sliceSizesData at all");
  assert.equal(msg.report, null);
  assert.match(msg.error, /tan size/);
  assert.match(msg.error, /`slices`/);
});

test("call site: the deferred flags reach no shape check because they reach no spawn", async () => {
  // The replacement for the two call-site tests #541 removed, and it asserts
  // the thing that actually protects the view now: those two messages carry a
  // named capability gap, not a payload the view might choke on.
  const spawned = [];
  const posted = await drivePanel((args) => {
    spawned.push(args);
    return args[0] === "size" ? { ...SIZES } : { ...MANIFEST };
  });

  assert.deepEqual(
    spawned.filter((args) =>
      args.some((token) =>
        ["--plan", "--manifest", "--manifest-from"].includes(token),
      ),
    ),
    [],
    "a deferred flag reaching the CLI is #541 coming back",
  );
  for (const type of ["buildPlanData", "systemManifestData"]) {
    const msg = posted.find((m) => m.type === type);
    assert.ok(msg, `the panel posted no ${type} at all`);
    assert.match(
      msg.error,
      /tan-cli#427/,
      "the empty state must name the upstream issue, exactly as tan's own " +
        "refusal did",
    );
    assert.doesNotMatch(
      msg.error,
      /\.yaml/,
      "the customer-facing message must not carry the absolute manifest path",
    );
  }
});

test("call site: a good `size` payload passes through untouched", async () => {
  // The control. Without it a `checkTanPayload` that refused EVERYTHING would
  // pass the error test above and blank the section on every correct payload.
  const posted = await drivePanel(withDropped("nothing", "nothing"));
  const sizes = posted.find((m) => m.type === "sliceSizesData");
  assert.deepEqual(sizes.report, SIZES);
  assert.equal(sizes.error, undefined);
});
