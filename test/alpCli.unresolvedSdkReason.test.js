// SPDX-License-Identifier: Apache-2.0
//
// Several tan verbs report an unresolved SDK as a SUCCESS, and the extension
// has to tell that apart from a genuinely empty answer.
//
// Measured against the pinned tan 0.6.0, `tan examples` with no resolvable
// SDK returns exit 0, `ok: true`, `data.examples: []`, and says what actually
// happened only through:
//
//   issues[0].code    = "examples.sdk-root-unresolved"
//   issues[0].severity= "warning"
//   issues[0].message = "alp-sdk root is unresolved. Returning an empty example
//                        catalogue; pass --sdk-root <path> to name the checkout."
//
// The New Project picker read `data.examples ?? []` and showed no Examples
// section — so a user whose SDK is not resolved silently loses all 100 example
// projects with nothing on screen saying why.
//
// The confusable case is a real one and must stay distinguishable: `tan
// examples --category bogus-cat` ALSO returns exit 0 with an empty list, but
// carries NO issue at all. Empty-because-unresolved and empty-because-nothing-
// matched are different situations and only the first has a fix to offer.
//
// `presets` uses the same pattern under `presets.sdk-root-unresolved`, which is
// why this takes the code as a parameter rather than hard-coding one verb.

const test = require("node:test");
const assert = require("node:assert/strict");

const { unresolvedSdkReason } = require("../out/alpCli/service.js");

const UNRESOLVED = {
  command: "examples",
  ok: true,
  exitCode: 0,
  data: { examples: [] },
  issues: [
    {
      code: "examples.sdk-root-unresolved",
      severity: "warning",
      message:
        "alp-sdk root is unresolved. Returning an empty example catalogue; pass --sdk-root <path> to name the checkout.",
    },
  ],
};

test("the unresolved-SDK warning is surfaced with tan's own words", () => {
  assert.equal(
    unresolvedSdkReason(UNRESOLVED, "examples.sdk-root-unresolved"),
    UNRESOLVED.issues[0].message,
  );
});

test("an empty result carrying no issue is not an unresolved SDK", () => {
  // `--category bogus-cat`: exit 0, ok:true, empty list, issues: [].
  const emptyCategory = {
    command: "examples",
    ok: true,
    exitCode: 0,
    data: { examples: [] },
    issues: [],
  };

  assert.equal(
    unresolvedSdkReason(emptyCategory, "examples.sdk-root-unresolved"),
    null,
  );
});

test("another verb's unresolved warning does not match", () => {
  const presets = {
    command: "presets",
    ok: true,
    exitCode: 0,
    data: {},
    issues: [
      {
        code: "presets.sdk-root-unresolved",
        severity: "warning",
        message: "alp-sdk root is unresolved.",
      },
    ],
  };

  assert.equal(
    unresolvedSdkReason(presets, "examples.sdk-root-unresolved"),
    null,
  );
  assert.equal(
    unresolvedSdkReason(presets, "presets.sdk-root-unresolved"),
    "alp-sdk root is unresolved.",
  );
});

test("a missing or malformed envelope is not an unresolved SDK", () => {
  for (const envelope of [
    null,
    undefined,
    {},
    { issues: null },
    { issues: "examples.sdk-root-unresolved" },
    { issues: [null, 42, "boom"] },
    { issues: [{ code: "examples.sdk-root-unresolved" }] },
  ]) {
    assert.equal(
      unresolvedSdkReason(envelope, "examples.sdk-root-unresolved"),
      null,
      `envelope ${JSON.stringify(envelope)} must not report a reason`,
    );
  }
});

// ── The wizard must actually ask, and must actually say ────────────────────
//
// The helper stays correct while nothing calls it, so the call site and the
// two surfaces the reason reaches are gated in the source (the failure mode
// #566 hit).
const fs = require("node:fs");
const path = require("node:path");

function read(...parts) {
  return fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
}

test("the New Project wizard classifies the empty example catalogue", () => {
  const panel = read("src", "ideHub", "newProjectFlowPanel.ts");

  assert.match(
    panel,
    /unresolvedSdkReason\(\s*examplesRes\.outcome\.envelope,/,
    "the examples envelope must be asked why it is empty",
  );
  assert.doesNotMatch(
    panel,
    /the picker simply shows no Examples section/,
    "that comment described the defect as if it were the design",
  );
});

test("the reason reaches both the panel and a one-time toast", () => {
  const panel = read("src", "ideHub", "newProjectFlowPanel.ts");
  const view = read(
    "packages",
    "alp-webview",
    "src",
    "features",
    "new-project-flow",
    "NewProjectFlowView.tsx",
  );

  assert.match(
    panel,
    /examplesUnavailableReason: this\.examplesUnavailableReason/,
    "the wizard payload must carry the reason",
  );
  assert.match(
    panel,
    /planPrecondition\("noSdk"/,
    "an unresolved SDK is a precondition, not a failure — and that plan carries the Open SDK Manager action",
  );
  assert.match(
    view,
    /description=\{examplesUnavailableReason\}/,
    "the view must render tan's own words, not a paraphrase",
  );
});
