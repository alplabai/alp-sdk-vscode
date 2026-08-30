// SPDX-License-Identifier: Apache-2.0
//
// "Fix all": every installing row, ONE AT A TIME (#466 §2).
//
// Sequential is the design, not a simplification. Two installers racing is the
// failure `planDependencyReport` already suppresses every action to avoid — "a
// second installer racing it is how half-written workspaces happen" — and
// several of these fixes mutate the same venv, the same west workspace, or the
// same machine-wide package manager. It would also lose to the run
// reservations: `runInTerminal` REFUSES a name already active, so a parallel
// dispatch drops rows and reports success.
//
// So the assertions here are mostly about ORDER, and about what is reported
// when a step does not run. A "Fix all" that quietly installs three of five is
// worse than one that installs none and says so.
//
// The awaited signal is stubbed as a resolver map: the test decides exactly
// when each run "finishes", which is the only way to assert that the second
// dispatch had not happened yet while the first was still going.

const test = require("node:test");
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

/** A row the planner would have produced. `state` is what `fixAllTargets`
 *  filters on, so it is spelled out per row rather than re-derived here. */
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

const NO_CANCEL = { isCancellationRequested: false };
const INSTALL_RUN = "Alp: install dependency";

/**
 * @param opts.active run names `isRunActive` should report as busy
 * @returns the module under test plus the recorders the assertions read
 */
function load(opts = {}) {
  const dispatched = [];
  /** name -> resolve, filled as each `awaitRun` is subscribed. */
  const pending = new Map();
  const active = new Set(opts.active ?? []);

  const mod = loadWithStubs("deps/vscodeAdapter.js", {
    vscode: {
      // Consent GRANTED for every row: `runFixAll` now runs ADR 0021 §3's
      // consent screen before its first dispatch (#467), so a harness with no
      // picker never reaches the ordering this file is about. The screen's own
      // behaviour — one dialog for the set, declining, unchecking a row — is
      // `test/deps.installConsent.test.js`.
      window: { showQuickPick: async (items) => items },
      Uri: {},
    },
    "../alpCli/vscodeAdapter": {},
    "../alpCli/doctor": {},
    "../notify/vscodeAdapter": { notifyAsync() {} },
    "../project/vscodeAdapter": {},
    "../environment/vscodeAdapter": {},
    "../toolchain": {
      runToolchainFix: (fixId) => dispatched.push({ fix: fixId }),
      TOOLCHAIN_FIX_RUN_NAME: "Alp: toolchain fix",
    },
    "../util": {
      log() {},
      isRunActive: (name) => active.has(name),
      runInTerminal: (options) => dispatched.push(options),
      awaitRun: (name) =>
        new Promise((resolve) => {
          pending.set(name, resolve);
        }),
    },
  });

  return { ...mod, dispatched, pending, active };
}

/** Let the microtask queue drain so an `await` that is already resolvable can
 *  proceed — without this, "nothing else has been dispatched yet" would pass
 *  even when the next step was about to run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// Which rows are in scope
// ---------------------------------------------------------------------------

test("only the installing rows are targets — a pointer installs nothing", () => {
  // Arrange -- `open-docs` opens a web page. Counting it would make the
  // button's number a promise the run cannot keep.
  const { fixAllTargets } = load();
  const rows = [
    row({ name: "ninja" }),
    row({ name: "cmake", state: "ready", status: "pass" }),
    row({
      name: "zephyrSdkHost",
      state: "needs-you",
      action: {
        kind: "fix",
        fixId: "zephyr-sdk",
        effect: "open-docs",
        title: "",
      },
    }),
    row({ name: "vendorToolchain", state: "needs-you", action: null }),
    row({ name: "west" }),
  ];

  // Act / Assert
  assert.deepEqual(
    fixAllTargets(report(rows)).map((target) => target.name),
    ["ninja", "west"],
  );
});

test("targets keep the planner's order", () => {
  // Arrange -- tan orders its checks; the panel renders that order and so does
  // the run. Re-sorting here would install in an order nobody chose.
  const { fixAllTargets } = load();
  const names = ["west", "cmake", "ninja", "zephyrSdk"];

  // Act / Assert
  assert.deepEqual(
    fixAllTargets(report(names.map((name) => row({ name })))).map(
      (target) => target.name,
    ),
    names,
  );
});

// ---------------------------------------------------------------------------
// Which run name each row will claim
// ---------------------------------------------------------------------------

test("each action kind maps to the run name its dispatch actually claims", () => {
  // Arrange -- if this and the dispatch disagree, `awaitRun` waits on a name
  // nothing will ever fire and the whole sequence hangs. That is why the names
  // are asserted as literals rather than imported from the module under test.
  const { runNameFor } = load();

  assert.equal(runNameFor(row({ name: "ninja" })), INSTALL_RUN);
  assert.equal(
    runNameFor(row({ name: "zephyrSdk" })),
    "Alp: install Zephyr SDK",
    "the Zephyr SDK install keeps its own run name",
  );
  assert.equal(
    runNameFor(
      row({
        name: "west",
        action: { kind: "fix", fixId: "west", effect: "bootstrap", title: "" },
      }),
    ),
    "Alp Bootstrap",
  );
  assert.equal(
    runNameFor(
      row({
        name: "gdb",
        action: { kind: "fix", fixId: "gdb", effect: "install", title: "" },
      }),
    ),
    "Alp: toolchain fix",
  );
});

test("a row with nothing to wait for has no run name", () => {
  // Arrange -- a pointer and an actionless row both start nothing. Returning a
  // name for them would make the sequence await a run that never begins.
  const { runNameFor } = load();
  assert.equal(runNameFor(row({ name: "x", action: null })), null);
  assert.equal(
    runNameFor(
      row({
        name: "y",
        action: {
          kind: "fix",
          fixId: "zephyr-sdk",
          effect: "open-docs",
          title: "",
        },
      }),
    ),
    null,
  );
});

// ---------------------------------------------------------------------------
// The sequence
// ---------------------------------------------------------------------------

test("the second row does not start until the first has finished", async () => {
  // Arrange -- THE test. Everything else about this feature is bookkeeping.
  const { runFixAll, dispatched, pending } = load();
  const running = runFixAll({
    report: report([row({ name: "ninja" }), row({ name: "cmake" })]),
    cwd: "/proj",
    token: NO_CANCEL,
  });

  // Act / Assert -- one dispatch, and it stays one until we let it finish.
  await settle();
  assert.deepEqual(
    dispatched.map((run) => run.command),
    ["install ninja"],
    "the second install must not be dispatched while the first is running",
  );

  pending.get(INSTALL_RUN)(0);
  await settle();
  assert.deepEqual(
    dispatched.map((run) => run.command),
    ["install ninja", "install cmake"],
  );

  pending.get(INSTALL_RUN)(0);
  const outcome = await running;
  assert.deepEqual(outcome.installed, ["ninja", "cmake"]);
  assert.deepEqual(outcome.failed, []);
  assert.deepEqual(outcome.skipped, []);
});

test("a failure stops the sequence, and every row left is named with the reason", async () => {
  // Arrange -- a toolchain is a chain: `west` failing makes the workspace step
  // after it fail for a reason that has nothing to do with the workspace. A
  // wall of consequential errors buries the one real one.
  const { runFixAll, dispatched, pending } = load();
  const running = runFixAll({
    report: report([
      row({ name: "west" }),
      row({ name: "cmake" }),
      row({ name: "ninja" }),
    ]),
    cwd: "/proj",
    token: NO_CANCEL,
  });

  // Act
  await settle();
  pending.get(INSTALL_RUN)(1);
  const outcome = await running;

  // Assert
  assert.deepEqual(outcome.installed, []);
  assert.deepEqual(outcome.failed, [
    {
      name: "west",
      code: 1,
      completed: [],
      failedCommand: "install west",
      notRun: [],
    },
  ]);
  assert.deepEqual(
    outcome.skipped.map((entry) => entry.name),
    ["cmake", "ninja"],
    "the rows after the failure are REPORTED, not silently dropped",
  );
  assert.match(outcome.skipped[0].reason, /west failed/);
  assert.equal(dispatched.length, 1, "nothing ran after the failure");
});

// ---------------------------------------------------------------------------
// Multi-step `command` rows (#603) — the `hostPrerequisites` rollup shape.
// ---------------------------------------------------------------------------

test("a multi-step row: step 2 dispatches only after step 1 finishes, no double-awaitRun", async () => {
  // Arrange -- THE hard contract: `runDependencyAction` owns `awaitRun` for
  // this run name; `runFixAll` must not ALSO subscribe it for a command row,
  // or step 1's finish would be read as the whole row's finish.
  const { runFixAll, dispatched, pending } = load();
  const running = runFixAll({
    report: report([
      row({
        name: "hostPrerequisites",
        action: {
          kind: "command",
          commands: [
            { tool: "cmake", command: "brew install cmake" },
            { tool: "ninja", command: "brew install ninja" },
          ],
          effect: "install",
          title: "",
        },
      }),
    ]),
    cwd: "/proj",
    token: NO_CANCEL,
  });

  await settle();
  assert.deepEqual(
    dispatched.map((d) => d.command),
    ["brew install cmake"],
  );

  pending.get(INSTALL_RUN)(0);
  await settle();
  assert.deepEqual(
    dispatched.map((d) => d.command),
    ["brew install cmake", "brew install ninja"],
  );

  pending.get(INSTALL_RUN)(0);
  const outcome = await running;
  assert.deepEqual(outcome.installed, ["hostPrerequisites"]);
});

test("a multi-step row: step 2 fails — the outcome says what installed and what did not", async () => {
  const { runFixAll, pending } = load();
  const running = runFixAll({
    report: report([
      row({
        name: "hostPrerequisites",
        action: {
          kind: "command",
          commands: [
            { tool: "cmake", command: "brew install cmake" },
            { tool: "ninja", command: "brew install ninja" },
          ],
          effect: "install",
          title: "",
        },
      }),
    ]),
    cwd: "/proj",
    token: NO_CANCEL,
  });

  await settle();
  pending.get(INSTALL_RUN)(0); // cmake installs
  await settle();
  pending.get(INSTALL_RUN)(1); // ninja fails
  const outcome = await running;

  assert.deepEqual(outcome.installed, []);
  assert.deepEqual(outcome.failed, [
    {
      name: "hostPrerequisites",
      code: 1,
      completed: ["cmake"],
      failedCommand: "brew install ninja",
      notRun: [],
    },
  ]);
});

test("an unknown exit code is a failure, not a success", async () => {
  // Arrange -- `undefined` means the task never started or its code could not
  // be read (a task type that was never contributed, a window teardown).
  // Counting it as installed is how a Fix all reports green over a run that
  // did nothing.
  const { runFixAll, pending } = load();
  const running = runFixAll({
    report: report([row({ name: "ninja" })]),
    cwd: "/proj",
    token: NO_CANCEL,
  });

  // Act
  await settle();
  pending.get(INSTALL_RUN)(undefined);
  const outcome = await running;

  // Assert
  assert.deepEqual(outcome.installed, []);
  assert.deepEqual(outcome.failed, [
    {
      name: "ninja",
      code: undefined,
      completed: [],
      failedCommand: "install ninja",
      notRun: [],
    },
  ]);
});

test("a run already holding the slot is skipped with a reason, never awaited", async () => {
  // Arrange -- the one way to hang this: `runInTerminal` REFUSES a name that
  // is already active, reserving nothing and firing nothing, so an `awaitRun`
  // on it would never settle. The check has to happen before the dispatch.
  const { runFixAll, dispatched } = load({ active: [INSTALL_RUN] });

  // Act -- if the guard were missing this would never resolve, and the test
  // would time out rather than fail, which is itself the signal.
  const outcome = await runFixAll({
    report: report([row({ name: "ninja" })]),
    cwd: "/proj",
    token: NO_CANCEL,
  });

  // Assert
  assert.deepEqual(dispatched, [], "nothing may be dispatched at a busy name");
  assert.equal(outcome.skipped.length, 1);
  assert.match(outcome.skipped[0].reason, /already running/);
});

test("cancelling stops the sequence between steps and never kills a live run", async () => {
  // Arrange -- the same rule as everywhere else here: a live run can be a
  // flash, and killing that mid-write can leave a board unbootable (#146). A
  // cancel means no FURTHER steps, and says so for each one.
  const token = { isCancellationRequested: false };
  const { runFixAll, dispatched, pending } = load();
  const running = runFixAll({
    report: report([row({ name: "ninja" }), row({ name: "cmake" })]),
    cwd: "/proj",
    token,
  });

  // Act -- cancel while the first install is still going, then let it finish.
  await settle();
  token.isCancellationRequested = true;
  pending.get(INSTALL_RUN)(0);
  const outcome = await running;

  // Assert
  assert.deepEqual(
    outcome.installed,
    ["ninja"],
    "the run already in flight still completes and still counts",
  );
  assert.equal(dispatched.length, 1, "no further step was started");
  assert.deepEqual(outcome.skipped, [{ name: "cmake", reason: "cancelled" }]);
});

test("the progress callback names each row before it starts", async () => {
  // Arrange -- the progress line is the only thing on screen during a long
  // install, and it must name the row running NOW, not the one that just
  // finished.
  const steps = [];
  const { runFixAll, pending } = load();
  const running = runFixAll({
    report: report([
      row({ name: "ninja", label: "Ninja" }),
      row({ name: "cmake", label: "CMake" }),
    ]),
    cwd: "/proj",
    token: NO_CANCEL,
    onStep: (target, index, total) => steps.push([target.label, index, total]),
  });

  // Act
  await settle();
  pending.get(INSTALL_RUN)(0);
  await settle();
  pending.get(INSTALL_RUN)(0);
  await running;

  // Assert
  assert.deepEqual(steps, [
    ["Ninja", 0, 2],
    ["CMake", 1, 2],
  ]);
});

test("the dispatched cwd is the caller's, for every row", async () => {
  // Arrange -- a Fix all must not quietly run installs somewhere else; on
  // Windows an absent cwd is the VS Code INSTALL DIRECTORY.
  const { runFixAll, dispatched, pending } = load();
  const running = runFixAll({
    report: report([row({ name: "ninja" })]),
    cwd: "/home/dev/proj",
    token: NO_CANCEL,
  });

  // Act
  await settle();
  pending.get(INSTALL_RUN)(0);
  await running;

  // Assert
  assert.equal(dispatched[0].cwd, "/home/dev/proj");
});

test(
  "a run that finishes the instant it is dispatched is still caught",
  { timeout: 5000 },
  async () => {
    // Arrange -- the ORDER of `awaitRun` and the dispatch, which every test
    // above is blind to: their stub never completes on its own, so subscribing
    // late looks identical to subscribing early.
    //
    // Here `runInTerminal` resolves the pending run the moment it is called —
    // a real, fast install (`winget` on an already-installed package exits in
    // milliseconds). Subscribe after dispatching and there is no subscriber
    // when the signal fires, so the promise never settles and the whole
    // sequence hangs; this test then fails on its own timeout rather than
    // hanging the file.
    const pending = new Map();
    const dispatched = [];
    const { runFixAll } = loadWithStubs("deps/vscodeAdapter.js", {
      // Consent granted, same as `load()` above (#467).
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
      "../util": {
        log() {},
        isRunActive: () => false,
        runInTerminal: (options) => {
          dispatched.push(options);
          // Finishes immediately — before any `await` a caller might attach
          // afterwards could ever run.
          pending.get(options.name)?.(0);
        },
        awaitRun: (name) =>
          new Promise((resolve) => {
            pending.set(name, resolve);
          }),
      },
    });

    // Act
    const outcome = await runFixAll({
      report: report([row({ name: "ninja" }), row({ name: "cmake" })]),
      cwd: "/proj",
      token: NO_CANCEL,
    });

    // Assert
    assert.deepEqual(outcome.installed, ["ninja", "cmake"]);
    assert.equal(dispatched.length, 2);
  },
);

test("an empty target set does nothing at all", async () => {
  // Arrange -- a healthy machine. No dispatch, no failure, no noise.
  const { runFixAll, dispatched } = load();

  // Act
  const outcome = await runFixAll({
    report: report([row({ name: "cmake", state: "ready", status: "pass" })]),
    cwd: "/proj",
    token: NO_CANCEL,
  });

  // Assert
  assert.deepEqual(dispatched, []);
  assert.deepEqual(outcome, { installed: [], failed: [], skipped: [] });
});

// ---------------------------------------------------------------------------
// `describeFixAllFailure` — the summary toast's wording (#603 design item 6).
// ---------------------------------------------------------------------------

test("describeFixAllFailure: a multi-step row says what installed, what failed, and that nothing after it ran", () => {
  const { describeFixAllFailure } = load();

  assert.equal(
    describeFixAllFailure({
      name: "hostPrerequisites",
      code: 1,
      completed: ["cmake"],
      failedCommand: "brew install ninja",
      notRun: [],
    }),
    "hostPrerequisites: installed cmake; `brew install ninja` exited 1; nothing after it ran",
  );
});

test("describeFixAllFailure: names the steps that never got a chance to run", () => {
  const { describeFixAllFailure } = load();

  assert.equal(
    describeFixAllFailure({
      name: "hostPrerequisites",
      code: 1,
      completed: [],
      failedCommand: "brew install cmake",
      notRun: ["ninja"],
    }),
    "hostPrerequisites: `brew install cmake` exited 1; nothing after it ran (ninja skipped)",
  );
});

test("describeFixAllFailure: a fix/bootstrap row keeps the original wording, unchanged", () => {
  const { describeFixAllFailure } = load();

  assert.equal(
    describeFixAllFailure({
      name: "west",
      code: 1,
      completed: [],
      failedCommand: undefined,
      notRun: [],
    }),
    "west exit 1",
  );
  assert.equal(
    describeFixAllFailure({
      name: "west",
      code: undefined,
      completed: [],
      failedCommand: undefined,
      notRun: [],
    }),
    "west exit unknown",
  );
});
