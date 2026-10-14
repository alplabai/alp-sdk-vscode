// SPDX-License-Identifier: Apache-2.0
//
// The toast a finished `tan flash` raises (#540): the five outcomes, as the
// notification plans the presenter will actually show. The classification is
// tested in flash.outcome.test.js; this file pins what each one SAYS and that
// none of them reports a failure for a run that wrote nothing.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  flashOutcomeText,
  planFlashOutcome,
} = require("../out/flash/outcome.js");

const capture = (name) =>
  fs.readFileSync(
    path.join(
      __dirname,
      "fixtures",
      "tan-flash",
      `tan-flash.v0.7.0.${name}.json`,
    ),
    "utf8",
  );
const planFor = (name) =>
  planFlashOutcome("Alp Flash", flashOutcomeText(capture(name)));

test("previewed: info, says nothing was written, never 'failed'", () => {
  for (const name of ["unconfirmed.flow-d", "unconfirmed.mixed-yocto-flow-d"]) {
    const plan = planFor(name);
    assert.equal(plan.severity, "info", name);
    assert.match(plan.message, /only previewed.*nothing was written/i, name);
    assert.doesNotMatch(plan.message, /fail/i, name);
  }
});

test("refused before writing: a warning that says nothing was written, not 'failed'", () => {
  for (const name of [
    "confirm.flow-d.atoc-unacknowledged",
    "confirm.flow-d.setools-untrusted",
  ]) {
    const plan = planFor(name);
    assert.equal(plan.severity, "warning", name);
    assert.match(plan.message, /nothing was written/i, name);
    assert.doesNotMatch(plan.message, /Alp Flash failed/, name);
    // tan's own reason is channel-only detail.
    assert.ok(plan.detail && plan.detail.length > 0, name);
  }
});

test("failed during the write: an error carrying the partial-write warning", () => {
  const plan = planFor("confirm.flow-d.write-failed");
  assert.equal(plan.severity, "error");
  assert.match(plan.message, /partly programmed/);
  assert.match(plan.message, /before re-flashing/);
  assert.ok(plan.actions.some((a) => a.id === "showOutput"));
});

test("output that is not an envelope reports an unknown state, not success or failure", () => {
  const plan = planFlashOutcome("Alp Flash", flashOutcomeText("Traceback ..."));
  assert.equal(plan.severity, "warning");
  assert.match(plan.message, /does not say whether any slice was written/);
});
