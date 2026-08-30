// SPDX-License-Identifier: Apache-2.0
//
// #603 (second adversarial pass), blocker 1: the Fix-all summary notice
// `deps/panel.ts` raises after a run finished silently dropped what a
// cancelled/raced-away row had already installed.
//
// Measured end to end: a 2-step `hostPrerequisites` row where step 1 (cmake)
// succeeds and step 2 never runs (cancelled) produces
// `{"installed":[],"failed":[],"skipped":[{"name":"hostPrerequisites",
// "reason":"cancelled","completed":["cmake"]}]}`. `outcome.failed` is EMPTY,
// so the panel took the `planSuccess` branch — `planSuccess(message, {
// detail })` with no `actions` renders on VS Code's STATUS BAR, which shows
// only `message`; `detail` is written to the "Alp SDK" output channel and
// never reaches the customer at all. The customer read
// "Fix all: 0 of 1 installed" for a machine that now has cmake on it.
//
// (third adversarial pass), blocker 2: the FIRST fix for the above was
// gated with three source-level regexes over `runFixAll`'s call site
// (`/planSuccess\(\s*withFixAllPartialNote\(/` etc.) — they proved the call
// was TYPED, never that the OUTCOME actually flowing through it was real.
// Mutating the call site to pass a literal `{ skipped: [] }` instead of the
// real `outcome` restored blocker 1 verbatim and every one of those regexes
// still matched. The decision moved into `fixAllSummaryNotice`
// (`deps/vscodeAdapter.ts`) — pure and value-tested here — but its RETURN
// was still a `{kind, message, detail}` triple that `panel.ts` then turned
// into a `NotificationPlan` itself with a ternary on `kind`.
//
// (round 4), blockers 2 and 3: that ternary was STILL a gap. A regex-only
// gate on `summary.kind === "success"` survived widening it to
// `summary.kind === "success" || summary.kind === "partial"` (routes a
// half-modified machine back to the status bar — only ADDS a disjunct, so
// the substring still matches) and survived rewriting the whole call as
// `planSuccess(\`Fix all: ${outcome.installed.length} of
// ${targets.length} installed.\`, …)` (type-checks, never calls
// `fixAllSummaryNotice` at all). Both mutations left typecheck and every
// existing test green. The fix: `fixAllSummaryNotice` now returns the
// FINISHED `NotificationPlan` itself — `panel.ts` has no `kind`, no
// ternary, no `severity`, and no `dedupeKey` left to hand-build, so there is
// no longer a hand-building surface for any of those mutations to reach.
// What remains in `panel.ts` is wiring with no decision left to re-derive:
// this file pins that with (a) VALUE-level tests on `fixAllSummaryNotice`'s
// own `NotificationPlan` output, including one built from a REAL outcome
// produced by actually running `runFixAll`'s dispatch loop, and (b) an
// end-to-end mount of the real `DependencyPanel` proving `panel.ts` hands
// `fixAllSummaryNotice`'s plan to `notifyAsync` UNCHANGED — a fake
// `notifyAsync` capturing the exact object, not a substring of a ternary
// that no longer exists to match.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

const PANEL_SOURCE = fs.readFileSync(
  path.join(root, "src", "deps", "panel.ts"),
  "utf8",
);

// The REAL notification planner, loaded directly (pure, no `vscode`) so a
// rendered `.message`/`.channel`/`.severity` reflects what a customer would
// actually see — not a stub's opinion of what `planSuccess` does.
const { planSuccess } = require(path.join(root, "out", "notify", "service.js"));

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

function loadDepsAdapter(overrides = {}) {
  return loadWithStubs("deps/vscodeAdapter.js", {
    vscode: { window: { showQuickPick: async (items) => items }, Uri: {} },
    "../alpCli/vscodeAdapter": {},
    "../alpCli/doctor": {},
    "../notify/vscodeAdapter": { notifyAsync() {} },
    "../project/vscodeAdapter": {},
    "../environment/vscodeAdapter": {},
    "../toolchain": {
      runToolchainFix() {},
      TOOLCHAIN_FIX_RUN_NAME: "Alp: toolchain fix",
    },
    "../util": { log() {}, isRunActive: () => false },
    ...overrides,
  });
}

const NO_CANCEL = { isCancellationRequested: false };

/** A row shaped like the planner's output. */
const row = (over) => ({
  name: over.name,
  label: over.label ?? over.name,
  status: over.status ?? "fail",
  state: over.state ?? "will-install",
  detail: "",
  hint: null,
  installed: null,
  latest: null,
  updateAvailable: false,
  action:
    over.action === undefined
      ? {
          kind: "command",
          commands: [{ tool: over.name, command: `install ${over.name}` }],
          omittedTools: [],
          effect: "install",
          title: `install ${over.name}`,
        }
      : over.action,
});

const report = (rows) => ({
  rows,
  counts: { pass: 0, warn: 0, fail: rows.length },
  prerequisiteDataUnavailable: false,
  orphanedPrerequisites: [],
});

// ---------------------------------------------------------------------------
// `fixAllSummaryNotice` — VALUES, the whole `NotificationPlan`, not a
// `{kind, message, detail}` triple a caller still has to route.
// ---------------------------------------------------------------------------

test("fixAllSummaryNotice: a full success -> planSuccess's status bar, info severity", () => {
  const { fixAllSummaryNotice } = loadDepsAdapter();
  const outcome = { installed: ["ninja", "cmake"], failed: [], skipped: [] };

  const plan = fixAllSummaryNotice(outcome, 2);
  assert.equal(plan.channel, "statusBar");
  assert.equal(plan.severity, "info");
  assert.equal(plan.message, "Fix all: 2 of 2 installed.");
  assert.deepEqual(
    plan,
    planSuccess("Fix all: 2 of 2 installed.", { detail: "2 installed" }),
  );
});

test("fixAllSummaryNotice: a cancelled mid-row outcome (failed.length === 0) is a warning toast, not the status bar", () => {
  // #603, third review, major 6: `outcome.failed.length === 0` is not the
  // same fact as "clean success" once a skip can carry `completed`.
  const { fixAllSummaryNotice } = loadDepsAdapter();
  const outcome = {
    installed: [],
    failed: [],
    skipped: [
      { name: "hostPrerequisites", reason: "cancelled", completed: ["cmake"] },
    ],
  };

  const plan = fixAllSummaryNotice(outcome, 1);

  // The routing rule this drives: anything but a clean success goes through
  // `planFailure` at `severity: "warning"`, which is ALWAYS a toast
  // (`channel: input.channel ?? "toast"`) and persists until dismissed —
  // never the 5-second, button-less, un-recallable status-bar line.
  assert.equal(plan.channel, "toast");
  assert.equal(plan.severity, "warning");
  assert.equal(plan.dedupeKey, "deps-fix-all");
  assert.equal(
    plan.message,
    "Fix all: 0 of 1 installed. cmake installed before stopping.",
    "the full sentence — including what cmake completed — must reach the " +
      "customer's toast verbatim, not be demoted",
  );
});

test("fixAllSummaryNotice: a real failure counts the RIGHT thing (round 4, major 5)", () => {
  // A row fails, and every row after it is marked skipped — an ordinary
  // multi-row abort, not a cancellation. `outcome.failed.length` alone
  // undercounts: 2 targets did not install, not 1.
  const { fixAllSummaryNotice } = loadDepsAdapter();
  const outcome = {
    installed: [],
    failed: [
      {
        name: "hostPrerequisites",
        code: 1,
        completed: [],
        failedCommand: "brew install cmake",
        notRun: [],
      },
    ],
    skipped: [
      { name: "west", reason: "stopped after hostPrerequisites failed" },
    ],
  };

  const plan = fixAllSummaryNotice(outcome, 2);
  assert.equal(plan.channel, "toast");
  assert.equal(plan.severity, "warning");
  assert.match(plan.message, /^2 of 2 did not install\./);
});

test("fixAllSummaryNotice: a failed row's OWN completed steps reach the customer message (round 4, blocker 1)", () => {
  // Measured repro: a 2-step `hostPrerequisites` row installs cmake, then
  // fails on ninja. The row is in `failed`, never `skipped` — reading only
  // `skipped[].completed` (the second-review fix) reported "1 of 1 did not
  // install." for a machine that already has cmake on it.
  const { fixAllSummaryNotice } = loadDepsAdapter();
  const outcome = {
    installed: [],
    failed: [
      {
        name: "hostPrerequisites",
        code: 1,
        completed: ["cmake"],
        failedCommand: "brew install ninja",
        notRun: [],
      },
    ],
    skipped: [],
  };

  const plan = fixAllSummaryNotice(outcome, 1);
  assert.notEqual(plan.message, "1 of 1 did not install.");
  assert.equal(
    plan.message,
    "1 of 1 did not install. cmake installed before stopping.",
  );
});

test("fixAllSummaryNotice: a tool named by two different rows is named ONCE (nit 13)", () => {
  const { fixAllSummaryNotice } = loadDepsAdapter();
  const outcome = {
    installed: [],
    failed: [],
    skipped: [
      { name: "a", reason: "cancelled", completed: ["cmake"] },
      { name: "b", reason: "cancelled", completed: ["cmake"] },
    ],
  };

  const plan = fixAllSummaryNotice(outcome, 2);
  assert.equal(
    plan.message,
    "Fix all: 0 of 2 installed. cmake installed before stopping.",
    "cmake must be named once, not once per row that names it",
  );
});

test("fixAllSummaryNotice: a skip with NO completed tools (consent declined) stays a clean success", () => {
  const { fixAllSummaryNotice } = loadDepsAdapter();
  const outcome = {
    installed: ["cmake"],
    failed: [],
    skipped: [{ name: "ninja", reason: "consent not given" }],
  };

  const plan = fixAllSummaryNotice(outcome, 2);
  assert.equal(
    plan.channel,
    "statusBar",
    "a skip that installed nothing is not a half-modified machine",
  );
});

// ---------------------------------------------------------------------------
// End to end: the REAL `runFixAll` dispatch loop's outcome, fed through the
// REAL `fixAllSummaryNotice`, rendered by the REAL `planFailure` — no
// hand-built outcome, no stubbed planner. The harness IS this file's own:
// `deps.fixAll.test.js` covers `runFixAll`'s dispatch-order behaviour, not
// this notice.
// ---------------------------------------------------------------------------

test("end to end: a 2-step row cancelled after step 1 produces a toast whose message names what installed", async () => {
  // Manual resolution, NOT auto-resolve-on-dispatch: cmake's own step must
  // stay pending until the test explicitly finishes it, or both steps can
  // run to completion inside the same microtask flush before the test ever
  // gets to flip `isCancellationRequested`.
  const pending = new Map();
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const mod = loadDepsAdapter({
    "../util": {
      log() {},
      isRunActive: () => false,
      runInTerminal() {},
      awaitRun: (name) =>
        new Promise((resolve) => {
          pending.set(name, resolve);
        }),
    },
  });

  const token = { isCancellationRequested: false };
  const running = mod.runFixAll({
    report: report([
      row({
        name: "hostPrerequisites",
        action: {
          kind: "command",
          commands: [
            { tool: "cmake", command: "brew install cmake" },
            { tool: "ninja", command: "brew install ninja" },
          ],
          omittedTools: [],
          effect: "install",
          title: "",
        },
      }),
    ]),
    cwd: "/proj",
    token,
  });

  // Let cmake's install dispatch and finish, then cancel before ninja starts.
  await settle();
  token.isCancellationRequested = true;
  pending.get("Alp: install dependency")(0);
  const outcome = await running;

  assert.deepEqual(outcome, {
    installed: [],
    failed: [],
    skipped: [
      { name: "hostPrerequisites", reason: "cancelled", completed: ["cmake"] },
    ],
  });

  const plan = mod.fixAllSummaryNotice(outcome, 1);
  assert.equal(plan.channel, "toast");
  assert.equal(plan.severity, "warning");
  assert.match(plan.message, /cmake installed before stopping/);
});

// ---------------------------------------------------------------------------
// What's left in `panel.ts`: wiring, not a decision. Two checks, together —
// the source-level one alone is exactly what round 3's regexes proved
// insufficient (see the header): it can confirm a hand-building SURFACE is
// gone, but only a VALUE-level mount proves the plan that reaches
// `notifyAsync` is the one `fixAllSummaryNotice` actually returned.
// ---------------------------------------------------------------------------

/** The body of the panel's private `runFixAll` method. */
function runFixAllBody() {
  const start = PANEL_SOURCE.indexOf(
    "private async runFixAll(): Promise<void> {",
  );
  assert.notEqual(start, -1, "runFixAll must exist as a private method");
  const end = PANEL_SOURCE.indexOf("\n  private ", start + 1);
  return PANEL_SOURCE.slice(start, end === -1 ? undefined : end);
}

test("runFixAll has no planSuccess/planFailure call left to hand-build — fixAllSummaryNotice's plan goes to notifyAsync unchanged", () => {
  const body = runFixAllBody();
  const codeOnly = body.replace(/\/\/.*$/gm, "");

  assert.match(codeOnly, /fixAllSummaryNotice\(outcome, targets\.length\)/);
  assert.doesNotMatch(
    codeOnly,
    /planSuccess\(|planFailure\(/,
    "a `planSuccess`/`planFailure` call here means `panel.ts` is building " +
      "(or re-building) a plan itself again — the exact shape every round-4 " +
      "mutation of the old ternary took",
  );
  // The plan handed to `notifyAsync` must be the untouched return value —
  // not a new object literal, not a field pulled off it and reassembled.
  assert.match(codeOnly, /notifyAsync\(plan\)/);
});

/**
 * Mount the REAL `DependencyPanel` end to end and drive its "runFixAll"
 * webview message, with `./vscodeAdapter` replaced by a canned outcome and
 * the REAL `fixAllSummaryNotice` — so what reaches `notifyAsync` is either
 * exactly what the real pure function returns, or panel.ts is rebuilding it.
 */
function mountAndRunFixAll(outcome, targetRows) {
  const real = loadWithStubs("deps/vscodeAdapter.js", {
    vscode: { window: { showQuickPick: async (items) => items }, Uri: {} },
    "../alpCli/vscodeAdapter": {},
    "../alpCli/doctor": {},
    "../notify/vscodeAdapter": { notifyAsync() {} },
    "../project/vscodeAdapter": {},
    "../environment/vscodeAdapter": {},
    "../toolchain": {
      runToolchainFix() {},
      TOOLCHAIN_FIX_RUN_NAME: "Alp: toolchain fix",
    },
    "../util": { log() {}, isRunActive: () => false },
  });

  let notified;
  const notifiedPromise = new Promise((resolve) => {
    notified = resolve;
  });
  let onMessage = () => {};
  const webviewPanel = {
    visible: true,
    webview: {
      html: "",
      onDidReceiveMessage(handler) {
        onMessage = handler;
        return { dispose() {} };
      },
      postMessage: () => Promise.resolve(true),
    },
    reveal() {},
    dispose() {},
    onDidDispose() {
      return { dispose() {} };
    },
    onDidChangeViewState() {
      return { dispose() {} };
    },
  };

  const { DependencyPanel } = loadWithStubs("deps/panel.js", {
    vscode: {
      window: {
        createWebviewPanel: () => webviewPanel,
        withProgress: (_options, fn) => fn({ report() {} }, NO_CANCEL),
      },
      ProgressLocation: { Notification: 1 },
      ViewColumn: { Active: 1 },
      Uri: { joinPath: () => ({}), parse: (value) => value },
      env: { openExternal: async () => true },
    },
    "../environment/vscodeAdapter": { danglingWestManifest: () => null },
    "../ideHub/webviewHtml": { buildWebviewHtml: () => "<html></html>" },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: "/home/dev/proj",
        sdkRoot: null,
      }),
    },
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => notified(plan),
    },
    "../toolchain": { offerBootstrapFix: async () => {} },
    "../util": { log() {} },
    "./vscodeAdapter": {
      fixAllSummaryNotice: real.fixAllSummaryNotice,
      fixAllTargets: () => targetRows,
      runFixAll: async () => outcome,
      buildDependencyReport: async () => ({ report: report(targetRows) }),
      withLatestSdk: async () => null,
      runDependencyAction: async () => undefined,
    },
  });

  const stateMgr = { state: {}, onStateChange: () => ({ dispose() {} }) };
  DependencyPanel.open({ extensionUri: {} }, stateMgr);

  return {
    onMessage,
    notified: notifiedPromise,
    expected: real.fixAllSummaryNotice,
  };
}

/** Let a pending microtask/macrotask turn settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("end to end: the panel hands notifyAsync EXACTLY what fixAllSummaryNotice returns", async () => {
  const targetRows = [row({ name: "hostPrerequisites" })];
  const outcome = {
    installed: [],
    failed: [
      {
        name: "hostPrerequisites",
        code: 1,
        completed: ["cmake"],
        failedCommand: "brew install ninja",
        notRun: [],
      },
    ],
    skipped: [],
  };

  const { onMessage, notified, expected } = mountAndRunFixAll(
    outcome,
    targetRows,
  );
  // "ready" first, same order the webview itself always uses — its refresh
  // must land (setting `this.lastReport`, which `fixAllTargets` reads) before
  // "runFixAll" does anything.
  onMessage({ type: "ready" });
  await flush();
  onMessage({ type: "runFixAll" });
  const plan = await notified;

  assert.deepEqual(plan, expected(outcome, targetRows.length));
  assert.equal(plan.channel, "toast");
  assert.equal(plan.severity, "warning");
  assert.match(plan.message, /cmake installed before stopping/);
});
