// SPDX-License-Identifier: Apache-2.0

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const {
  envReadinessPresentation,
} = require("../packages/alp-core/dist/statusReadiness/service.js");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf-8");

const base = {
  sdk: {
    activePath: "/x",
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
      python: "3.12",
      west: "1.2",
      tan: "0.1.0",
      cmake: null,
      ninja: null,
    },
  },
  workspace: {
    workspaceRoot: "/w",
    boardYamlExists: true,
    westInitialized: true,
  },
};

test("all ready → check + full tooltip", () => {
  const p = envReadinessPresentation(base);
  assert.strictEqual(p.ready, true);
  assert.match(p.text, /Alp/);
  assert.match(p.tooltip, /tan 0\.1\.0/);
  assert.match(p.tooltip, /Alp SDK v0\.6\.0/);
});

test("missing west → not ready + warning", () => {
  const s = JSON.parse(JSON.stringify(base));
  s.setup.westAvailable = false;
  s.setup.toolVersions.west = null;
  const p = envReadinessPresentation(s);
  assert.strictEqual(p.ready, false);
  assert.match(p.text, /setup/i);
  assert.match(p.tooltip, /west .*(not found|—)/i);
});

test("tan absent → managed marker, still not gating", () => {
  const s = JSON.parse(JSON.stringify(base));
  s.setup.toolVersions.tan = null;
  const p = envReadinessPresentation(s);
  assert.strictEqual(p.ready, true); // tan does not gate
  assert.match(p.tooltip, /tan managed/i);
});

// `.west/config` is written at the START of `tan bootstrap`, so every on-disk
// gate above already reads "ready" while the module tree is still being
// fetched. `bootstrapRunning` is the only term that knows the difference.
test("bootstrap still running → NOT ready, even with every other gate green", () => {
  const s = JSON.parse(JSON.stringify(base));
  s.setup.bootstrapRunning = true;
  const p = envReadinessPresentation(s);
  assert.strictEqual(p.ready, false);
  // Same inputs, bootstrap finished → ready. Pins the difference to this one
  // term, so a test asserting the broken value can't pass by accident.
  assert.strictEqual(envReadinessPresentation(base).ready, true);
});

test("bootstrap still running → its own status text, neither ready nor broken", () => {
  const s = JSON.parse(JSON.stringify(base));
  s.setup.bootstrapRunning = true;
  const running = envReadinessPresentation(s);
  const idle = envReadinessPresentation(base);

  assert.notStrictEqual(running.text, idle.text);
  assert.match(running.text, /bootstrap/i);
  // Not the "$(warning) Alp: setup" text either — an in-flight run is not a
  // broken environment, and the only correct action is to wait.
  assert.doesNotMatch(running.text, /warning/);
  assert.match(running.tooltip, /Bootstrapping/);
  assert.doesNotMatch(running.tooltip, /Workspace: Initialized/);
});

// ---------------------------------------------------------------------------
// The SURFACE that offers the action. A readiness decision the status bar
// honours and the Build & Flash rows don't just moves the button — the row is
// still clickable, and clicking it starts a build over a half-fetched module
// tree. So this drives the REAL tree provider out of `out/views/build.js`
// (same `Module._load` swap as test/bootstrap.noWorkspace.test.js) and asserts
// on what the customer can actually click.
// ---------------------------------------------------------------------------

/** Minimal `vscode` stub — only what src/views/build.ts touches. */
const vscodeStub = {
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0 },
  ThemeIcon: class {
    constructor(id) {
      this.id = id;
    }
  },
  EventEmitter: class {
    constructor() {
      this.event = () => ({ dispose() {} });
    }
    fire() {}
    dispose() {}
  },
};

/** The rows the Build & Flash view renders for `state`. */
function buildRows(state) {
  const modPath = require.resolve(path.join(root, "out", "views", "build.js"));
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request === "vscode"
      ? vscodeStub
      : originalLoad.call(this, request, ...rest);
  };
  try {
    const { BuildTreeProvider } = require(modPath);
    return new BuildTreeProvider({
      state,
      onStateChange: () => ({ dispose() {} }),
    }).getChildren();
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

/** Rows that would actually start work on the workspace. */
const BUILD_COMMANDS = ["alp.westBuild", "alp.westAlpFlash", "alp.westUpdate"];
const runnable = (rows) =>
  rows.filter((r) => BUILD_COMMANDS.includes(r.command?.command));

test("build tree offers Build/Flash on a ready workspace", () => {
  // The control: without it, a gate that disables everything unconditionally
  // would pass the test below.
  const rows = buildRows({
    setup: { bootstrapRunning: false },
    workspace: {
      workspaceRoot: "/w",
      boardYamlExists: true,
      westInitialized: true,
    },
  });
  assert.deepStrictEqual(
    runnable(rows).map((r) => r.command.command),
    BUILD_COMMANDS,
  );
});

test("build tree offers NOTHING runnable while a bootstrap is still running", () => {
  const rows = buildRows({
    // Every on-disk gate green — exactly what `tan bootstrap` leaves behind
    // seconds into a run that still has a `west update` to do (tan v0.4.0 no
    // longer reuses a workspace across a patch-level Zephyr bump).
    setup: { bootstrapRunning: true },
    workspace: {
      workspaceRoot: "/w",
      boardYamlExists: true,
      westInitialized: true,
    },
  });
  assert.deepStrictEqual(
    runnable(rows).map((r) => r.command.command),
    [],
    "Build/Flash/Update must not be clickable over a half-fetched module tree",
  );
  // …and the row that replaces them says why, instead of the on-disk answer
  // ("No board.yaml in this folder") the other branches would have given.
  assert.ok(
    rows.some((r) => /bootstrapping/i.test(r.label)),
    `expected a "Bootstrapping…" row, got: ${rows.map((r) => r.label).join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// One name, one spelling.
// ---------------------------------------------------------------------------

// `bootstrapRunning()` probes `isRunActive(BOOTSTRAP_RUN_NAME)`. Re-type
// the name at a dispatch site and the probe watches a run nobody starts: the
// flag is false for the whole bootstrap, the spinner never appears, and every
// gate above silently reopens — with the rest of the suite still green.
test("both bootstrap dispatch sites take the run name from one constant", () => {
  for (const file of ["src/bootstrap.ts", "src/toolchain.ts"]) {
    const src = read(file);
    assert.match(
      src,
      /BOOTSTRAP_RUN_NAME\s*}\s*from\s*"\.\/ideHub\/messages"/,
      `${file} must import the shared run name, not spell it out`,
    );
    assert.match(
      src,
      /name:\s*BOOTSTRAP_RUN_NAME/,
      `${file} must dispatch its bootstrap under BOOTSTRAP_RUN_NAME`,
    );
    assert.doesNotMatch(
      src,
      /"Alp Bootstrap"/,
      `${file} must not carry its own copy of the run name`,
    );
  }
});
