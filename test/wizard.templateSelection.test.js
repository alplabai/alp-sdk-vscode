// SPDX-License-Identifier: Apache-2.0
//
// A template selection must not outlive the catalogue it was made against
// (#591).
//
// The wizard re-fetches the catalogue whenever the SDK selection changes, and
// nothing reconciled the answer. If the new SDK does not ship that template the
// wizard carried a dead id all the way to Create: `canAdvance[0]` only checks
// the id is non-empty, `ConfirmStep`'s `templates.find` misses and renders the
// RAW ID rather than a title, and Create posts it anyway — the scaffold then
// fails with `alp init --from-example` "was not found".
//
// This is NOT #144. That was the catalogue being FETCHED from the ambient SDK
// while the project was SCAFFOLDED from the wizard-selected one; `reloadCatalog`
// fixed it. What survives the reload is the selection.
//
// The rule lives in `shared/templateSelection.ts` for the same reason
// `coreChoices.ts` does — it is trivial to state as data and awkward to stage
// in a DOM — and is loaded through esbuild's own transform rather than by
// stripping types with regexes, so a loader that mis-parses it cannot take the
// gate with it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

function loadTs(rel) {
  const file = path.join(__dirname, "..", rel);
  const { code } = esbuild.transformSync(fs.readFileSync(file, "utf8"), {
    loader: "ts",
    format: "cjs",
  });
  const mod = new Module(file, null);
  mod.filename = file;
  mod._compile(code, file);
  return mod.exports;
}

const { reconcileTemplateSelection } = loadTs(
  "packages/alp-webview/src/shared/templateSelection.ts",
);
const VIEW = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "packages/alp-webview/src/features/new-project-flow/NewProjectFlowView.tsx",
  ),
  "utf8",
);

const CATALOGUE = [
  { id: "blinky" },
  { id: "hello-world" },
  { id: "iot-starter" },
];

test("a selection the new catalogue still has is kept, untouched", () => {
  assert.equal(
    reconcileTemplateSelection("blinky", CATALOGUE),
    "blinky",
    "most SDKs ship the same starters. Dropping an answer the customer " +
      "already gave, for nothing, is its own defect.",
  );
});

test("a selection the new catalogue does not have is dropped", () => {
  assert.equal(
    reconcileTemplateSelection("iot-starter", [{ id: "blinky" }]),
    "",
    "a template this SDK does not ship must not survive: it reaches Confirm " +
      'as a raw id and Create fails with "was not found".',
  );
});

test("a pending catalogue is not treated as an empty one", () => {
  assert.equal(
    reconcileTemplateSelection("blinky", null),
    "blinky",
    "null means the catalogue is still in flight. Judging the selection " +
      "against it would clear the answer on EVERY reload, including the ones " +
      "that would have kept it.",
  );
});

test("an empty selection stays empty in every catalogue state", () => {
  for (const catalogue of [CATALOGUE, [], null]) {
    assert.equal(reconcileTemplateSelection("", catalogue), "");
  }
});

test("an arrived-but-empty catalogue drops the selection", () => {
  assert.equal(
    reconcileTemplateSelection("blinky", []),
    "",
    "an empty ARRAY is an answer — this SDK ships nothing — unlike null, " +
      "which is the absence of one.",
  );
});

// ── how the view uses it ────────────────────────────────────────────────────

test("the view reconciles rather than clearing on every catalogue change", () => {
  assert.ok(
    /reconcileTemplateSelection\(selectedTemplate, projectTemplates\)/.test(
      VIEW,
    ),
    "the view no longer runs the selection through the shared rule. Clearing " +
      "unconditionally on a catalogue change would lose the answer on every " +
      "SDK switch, which is the failure #582 records for the Cores step.",
  );
});

test("a dropped selection sends the customer back to the template step", () => {
  assert.ok(
    /goTo\(TEMPLATE_STEP_INDEX\)/.test(VIEW),
    "nothing returns to the template step after a drop. The customer would " +
      "reach Confirm with an empty Template row and no way to know where the " +
      "choice went.",
  );
  assert.ok(
    /TEMPLATE_STEP_INDEX = STEPS\.findIndex/.test(VIEW),
    "the template step is addressed by a hardcoded index. The host already " +
      "addresses steps by id for this reason (#530) — a step inserted before " +
      "it would silently send people to the wrong screen.",
  );
});

test("the notice names the template, and the title is captured before it is gone", () => {
  assert.ok(
    /selectedTitleRef\.current = /.test(VIEW),
    "the selected template's title is no longer remembered at selection " +
      "time. It cannot be looked up after the drop — the whole point is that " +
      "the template is no longer in the catalogue — so the notice would fall " +
      "back to echoing a raw id.",
  );
  assert.ok(
    /does not ship/.test(VIEW),
    "the notice text is gone; a silently cleared selection is the behaviour " +
      "this issue is about.",
  );
});

test("picking again clears the notice", () => {
  const at = VIEW.indexOf("function handleSelectTemplate");
  assert.ok(at !== -1, "the selection handler is gone");
  const body = VIEW.slice(at, VIEW.indexOf("\n  }", at));
  assert.ok(
    /setDroppedTemplate\(null\)/.test(body),
    "choosing a new template leaves the notice up, so it keeps explaining a " +
      "choice the customer has already replaced.",
  );
});
