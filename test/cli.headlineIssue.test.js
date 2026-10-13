// SPDX-License-Identifier: Apache-2.0
//
// The issue a one-line headline quotes. tan 0.7.0-rc1 puts SDK-resolution
// WARNINGS (`sdk.project-pin-unresolved`, `sdk.global-default-foreign-project`)
// ahead of the command's own error in `issues[]` (`size_cmd.py`
// `_error_outcome`), so `issues[0]` stopped being the headline. Every consumer
// shares `headlineIssue`; these pin the helper and two of its consumers (the
// third, the Build Plan panel's size reader, is in
// test/ideHub.buildPlanSliceSizesRoot.test.js).

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  headlineIssue,
} = require("../packages/alp-core/dist/cli/headlineIssue.js");
const { classifyOutcome } = require("../out/alpCli/service.js");
const { planCliOutcome } = require("../out/notify/service.js");

const WARNING_FIRST = [
  {
    code: "sdk.project-pin-unresolved",
    severity: "warning",
    message: "The project pins an SDK that is not installed.",
  },
  {
    code: "sdk.global-default-foreign-project",
    severity: "warning",
    message: "The global default SDK was written for another project.",
  },
  {
    code: "presets.sdk-root-unresolved",
    severity: "error",
    message: "No alp-sdk checkout resolved.",
  },
];

const envelope = (issues) => ({
  command: "presets",
  ok: false,
  exitCode: 2,
  project: { root: null, boardYaml: null },
  data: null,
  issues,
});

test("the first ERROR is the headline, even behind warnings", () => {
  assert.equal(headlineIssue(WARNING_FIRST), WARNING_FIRST[2]);
});

test("with no error, the first issue is still the headline", () => {
  const warnings = WARNING_FIRST.slice(0, 2);
  assert.equal(headlineIssue(warnings), warnings[0]);
  assert.equal(headlineIssue([]), undefined);
  assert.equal(headlineIssue(undefined), undefined);
});

test("the outcome message quotes the error and counts the rest", () => {
  const outcome = classifyOutcome(2, envelope(WARNING_FIRST));
  assert.equal(outcome.message, "No alp-sdk checkout resolved. (+2 more)");
});

test("the toast quotes the error, not the advisory", () => {
  const outcome = classifyOutcome(2, envelope(WARNING_FIRST));
  const plan = planCliOutcome(outcome, { operation: "Loading presets" });
  assert.match(plan.message, /No alp-sdk checkout resolved/);
  assert.doesNotMatch(plan.message, /pins an SDK/);
  assert.equal(plan.issues.length, 3, "every issue still travels on the plan");
});
