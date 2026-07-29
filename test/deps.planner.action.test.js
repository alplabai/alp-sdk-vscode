// SPDX-License-Identifier: Apache-2.0
//
// The action is a TRI-STATE over `data.missingPrerequisites`, feature-detected:
//   undefined -> the pinned tan v0.3.1 cannot tell us; fall back to the local
//                name -> ToolchainFixId map and flag it.
//   null      -> tan looked and found nothing missing.
//   entry     -> a command string runs VERBATIM; `command: null` means tan
//                knows no command, so the row shows with no button.
// tan's `fix` field is PROSE ("Install Ninja.") and is never parsed into a
// command — commit e359d37 (#347) rejected that parse as unrecoverable.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  planDependencyReport,
} = require("../packages/alp-core/dist/deps/planner.js");

const envelope = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "tan-doctor-build.v0.3.1.json"),
    "utf-8",
  ),
);
const data = envelope.data;

// `host` is pinned so the expected verbs are the same on every CI runner —
// `fixCommand` answers per platform, and that is the point of the field.
const plan = (over = {}) =>
  planDependencyReport({
    data,
    bootstrapRunning: false,
    cli: { installed: "0.3.1", latest: { version: "0.3.1", kind: "pin" } },
    compareVersions: () => "same",
    host: "linux",
    ...over,
  });

const rowFor = (report, name) => report.rows.find((r) => r.name === name);

// tan dev's real struct: { tool: String, command: Option<String> }.
const withPrereqs = (missingPrerequisites) => ({
  ...data,
  missingPrerequisites,
});

test("key ABSENT: flagged, and actions fall back to the fix map", () => {
  const report = plan();
  assert.equal(report.prerequisiteDataUnavailable, true);
  // Blocker A: on the CLI path the old mapping attached no fixId at all, so
  // every advertised one-click fix was dead wherever tan resolved.
  assert.equal(rowFor(report, "ninja").action.fixId, "build-tools");
  assert.equal(rowFor(report, "zephyrSdk").action.fixId, "zephyr-sdk");
  for (const name of ["ninja", "zephyrSdk"]) {
    assert.equal(rowFor(report, name).action.kind, "fix");
  }
});

test("the button's verb is the fix's REAL effect, not 'Install'", () => {
  // Both of these resolve through `fixCommand` to a docs POINTER on every
  // platform: pressing opens a web page, installs nothing, and leaves the row
  // `warn`. A button labelled "Install" over that is the dead-Fix-button bug
  // with a stronger verb on it.
  assert.deepEqual(rowFor(plan(), "ninja").action, {
    kind: "fix",
    fixId: "build-tools",
    effect: "open-docs",
    title:
      "Opens Zephyr getting started guide " +
      "(https://docs.zephyrproject.org/latest/develop/getting_started/index.html) " +
      "in your browser — nothing is installed",
  });
  assert.equal(rowFor(plan(), "zephyrSdk").action.effect, "open-docs");
  // Same sentence, then the pointer's own `note` — the thing the customer
  // still has to do once the page is open, which the page does not say.
  // Asserted in full in test/deps.planner.zephyrSdk.test.js.
  assert.match(
    rowFor(plan(), "zephyrSdk").action.title,
    /zephyr_sdk\.html\) in your browser — nothing is installed\. Then run /,
  );

  // Same row, same fix id, two platforms, two different true verbs: a pip
  // command on Windows, a whole `tan bootstrap` run everywhere else.
  assert.deepEqual(rowFor(plan({ host: "win32" }), "west").action, {
    kind: "fix",
    fixId: "west",
    effect: "install",
    title: "python -m pip install --user west",
  });
  assert.equal(
    rowFor(plan({ host: "linux" }), "west").action.effect,
    "bootstrap",
  );
  // `westResolved` is the VENV west, so it bootstraps on EVERY host — win32
  // included, where the `west` row's pip command cannot satisfy it.
  for (const host of ["win32", "linux", "darwin"]) {
    assert.equal(
      rowFor(plan({ host }), "westResolved").action.effect,
      "bootstrap",
      host,
    );
  }
});

test("every action carries a title, in both branches", () => {
  const branches = [
    plan(), // key absent -> the fix fallback
    plan({
      data: withPrereqs([
        { tool: "ninja", command: "sudo apt-get install -y ninja-build" },
      ]),
    }), // tan's own command
  ];
  for (const report of branches) {
    for (const row of report.rows) {
      if (!row.action) continue;
      assert.equal(
        typeof row.action.title,
        "string",
        `${row.name}: an untooltipped button — the user cannot see what it does`,
      );
      assert.ok(row.action.title.length > 0, `${row.name}: empty title`);
    }
  }
  // tan's command is its own tooltip, verbatim.
  assert.equal(
    rowFor(branches[1], "ninja").action.title,
    "sudo apt-get install -y ninja-build",
  );
});

test("tan's prose `fix` rides along as a display-only hint", () => {
  const report = plan();
  // The rows with NO button: the prose is the only remedy they carry, and
  // dropping it (as the deleted mapping's replacement did) loses it outright.
  assert.equal(rowFor(report, "vendorToolchain").action, null);
  assert.equal(
    rowFor(report, "vendorToolchain").hint,
    "Install the vendor toolchain for your SoC (see docs/getting-started.md §8).",
  );
  assert.equal(
    rowFor(report, "yoctoHost").hint,
    "Run Yocto builds on Linux (WSL2 / Docker).",
  );
  // Verbatim, including the prose that reads like a command — it is shown, not
  // run (see the sniff test below).
  assert.equal(rowFor(report, "workspace").hint, "tan bootstrap");
  // tan gave no `fix` for cmake, and the host-owned `tan` row has no check at
  // all: neither may invent one.
  assert.equal(rowFor(report, "cmake").hint, null);
  assert.equal(rowFor(report, "tan").hint, null);
});

test("key ABSENT: a passing check gets no fix button", () => {
  const report = plan();
  assert.equal(rowFor(report, "cmake").status, "pass");
  assert.equal(rowFor(report, "cmake").action, null);
});

test("key ABSENT: an unmapped check gets a row and no action", () => {
  const report = plan();
  assert.equal(rowFor(report, "yoctoHost").action, null);
  assert.equal(rowFor(report, "vendorToolchain").action, null);
});

test("key NULL: tan named no missing PREREQUISITE — the fix map still answers", () => {
  const report = plan({ data: withPrereqs(null) });
  // Distinct from `undefined`: tan CAN answer here and its answer is "no PATH
  // prerequisite is missing". That is not the same statement as "no check needs
  // action" — tan builds this list inside `push_tool`, and the checks it pushes
  // by struct literal (`zephyrSdk`) can never appear in it however broken they
  // are. So the local fix map is still consulted for a check the list is
  // silent about; see test/deps.planner.zephyrSdk.test.js for the driven case.
  assert.equal(report.prerequisiteDataUnavailable, false);
  assert.equal(rowFor(report, "zephyrSdk").action.fixId, "zephyr-sdk");
  assert.equal(rowFor(report, "ninja").action.fixId, "build-tools");
  // And a check with no known remedy still gets nothing invented for it.
  for (const name of ["yoctoHost", "vendorToolchain", "sdk", "workspace"]) {
    assert.equal(rowFor(report, name).action, null, `${name} invented one`);
  }
  // A passing check is never offered a fix, in this branch either.
  assert.equal(rowFor(report, "cmake").action, null);
});

test("key NULL: an entry tan DID emit still wins over the fix map", () => {
  // The rule the fallback must not break: tan spoke, tan decides. `west` is in
  // the fix map and would otherwise get `python -m pip install --user west` on
  // win32 — contradicting tan's own "Install west via `tan bootstrap`.".
  const report = plan({
    host: "win32",
    data: withPrereqs([{ tool: "west", command: null }]),
  });
  assert.equal(rowFor(report, "west").action, null);
});

test("entry with a command: carried VERBATIM", () => {
  const command = "winget install --id Kitware.CMake -e --source winget";
  const report = plan({
    data: withPrereqs([
      { tool: "ninja", command },
      { tool: "cmake", command: "sudo apt-get install -y cmake" },
    ]),
  });
  assert.equal(report.prerequisiteDataUnavailable, false);
  assert.deepEqual(rowFor(report, "ninja").action, {
    kind: "command",
    command,
    effect: "install",
    title: command,
  });
  assert.deepEqual(rowFor(report, "cmake").action, {
    kind: "command",
    command: "sudo apt-get install -y cmake",
    effect: "install",
    title: "sudo apt-get install -y cmake",
  });
});

test("entry with command: null — row shows, NO runnable action", () => {
  const report = plan({
    data: withPrereqs([{ tool: "ninja", command: null }]),
  });
  const ninja = rowFor(report, "ninja");
  assert.ok(ninja, "the row must still be shown");
  assert.equal(ninja.status, "warn");
  assert.equal(
    ninja.action,
    null,
    "tan knows no command — a button here would run nothing or the wrong thing",
  );
});

test("prose is never sniffed into a command", () => {
  // The checks below have NO entry in the planner's fix map, so the fallback
  // arm — the one that could reach for `check.fix` — is genuinely TAKEN for
  // them. (`ninja` cannot prove this: it resolves to `build-tools` and returns
  // before the prose is ever in reach, which is what made the old assertion
  // vacuous — reintroducing the sniff still passed.)
  //
  // Both carry prose, and `workspace`'s reads exactly like a runnable command
  // ("tan bootstrap") while `sdk`'s carries a placeholder ("tan sdk switch
  // <path>") that would fail the moment a shell saw it. That is the #347 parse
  // this repo already rejected once.
  for (const name of ["workspace", "sdk", "vendorToolchain"]) {
    const check = data.checks.find((c) => c.name === name);
    assert.ok(check.fix && check.fix.length > 0, `${name} must carry prose`);
    const branches = [
      data, // key ABSENT   -> the fix-map fallback, which finds nothing
      withPrereqs(null), // key NULL     -> tan looked, nothing missing
      withPrereqs([]), // empty list  -> no entry for this tool
      withPrereqs([{ tool: name, command: null }]), // tan knows no command
    ];
    for (const d of branches) {
      const action = rowFor(plan({ data: d }), name).action;
      assert.equal(
        action,
        null,
        `${name}: tan's prose "${check.fix}" became an action`,
      );
    }
    // The prose is not lost, it is DISPLAYED — verbatim, as a hint.
    assert.equal(rowFor(plan(), name).hint, check.fix);
  }

  // And where the fallback does find a fix id, what it emits is that id — the
  // action carries no command string at all.
  const fallback = rowFor(plan(), "ninja").action;
  assert.equal(fallback.kind, "fix");
  assert.equal(
    Object.prototype.hasOwnProperty.call(fallback, "command"),
    false,
  );
  assert.equal(
    data.checks.find((c) => c.name === "ninja").fix,
    "Install Ninja.",
  );
});

test("a prerequisite for a tool with no check adds no row", () => {
  // tan reports no `git` check. The fix is a check upstream in tan-cli, not a
  // row synthesised here.
  const report = plan({
    data: withPrereqs([{ tool: "git", command: "winget install Git.Git" }]),
  });
  assert.equal(report.rows.length, data.checks.length + 1);
  assert.equal(rowFor(report, "git"), undefined);
});

test("bootstrapRunning suppresses every action, in all three branches", () => {
  const branches = [
    data, // key absent -> fix fallback
    withPrereqs(null), // key null
    withPrereqs([{ tool: "ninja", command: "choco install ninja" }]), // command
  ];
  for (const d of branches) {
    const report = plan({ data: d, bootstrapRunning: true });
    for (const row of report.rows) {
      assert.equal(
        row.action,
        null,
        `${row.name} offered an action while a bootstrap was still running`,
      );
    }
  }
  // Same envelope, bootstrap finished: the action comes back.
  assert.deepEqual(rowFor(plan({ data: branches[2] }), "ninja").action, {
    kind: "command",
    command: "choco install ninja",
    effect: "install",
    title: "choco install ninja",
  });
});
