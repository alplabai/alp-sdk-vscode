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
// (`deps/vscodeAdapter.ts`) — pure, exported, and value-tested here against
// REAL `FixAllOutcome` shapes, including one produced by actually RUNNING
// `runFixAll`'s dispatch loop (`deps.fixAll.test.js`'s own harness) rather
// than hand-building the outcome object. What remains in `panel.ts` is wiring
// with no decision left to re-derive — the one source-level check below pins
// that the wiring reads `summary.kind` rather than re-computing it, which is
// exactly the drift that let blocker 1 (round 2) and blocker 2 (this file)
// both happen: two places computing whether the run succeeded, and disagreeing.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

const SOURCE = fs.readFileSync(
  path.join(root, "src", "deps", "panel.ts"),
  "utf8",
);

// The REAL notification planner, loaded directly (pure, no `vscode`) so a
// rendered `.message`/`.channel`/`.severity` reflects what a customer would
// actually see — not a stub's opinion of what `planSuccess`/`planFailure` do.
const { planSuccess, planFailure } = require(
  path.join(root, "out", "notify", "service.js"),
);

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
// `fixAllSummaryNotice` — VALUES, not source text.
// ---------------------------------------------------------------------------

test("fixAllSummaryNotice: a full success -> planSuccess's status bar, info severity", () => {
  const { fixAllSummaryNotice } = loadDepsAdapter();
  const outcome = { installed: ["ninja", "cmake"], failed: [], skipped: [] };

  const summary = fixAllSummaryNotice(outcome, 2);
  assert.equal(summary.kind, "success");
  assert.equal(summary.message, "Fix all: 2 of 2 installed.");

  const plan = planSuccess(summary.message, { detail: summary.detail });
  assert.equal(plan.channel, "statusBar");
  assert.equal(plan.severity, "info");
  assert.equal(plan.message, "Fix all: 2 of 2 installed.");
});

test("fixAllSummaryNotice: a cancelled mid-row outcome (failed.length === 0) is PARTIAL, not success — a warning toast, not the status bar", () => {
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

  const summary = fixAllSummaryNotice(outcome, 1);
  assert.equal(summary.kind, "partial");
  assert.equal(
    summary.message,
    "Fix all: 0 of 1 installed. cmake installed before stopping.",
  );

  // The routing rule this drives in `panel.ts`: anything but "success" goes
  // through `planFailure` at `severity: "warning"`, which is ALWAYS a toast
  // (`channel: input.channel ?? "toast"`) and persists until dismissed —
  // never the 5-second, button-less, un-recallable status-bar line.
  const plan = planFailure({
    operation: "Fix all",
    cause: summary.message,
    detail: summary.detail,
    severity: "warning",
    dedupeKey: "deps-fix-all",
  });
  assert.equal(plan.channel, "toast");
  assert.equal(plan.severity, "warning");
  assert.equal(
    plan.message,
    "Fix all: 0 of 1 installed. cmake installed before stopping.",
    "the full sentence — including what cmake completed — must reach the " +
      "customer's toast verbatim, not be demoted",
  );
});

test("fixAllSummaryNotice: a real failure is 'failure', unconditionally", () => {
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
    skipped: [],
  };

  const summary = fixAllSummaryNotice(outcome, 1);
  assert.equal(summary.kind, "failure");
  assert.match(summary.message, /1 of 1 did not install/);
});

test("fixAllSummaryNotice: a skip with NO completed tools (consent declined) stays a clean success", () => {
  const { fixAllSummaryNotice } = loadDepsAdapter();
  const outcome = {
    installed: ["cmake"],
    failed: [],
    skipped: [{ name: "ninja", reason: "consent not given" }],
  };

  const summary = fixAllSummaryNotice(outcome, 2);
  assert.equal(
    summary.kind,
    "success",
    "a skip that installed nothing is not a half-modified machine",
  );
});

// ---------------------------------------------------------------------------
// End to end: the REAL `runFixAll` dispatch loop's outcome, fed through the
// REAL `fixAllSummaryNotice`, rendered by the REAL `planFailure` — no hand-
// built outcome, no stubbed planner. This is the harness the finding asked
// for: a value-level test over `runFixAll`'s real outcome.
// ---------------------------------------------------------------------------

test("end to end: a 2-step row cancelled after step 1 produces a toast whose message names what installed", async () => {
  // Manual resolution, NOT auto-resolve-on-dispatch: cmake's own step must
  // stay pending until the test explicitly finishes it, or both steps can
  // run to completion inside the same microtask flush before the test ever
  // gets to flip `isCancellationRequested` (the whole reason
  // `deps.fixAll.test.js`'s primary harness works this way too).
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

  const summary = mod.fixAllSummaryNotice(outcome, 1);
  assert.equal(summary.kind, "partial");

  const plan = planFailure({
    operation: "Fix all",
    cause: summary.message,
    detail: summary.detail,
    severity: "warning",
    dedupeKey: "deps-fix-all",
  });
  assert.equal(plan.channel, "toast");
  assert.match(plan.message, /cmake installed before stopping/);
});

// ---------------------------------------------------------------------------
// The one thing left to pin at the source level: `runFixAll` reads
// `summary.kind` instead of re-deriving success/failure itself.
// ---------------------------------------------------------------------------

/** The body of the panel's private `runFixAll` method. */
function runFixAllBody() {
  const start = SOURCE.indexOf("private async runFixAll(): Promise<void> {");
  assert.notEqual(start, -1, "runFixAll must exist as a private method");
  const end = SOURCE.indexOf("\n  private ", start + 1);
  return SOURCE.slice(start, end === -1 ? undefined : end);
}

test("runFixAll routes on fixAllSummaryNotice's own kind, not a second outcome.failed check", () => {
  const body = runFixAllBody();

  assert.match(body, /fixAllSummaryNotice\(outcome, targets\.length\)/);
  assert.match(body, /summary\.kind === "success"/);
  const codeOnly = body.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(
    codeOnly,
    /outcome\.failed\.length === 0/,
    "a second success/failure check here is exactly how the decision and " +
      "the wiring can drift apart again",
  );
});
