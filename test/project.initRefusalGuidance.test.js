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
  //
  // Matched on the ACTION IDS and the STEP IDS rather than on one literal
  // `actions: [{ id: "chooseProjectType" }]`. That literal pinned the shape of
  // the argument, so adding the second route a refused core layout needs
  // (#582 — the Cores step, since the template picker cannot fix a core
  // layout) reddened a panel that still does everything this gate owes the
  // reader. What it owes is that every route offers a button AND acts on it.
  for (const action of ["chooseProjectType", "chooseCoreLayout"]) {
    assert.match(
      PANEL,
      new RegExp(`id: [^\\n]*"${action}"`),
      `${action} must be offered as a notification action`,
    );
    assert.match(
      PANEL,
      new RegExp(`picked === "${action}"`),
      `${action} must be acted on, not just offered`,
    );
  }
  // THE MAPPING, not merely the presence of both names. Checking that "cores"
  // and "template" each appear somewhere in the file is satisfied by swapping
  // them, and a swap sends a refused core layout to the template picker — which
  // cannot fix a core layout — while a template refusal lands on Cores, which
  // cannot fix that either. Measured: the inverted ternary passes the full
  // suite, `pnpm run typecheck` (messages.ts declares `stepId: string`, so the
  // swap is type-legal) and the render harness, which never sees a host-side
  // ternary.
  assert.match(
    PANEL,
    /stepId: isCoreLayout \? "cores" : "template"/,
    "a refused core layout must route to the Cores step and every other " +
      "refusal to the template picker — inverted, both buttons are dead ends",
  );
  assert.match(
    PANEL,
    /id: isCoreLayout \? "chooseCoreLayout" : "chooseProjectType"/,
    "and the button must be labelled for the step it actually goes to",
  );
  assert.match(
    PANEL,
    /const isCoreLayout = refusal\.kind === "core-layout-refused"/,
    "the branch must key on the classified kind, never on tan's prose",
  );

  // ...and the webview acts on it.
  assert.match(VIEW, /msg\.type === "newProjectFlowGoToStep"/);
  assert.match(
    VIEW,
    /STEPS\.findIndex\(\(step\) => step\.id === msg\.stepId\)/,
  );
  assert.match(VIEW, /if \(index >= 0\) goTo\(index\)/);
});

test("every step the host can name is a step that exists", () => {
  // Arrange -- the host sends an ID precisely so an inserted step cannot
  // silently repoint it, which only holds while the id is real. Both routes are
  // checked: a `stepId` the webview does not have is ignored outright, so a
  // typo here is a button that does nothing.
  assert.match(VIEW, /\{ id: "template", title: "Template" \}/);
  assert.match(VIEW, /\{ id: "cores", title: "Cores" \}/);
});
