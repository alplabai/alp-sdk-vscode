// SPDX-License-Identifier: Apache-2.0
//
// ADR 0021 §3's one consent screen, on the dependency panel's install paths
// (#467).
//
// What this pins, and why each one is here rather than left to review:
//
//  - **A "Fix all" asks BEFORE it installs anything.** Until this landed it
//    asked nothing at all: pressing the button dispatched the first installer
//    immediately, while the far smaller act of downloading the `tan` binary
//    has required a consent click since #434. That asymmetry is the bug.
//  - **ONE screen for the whole set, never one per row.** #467 names N modal
//    dialogs during a Fix-all as the failure mode, so the call is counted, not
//    just observed.
//  - **The screen can never name a different artifact than the one that runs.**
//    The same structural guarantee `test/alpCli.downloadConsent.test.js:268`
//    and `:280` make for the tan binary. Here it is enforced by identity: the
//    rows the screen is built from are the row OBJECTS the loop dispatches, so
//    the assertion compares the offered set against the dispatched set.
//  - **Declining and unchecking are both reported, never silently dropped.**
//    A "Fix all" that quietly installs three of five is worse than one that
//    installs none and says so.

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
          command: over.command ?? `apt-get install -y ${over.name}`,
          effect: "install",
          title: `install ${over.name}`,
        }
      : over.action,
});

const report = (rows) => ({
  rows,
  counts: { pass: 0, warn: 0, fail: rows.length },
  prerequisiteDataUnavailable: false,
});

const NO_CANCEL = { isCancellationRequested: false };

/**
 * @param opts.pick how the consent screen is answered — `"all"` (default),
 *   `"none"` (dismissed), or a list of row names to leave checked.
 */
function load(opts = {}) {
  const dispatched = [];
  const pending = new Map();
  const shown = [];

  const showQuickPick = async (items) => {
    shown.push(items);
    if (opts.pick === "none") return undefined;
    if (Array.isArray(opts.pick)) {
      return items.filter((item) => opts.pick.includes(item.name));
    }
    return items;
  };

  const mod = loadWithStubs("deps/vscodeAdapter.js", {
    vscode: { window: { showQuickPick }, Uri: {} },
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
      isRunActive: () => false,
      runInTerminal: (options) => {
        dispatched.push(options);
        // Finish immediately: this suite is about the gate, not the ordering
        // (`deps.fixAll.test.js` owns that).
        const resolve = pending.get(options.name);
        if (resolve) resolve(0);
      },
      awaitRun: (name) =>
        new Promise((resolve) => {
          pending.set(name, resolve);
        }),
    },
  });

  return { ...mod, dispatched, shown };
}

const run = (mod, rows) =>
  mod.runFixAll({ report: report(rows), cwd: undefined, token: NO_CANCEL });

// ---------------------------------------------------------------------------
// The gate itself
// ---------------------------------------------------------------------------

test("a Fix all asks for consent before it dispatches anything", async () => {
  // Arrange
  const mod = load({ pick: "none" });

  // Act
  const outcome = await run(mod, [
    row({ name: "ninja" }),
    row({ name: "cmake" }),
  ]);

  // Assert -- asked, and nothing ran.
  assert.equal(mod.shown.length, 1);
  assert.deepEqual(mod.dispatched, []);
  assert.deepEqual(outcome.installed, []);
});

test("declining is REPORTED for every row, never a silent no-op", async () => {
  // Arrange
  const mod = load({ pick: "none" });

  // Act
  const outcome = await run(mod, [
    row({ name: "ninja" }),
    row({ name: "cmake" }),
  ]);

  // Assert
  assert.deepEqual(
    outcome.skipped.map((entry) => entry.name),
    ["ninja", "cmake"],
  );
  for (const entry of outcome.skipped) {
    assert.match(entry.reason, /consent/i);
  }
});

test("ONE screen for the whole set — never one dialog per row", async () => {
  // Arrange -- #467 names N modals during a Fix-all as the failure mode.
  const mod = load();

  // Act
  await run(mod, [
    row({ name: "ninja" }),
    row({ name: "cmake" }),
    row({ name: "dtc" }),
    row({ name: "gperf" }),
  ]);

  // Assert
  assert.equal(mod.shown.length, 1);
  assert.equal(mod.shown[0].length, 4);
});

test("the screen offers exactly the rows the run dispatches", async () => {
  // Arrange -- the structural guarantee. A `ready` row and a pointer row are
  // in the report but not in the run, so a screen built from the REPORT rather
  // than from the targets would name artifacts nothing installs.
  const mod = load();
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
    row({ name: "dtc" }),
  ];

  // Act
  const outcome = await run(mod, rows);

  // Assert
  assert.deepEqual(
    mod.shown[0].map((item) => item.name),
    ["ninja", "dtc"],
  );
  assert.deepEqual(outcome.installed, ["ninja", "dtc"]);
});

test("unchecking one row installs the rest and reports the one left out", async () => {
  // Arrange -- ADR 0021's Tier B rule ("skippable") without a tier: any item
  // can be left out, and the remainder still installs.
  const mod = load({ pick: ["ninja", "gperf"] });

  // Act
  const outcome = await run(mod, [
    row({ name: "ninja" }),
    row({ name: "cmake" }),
    row({ name: "gperf" }),
  ]);

  // Assert
  assert.deepEqual(outcome.installed, ["ninja", "gperf"]);
  assert.deepEqual(
    outcome.skipped.map((entry) => entry.name),
    ["cmake"],
  );
  assert.match(outcome.skipped[0].reason, /consent/i);
});

// ---------------------------------------------------------------------------
// What the screen says
// ---------------------------------------------------------------------------

test("each line carries artifact, source, size and licence (ADR 0021 §3)", async () => {
  // Arrange
  const mod = load();

  // Act
  await run(mod, [
    row({
      name: "ninja",
      label: "Ninja",
      command: "apt-get install -y ninja-build",
    }),
  ]);

  // Assert -- the two nobody reports say so rather than showing an empty cell
  // or an invented number (alp-sdk#1574).
  const [item] = mod.shown[0];
  assert.equal(item.label, "Ninja");
  assert.match(item.detail, /apt-get install -y ninja-build/);
  assert.match(item.detail, /Size: not reported/);
  assert.match(item.detail, /Licence: not reported/);
});

test("a line whose command asks for elevation says so", async () => {
  // Arrange
  const mod = load();

  // Act
  await run(mod, [
    row({ name: "udev", command: "sudo cp 99-jlink.rules /etc/udev/rules.d/" }),
    row({ name: "ninja", command: "brew install ninja" }),
  ]);

  // Assert
  const [elevated, plain] = mod.shown[0];
  assert.match(elevated.description, /elevation/i);
  assert.doesNotMatch(plain.description ?? "", /elevation/i);
});

test("every line starts checked — consent is opt-OUT within one screen", async () => {
  // Arrange -- the ADR's "install after one consent click". A screen that
  // starts empty makes the customer re-select what they already asked for.
  const mod = load();

  // Act
  await run(mod, [row({ name: "ninja" }), row({ name: "cmake" })]);

  // Assert
  assert.deepEqual(
    mod.shown[0].map((item) => item.picked),
    [true, true],
  );
});

test("nothing to install asks nothing", async () => {
  // Arrange -- a report with no installing row must not raise a dialog whose
  // only honest answer is "install nothing".
  const mod = load();

  // Act
  const outcome = await run(mod, [
    row({ name: "cmake", state: "ready", status: "pass" }),
  ]);

  // Assert
  assert.equal(mod.shown.length, 0);
  assert.deepEqual(outcome.installed, []);
});
