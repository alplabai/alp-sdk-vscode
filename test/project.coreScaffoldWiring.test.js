// SPDX-License-Identifier: Apache-2.0
//
// The four defects an adversarial review found in #535, pinned in the wiring
// that carries them (#538).
//
// Each of these is a one-line regression away, and three of the four were
// invisible to every gate that existed when #535 merged:
//
//  1. the scaffold loop read the WIZARD'S request instead of the merged board,
//     so a core whose directory tan had already chosen got a second, decoy
//     directory containing a comment claiming board.yaml pointed at it;
//  2. the app directory reached `path.resolve(projectDir, app)` unvalidated —
//     `../..` walks out of the project and an absolute path ignores it;
//  3. the override that keeps tan's directory said nothing to the customer
//     whose choice it discarded;
//  4. the "one Zephyr core configured … use the multicore example" toast fired
//     even when the second pass had just configured every core.
//
// SOURCE-LEVEL: this lives in a private method of `NewProjectFlowPanel`, whose
// constructor builds a live webview. The behaviour it calls is tested for real
// in `test/project.coreScaffold.test.js`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "ideHub", "newProjectFlowPanel.ts"),
  "utf8",
);

test("the scaffold loop reads the MERGED board, never the wizard's request", () => {
  // Arrange -- they disagree wherever tan had already chosen a directory.
  assert.match(
    SOURCE,
    /const app = merged\?\.cores\?\.\[assignment\.id\]\?\.app;/,
    "the directory to scaffold must come from the board that was written",
  );
  assert.doesNotMatch(
    SOURCE,
    /path\.resolve\(projectDir, assignment\.app\)/,
    "resolving the wizard's raw request is the decoy-directory bug",
  );
});

test("an app directory outside the project is refused, not written to", () => {
  const guard = SOURCE.indexOf("if (!isSafeAppDir(app))");
  const write = SOURCE.indexOf("fs.mkdirSync(dir");

  assert.notEqual(guard, -1, "the host must validate the path itself");
  assert.notEqual(write, -1, "the scaffold must still write");
  assert.ok(guard < write, "validation must come before the first write");
});

test("a discarded directory choice is reported to the customer", () => {
  // Arrange -- keeping tan's directory is right; keeping it silently is how a
  // rename disappears with nothing on screen saying so.
  assert.match(SOURCE, /appDirOverrides\(before, assignments\)/);
  assert.match(SOURCE, /overrides\.length > 0/);
  assert.match(
    SOURCE,
    /keeps "\$\{o\.kept\}" rather than "\$\{o\.requested\}"/,
    "the notice must name both directories",
  );
});

test("the overrides are collected BEFORE the merge overwrites the evidence", () => {
  const collect = SOURCE.indexOf("appDirOverrides(before, assignments)");
  const merge = SOURCE.indexOf("applyCoreAssignments(before, assignments)");

  assert.ok(
    collect !== -1 && merge !== -1 && collect < merge,
    "comparing after the merge would find nothing to report",
  );
});

test("the single-core toast is silenced when the wizard configured the cores", () => {
  // Arrange -- it tells the customer to go use the multicore example. With a
  // core layout applied, the project on disk already has both cores.
  assert.match(
    SOURCE,
    /unscaffolded\.length > 1 && !coreAssignments\?\.length/,
    "the toast must not contradict the project that was just written",
  );
});

test("an unrecognised os value is reported before anything is written", () => {
  // Arrange -- core DROPS it (never coerces, the #517 rule). A drop with no
  // word leaves a project missing a core the customer configured.
  const report = SOURCE.indexOf("unknownCoreOs(assignments)");
  const write = SOURCE.indexOf("fs.writeFileSync(boardPath");

  assert.notEqual(
    report,
    -1,
    "the panel must ask which os values were refused",
  );
  assert.ok(
    report < write,
    "the customer must be told before the file is written",
  );
  assert.match(SOURCE, /does not recognise, so those cores were/);
});
