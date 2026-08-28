// SPDX-License-Identifier: Apache-2.0
//
// The `hostPrerequisites` ROLLUP, which is how the pinned tan 0.6.0 reports a
// missing build tool -- and the reason every install button on that path was
// dead.
//
// `deps.planner.action.test.js` pins the v0.3.1 shape, where tan emitted one
// CHECK PER TOOL (`cmake`, `ninja`) and `actionFor`'s `p.tool === check.name`
// match therefore landed. tan 0.6.0 emits neither check. Measured, with a PATH
// holding brew/git/python3 but not cmake/ninja:
//
//   missingPrerequisites: [{"tool":"cmake","command":"brew install cmake"},
//                          {"tool":"ninja","command":"brew install ninja"}]
//   checks: ... hostPrerequisites {status:"fail",
//               detail:"missing from PATH: cmake, ninja ..."}
//
// No check is named `cmake` or `ninja`, so nothing matched, and the `FIX_IDS`
// fallback keys (`cmake` / `ninja`) are keyed by CHECK name too -- also dead.
// The customer this panel exists for saw a red "Bootstrap prerequisites" row
// with prose and no button, while tan had already handed over the exact
// command to run.

const test = require("node:test");
const assert = require("node:assert");
const {
  planDependencyReport,
} = require("../packages/alp-core/dist/deps/planner.js");

/** The measured 0.6.0 shape, trimmed to the checks this behaviour turns on. */
const data = {
  schemaVersion: "1",
  checks: [
    { name: "hostPython", status: "pass", detail: "python3 3.12.7" },
    {
      name: "hostPrerequisites",
      status: "fail",
      scope: "host",
      detail: "missing from PATH: cmake, ninja (install them, then re-run)",
      fix: "Install the missing host prerequisites.",
    },
  ],
  missingPrerequisites: [
    { tool: "cmake", command: "brew install cmake" },
    { tool: "ninja", command: "brew install ninja" },
  ],
};

const plan = (over = {}) =>
  planDependencyReport({
    data,
    bootstrapRunning: false,
    cli: { installed: "0.6.0", latest: { version: "0.6.0", kind: "pin" } },
    compareVersions: () => "same",
    host: "darwin",
    ...over,
  });

const rollup = (report) =>
  report.rows.find((r) => r.name === "hostPrerequisites");

test("a failing hostPrerequisites rollup offers tan's own install command", () => {
  const row = rollup(plan());

  assert.ok(
    row.action,
    "tan named cmake and ninja WITH commands; a row that offers nothing " +
      "leaves the customer to discover `brew install cmake` themselves",
  );
  assert.equal(row.action.kind, "command");
  assert.equal(row.action.effect, "install");
});

test("every tool tan named is in the command, none silently dropped", () => {
  const { command } = rollup(plan()).action;

  assert.match(command, /brew install cmake/);
  assert.match(
    command,
    /brew install ninja/,
    "offering only the first missing tool strands the customer one tool " +
      "short with no sign there was a second",
  );
});

test("the tooltip is the command that will run, verbatim", () => {
  const { title, command } = rollup(plan()).action;

  assert.equal(
    title,
    command,
    "every command action in this planner shows the command as its tooltip, " +
      "so the customer can read what a button does before pressing it",
  );
});

test("a bootstrap in flight still suppresses the button", () => {
  assert.equal(
    rollup(plan({ bootstrapRunning: true })).action,
    null,
    "a second installer racing an in-flight bootstrap is how half-written " +
      "workspaces happen -- the rollup path must not become an exception",
  );
});

test("a tool tan named without a command contributes nothing to the action", () => {
  const report = plan({
    data: {
      ...data,
      missingPrerequisites: [
        { tool: "cmake", command: "brew install cmake" },
        { tool: "dfu-util", command: null },
      ],
    },
  });

  const { command } = rollup(report).action;
  assert.equal(command, "brew install cmake");
  assert.equal(
    command.includes("dfu-util"),
    false,
    "`command: null` means tan knows no command -- inventing one is exactly " +
      "the prose-parsing this planner refuses",
  );
});

test("no missing prerequisite leaves the rollup without an invented action", () => {
  const report = plan({
    data: {
      ...data,
      checks: [{ name: "hostPrerequisites", status: "pass", detail: "ok" }],
      missingPrerequisites: null,
    },
  });

  assert.equal(rollup(report).action, null);
});
