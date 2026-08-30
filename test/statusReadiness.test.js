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
// the name at a dispatch site — or dispatch a bootstrap terminal under a
// second, independently-spelled name — and the probe watches a run nobody
// starts: the flag is false for the whole bootstrap, the spinner never
// appears, and every gate above silently reopens — with the rest of the
// suite still green.
//
// #604/#614 collapsed this from "two sites both spell BOOTSTRAP_RUN_NAME" to
// "one site dispatches under it, and everyone else calls that site" —
// `runBootstrapInTerminal` (src/bootstrap.ts) is now the ONLY place a
// bootstrap terminal is started, so it is also the only place the
// post-bootstrap `tan sdk current` reconciliation (#604/#614) can be skipped
// by a second, independent dispatch.
//
// MAJOR 8 (adversarial review): the first version of this test named exactly
// two files (`src/bootstrap.ts`, `src/toolchain.ts`) — a NEW third file
// spelling `BOOTSTRAP_RUN_NAME` was invisible to it, and it had also DROPPED
// the literal-ban on `src/bootstrap.ts` itself, so re-spelling the constant
// as a bare `"Alp Bootstrap"` literal INSIDE bootstrap.ts (the one spelling
// that makes `awaitRun` watch a run nobody starts) was green under the new
// assertion and would have been red under the old one. This greps the
// ANTIPATTERN across all of `src/**`, the way `test/tanContract.test.js`'s
// `scanGatedCodes` does for issue codes, so a file this test has never heard
// of is still caught.
test("only src/bootstrap.ts references the bootstrap run name -- everywhere, by any spelling", () => {
  const bootstrapSrc = read("src/bootstrap.ts");
  assert.match(
    bootstrapSrc,
    /BOOTSTRAP_RUN_NAME\s*}\s*from\s*"\.\/ideHub\/messages"/,
    "src/bootstrap.ts must import the shared run name, not spell it out",
  );
  assert.match(
    bootstrapSrc,
    /name:\s*BOOTSTRAP_RUN_NAME/,
    "src/bootstrap.ts must dispatch its bootstrap under BOOTSTRAP_RUN_NAME",
  );
  assert.match(
    bootstrapSrc,
    /awaitRun\(BOOTSTRAP_RUN_NAME\)/,
    "src/bootstrap.ts must subscribe to the run's finish via the shared " +
      "constant too, not a re-spelled literal",
  );
  assert.doesNotMatch(
    bootstrapSrc,
    /"Alp Bootstrap"/,
    "src/bootstrap.ts must not carry a literal copy of the run name " +
      "ANYWHERE -- every use must go through the imported BOOTSTRAP_RUN_NAME " +
      'constant, or a re-spelled awaitRun("Alp Bootstrap") would watch a ' +
      "run nobody starts",
  );

  // Legitimate READ-ONLY consumers of the constant are not the antipattern —
  // `isRunActive(BOOTSTRAP_RUN_NAME)` (ideHub/vscodeAdapter.ts's
  // `bootstrapRunning`), `def.run === BOOTSTRAP_RUN_NAME`
  // (extension.ts's task-finish comparison), and `return BOOTSTRAP_RUN_NAME`
  // (deps/vscodeAdapter.ts's `runNameFor`, which the Dependencies panel's
  // "Fix all" awaits BEFORE dispatching through `alp.installDependencies`,
  // never a second live dispatch). The antipattern is specifically DISPATCHING
  // a terminal run under this name, or `awaitRun` SUBSCRIBING to one — both
  // idioms bootstrap.ts uses and nowhere else legitimately does.
  const srcRoot = path.join(root, "src");
  const exempt = new Set([
    path.join(srcRoot, "bootstrap.ts"),
    // Declares the constant -- `export const BOOTSTRAP_RUN_NAME = "Alp
    // Bootstrap"` is the literal's ONE legitimate home.
    path.join(srcRoot, "ideHub", "messages.ts"),
    // A doc-comment lists "Alp Bootstrap" purely as an illustrative task
    // NAME (alongside "Alp: west build"/"Alp: west flash") while explaining
    // `getMapKey()`'s collision risk -- not a dispatch or a subscription.
    path.join(srcRoot, "util.ts"),
  ]);
  const offenders = [];
  for (const rel of fs.readdirSync(srcRoot, { recursive: true })) {
    const file = path.join(srcRoot, String(rel));
    if (!/\.tsx?$/.test(file) || !fs.statSync(file).isFile()) continue;
    if (exempt.has(file)) continue;
    const text = fs.readFileSync(file, "utf-8");
    if (
      /name:\s*BOOTSTRAP_RUN_NAME/.test(text) ||
      /awaitRun\(\s*BOOTSTRAP_RUN_NAME\s*\)/.test(text) ||
      /"Alp Bootstrap"/.test(text)
    ) {
      offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "only src/bootstrap.ts may DISPATCH (or awaitRun-subscribe to) the " +
      `bootstrap run name -- found it in: ${offenders.join(", ")}. A ` +
      "second dispatch site is a second place the post-bootstrap tan sdk " +
      "current reconciliation (#604/#614) can be silently skipped.",
  );

  // The one legitimate caller left, still asserted directly: toolchain.ts
  // must route through the shared function rather than spawn its own.
  const toolchainSrc = read("src/toolchain.ts");
  assert.match(
    toolchainSrc,
    /runBootstrapInTerminal\(/,
    "src/toolchain.ts must route its bootstrap dispatch through " +
      "bootstrap.ts's shared runBootstrapInTerminal, not spawn one itself",
  );
});
