// SPDX-License-Identifier: Apache-2.0
//
// #603 gate (ii): a `command` action's `commands[]` must reach the terminal
// as ONE DISPATCH PER STEP, never joined into one shell line.
//
// The reverted first attempt (#600) joined tan's commands with `&&`, which
// Windows PowerShell 5.1 (the default profile, no `executable`/`shellArgs` on
// the `ShellExecution`) rejects outright:
//
//   The token '&&' is not a valid statement separator in this version.
//
// `;` is no better — it survives PowerShell but runs step 2 after step 1
// FAILED and collapses N exit codes into one, so a join with either separator
// is wrong for a different reason. Byte-EQUALITY to tan's own per-tool
// `missingPrerequisites[].command` strings forbids `&&`, `;`, `|` and newline
// joining by construction: a joined string cannot equal any individual
// command, and a joined dispatch collapses the COUNT to one — so both the
// count assertion and the byte-equality assertion catch a re-introduced join,
// without needing to blacklist one separator by name.
//
// This file also pins the OTHER half of #600's post-mortem: `runInTerminal`
// REFUSES a same-named dispatch while one is active, and `awaitRun` resolves
// on the first exit for that name — so N steps under one run name cannot be
// fired in a loop with no wait between them; the 2nd onward would be refused
// outright. The ordering assertions below are what proves the fix dispatches
// them SEQUENTIALLY, awaiting each one, rather than firing all of them at
// once against a name that can only hold one.
//
// Loaded the same way `test/ideHub.materialiseGuard.test.js` loads a panel:
// the compiled module from `out/`, with every host import stubbed via a
// `Module._load` swap.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const INSTALL_RUN = "Alp: install dependency";
const NO_CANCEL = { isCancellationRequested: false };

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

/** A row shaped like the planner's fixed output for `hostPrerequisites` —
 *  built by hand here because this file's job is the DISPATCH layer, not the
 *  planner (`test/deps.planner.hostPrerequisites.test.js` owns that half).
 *  `commands` is tan's own `missingPrerequisites[].command` list, verbatim. */
const row = (name, commands) => ({
  name,
  label: name,
  status: "fail",
  state: "will-install",
  detail: "",
  hint: null,
  installed: null,
  latest: null,
  updateAvailable: false,
  action: { kind: "command", commands, effect: "install", title: "" },
});

const report = (rows) => ({
  rows,
  counts: { pass: 0, warn: 0, fail: rows.length },
  prerequisiteDataUnavailable: false,
  orphanedPrerequisites: [],
});

/** Let the microtask queue drain — same helper `deps.fixAll.test.js` uses. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * @param opts.autoResolve when true, `runInTerminal` resolves its own pending
 *   `awaitRun` synchronously (a real, fast install) — used only by the "still
 *   caught" style test; the ordering tests below need MANUAL control instead.
 */
function load(opts = {}) {
  const dispatched = [];
  const pending = new Map();

  const mod = loadWithStubs("deps/vscodeAdapter.js", {
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
        if (opts.autoResolve) pending.get(options.name)?.(0);
      },
      awaitRun: (name) =>
        new Promise((resolve) => {
          pending.set(name, resolve);
        }),
    },
  });

  return { ...mod, dispatched, pending };
}

// ---------------------------------------------------------------------------
// The real fixture: cmake + ninja, both resolved (darwin)
// ---------------------------------------------------------------------------

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "fixtures",
      "tan-doctor.v0.6.0.missing-prereqs.darwin.json",
    ),
    "utf-8",
  ),
).data;

test("N steps -> N dispatches, byte-identical to tan's own command strings", async () => {
  const { runFixAll, dispatched, pending } = load();
  const commands = fixture.missingPrerequisites.map((p) => ({
    tool: p.tool,
    command: p.command,
  }));

  const running = runFixAll({
    report: report([row("hostPrerequisites", commands)]),
    cwd: "/home/dev/proj",
    token: NO_CANCEL,
  });

  await settle();
  assert.deepEqual(
    dispatched.map((d) => d.command),
    ["brew install cmake"],
    "only the FIRST step may be dispatched before it finishes",
  );

  pending.get(INSTALL_RUN)(0);
  await settle();
  assert.deepEqual(
    dispatched.map((d) => d.command),
    ["brew install cmake", "brew install ninja"],
  );

  pending.get(INSTALL_RUN)(0);
  const outcome = await running;

  // Byte-identical to tan's `missingPrerequisites[].command` — not a
  // paraphrase, not a re-quoted form, not a joined line.
  assert.deepEqual(
    dispatched.map((d) => d.command),
    fixture.missingPrerequisites.map((p) => p.command),
  );
  assert.deepEqual(outcome.installed, ["hostPrerequisites"]);
});

test("dispatch N+1 never fires before finish N — same run name, same slot", async () => {
  const { runFixAll, dispatched, pending } = load();
  const commands = fixture.missingPrerequisites.map((p) => ({
    tool: p.tool,
    command: p.command,
  }));

  const running = runFixAll({
    report: report([row("hostPrerequisites", commands)]),
    cwd: "/home/dev/proj",
    token: NO_CANCEL,
  });

  await settle();
  assert.equal(
    dispatched.length,
    1,
    "step 2 dispatched before step 1 finished",
  );
  pending.get(INSTALL_RUN)(0);
  await settle();
  assert.equal(dispatched.length, 2);
  pending.get(INSTALL_RUN)(0);
  await running;
});

test("a failing step stops the row — later steps in the SAME row never dispatch", async () => {
  const { runFixAll, dispatched, pending } = load();
  const commands = fixture.missingPrerequisites.map((p) => ({
    tool: p.tool,
    command: p.command,
  }));

  const running = runFixAll({
    report: report([row("hostPrerequisites", commands)]),
    cwd: "/home/dev/proj",
    token: NO_CANCEL,
  });

  await settle();
  pending.get(INSTALL_RUN)(1); // `brew install cmake` fails
  const outcome = await running;

  assert.deepEqual(
    dispatched.map((d) => d.command),
    ["brew install cmake"],
  );
  assert.deepEqual(outcome.installed, []);
  assert.equal(outcome.failed.length, 1);
  assert.equal(outcome.failed[0].name, "hostPrerequisites");
  assert.equal(outcome.failed[0].code, 1);
});

// ---------------------------------------------------------------------------
// win32: a HAND-BUILT envelope, not a capture.
//
// No Windows host was available to run the pinned binary. The three command
// strings below are QUOTED, not invented — alp-sdk v0.16.0-rc1's
// `metadata/bootstrap.json`, `prerequisites.install.windows`:
//   "cmake": "winget install -e --id Kitware.CMake"
//   "ninja": "winget install -e --id Ninja-build.Ninja"
//   "git":   "winget install -e --id Git.Git"
// This is what makes the `&&`-join defect concrete: Windows PowerShell 5.1 —
// the default terminal profile, since `runInTerminal`'s `ShellExecution` sets
// no `executable`/`shellArgs` — rejects `&&` as a statement separator.
// ---------------------------------------------------------------------------

const WIN32_COMMANDS = [
  { tool: "cmake", command: "winget install -e --id Kitware.CMake" },
  { tool: "ninja", command: "winget install -e --id Ninja-build.Ninja" },
  { tool: "git", command: "winget install -e --id Git.Git" },
];

test("win32 (constructed, not captured): 3 steps, 3 dispatches, no shell join", async () => {
  const { runFixAll, dispatched, pending } = load();

  const running = runFixAll({
    report: report([row("hostPrerequisites", WIN32_COMMANDS)]),
    cwd: "C:\\proj",
    token: NO_CANCEL,
  });

  for (const expected of WIN32_COMMANDS) {
    await settle();
    assert.deepEqual(dispatched.at(-1).command, expected.command);
    pending.get(INSTALL_RUN)(0);
  }
  const outcome = await running;

  assert.deepEqual(
    dispatched.map((d) => d.command),
    WIN32_COMMANDS.map((c) => c.command),
  );
  // The defect this guards against: joining would produce ONE dispatch whose
  // command string is not byte-identical to any of the three above and
  // contains the separator PowerShell 5.1 rejects.
  for (const d of dispatched) {
    assert.doesNotMatch(d.command, /&&/);
    assert.doesNotMatch(d.command, /;/);
  }
  assert.deepEqual(outcome.installed, ["hostPrerequisites"]);
});
