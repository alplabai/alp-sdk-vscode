// SPDX-License-Identifier: Apache-2.0
//
// The New Project flow must turn the two (template, SoM) refusals into
// guidance plus a route back, not a bare report (#530).
//
// Before this, `tan init`'s refusal reached the customer through the generic
// `planCliOutcome` path: accurate, and a dead end — they were left on the
// Confirm step whose Create button would fail again in exactly the same way.
//
// SOURCE-LEVEL: the branch lives in a private method of `NewProjectFlowPanel`,
// whose constructor builds a live webview. The classifier it calls is tested
// for real in `test/project.initRefusal.test.js`; what is pinned here is the
// wiring — that the branch exists, runs BEFORE the generic report, and that
// pressing the button actually navigates.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const PANEL = fs.readFileSync(
  path.join(root, "src", "ideHub", "newProjectFlowPanel.ts"),
  "utf8",
);
const VIEW = fs.readFileSync(
  path.join(
    root,
    "packages",
    "alp-webview",
    "src",
    "features",
    "new-project-flow",
    "NewProjectFlowView.tsx",
  ),
  "utf8",
);

test("the refusal branch runs before the generic outcome report", () => {
  // Arrange -- order is the whole point: `planCliOutcome` returns, so a branch
  // placed after it is unreachable.
  const classify = PANEL.indexOf(
    "classifyInitRefusal(outcome.envelope?.issues)",
  );
  const generic = PANEL.indexOf("planCliOutcome(outcome,");

  // Assert
  assert.notEqual(classify, -1, "the panel must classify the refusal");
  assert.notEqual(
    generic,
    -1,
    "the generic report must still exist as fallback",
  );
  assert.ok(classify < generic, "classification must come first");
});

test("the two kinds get different advice", () => {
  // Arrange -- `init.invalid-som` is fixable by changing the SoM;
  // `init.som-unsupported` is not. One sentence for both would send half the
  // customers round the wizard for nothing.
  assert.match(PANEL, /refusal\.kind === "template-pinned-to-som"/);
  assert.match(PANEL, /No SoM change helps here/);
});

test("tan's own message is forwarded, not replaced", () => {
  // Arrange -- it names the SKU that works, which no table here could.
  assert.match(PANEL, /refusal\.message \?\?/);
});

test("the code travels as channel detail, never in the sentence", () => {
  // Arrange -- `message` must carry no internal identifier; that is the notify
  // contract, and `init.som-unsupported` is one.
  assert.match(PANEL, /detail: `\$\{refusal\.code\}/);
});

test("pressing the button posts a step jump the webview understands", () => {
  // Arrange -- an awaited pick, then a message. Without the post, the button
  // is a dead end with a friendlier label.
  assert.match(PANEL, /actions: \[\{ id: "chooseProjectType" \}\]/);
  assert.match(PANEL, /picked === "chooseProjectType"/);
  assert.match(PANEL, /type: "newProjectFlowGoToStep",\s*stepId: "template"/);

  // ...and the webview acts on it.
  assert.match(VIEW, /msg\.type === "newProjectFlowGoToStep"/);
  assert.match(
    VIEW,
    /STEPS\.findIndex\(\(step\) => step\.id === msg\.stepId\)/,
  );
  assert.match(VIEW, /if \(index >= 0\) goTo\(index\)/);
});

test('the step is named by id, and "template" is a step that exists', () => {
  // Arrange -- the host sends an ID precisely so an inserted step cannot
  // silently repoint it, which only holds while the id is real.
  assert.match(VIEW, /\{ id: "template", title: "Template" \}/);
});
