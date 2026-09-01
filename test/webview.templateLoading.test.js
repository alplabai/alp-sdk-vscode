// SPDX-License-Identifier: Apache-2.0
//
// The project-type step has to say "still loading", and the shimmer that says
// it has to stop for someone who asked for less motion.
//
// Two failures this closes:
//
//  1. `NewProjectFlowView` collapsed the catalogue's tri-state with
//     `projectTemplates ?? []`, so "the message has not arrived" and "tan
//     returned nothing" rendered identically: an empty screen under "Choose a
//     project type". Starters and examples travel in ONE `projectTemplatesData`
//     message, so the whole step is blank during the wait, not just Examples.
//     The distinction must stay keyed on `projectTemplates === null` — deriving
//     it from `templates.length === 0` instead would shimmer forever against an
//     SDK that genuinely ships no templates.
//
//  2. DESIGN.md says the Skeleton shimmer "stops entirely under
//     prefers-reduced-motion". It did not. The animation's 1.5s is a literal,
//     not a `--duration-*` token, so the blanket 0ms override in tokens.css
//     never reached it. That was one looping gradient before this change and
//     would have become one per placeholder card after it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "packages", "alp-webview", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const FLOW_REL = "features/new-project-flow/NewProjectFlowView.tsx";
const SKELETON_CSS_REL = "shared/ui/Skeleton/Skeleton.module.css";

test("the step's loading flag comes from the message, not from an empty list", () => {
  const src = read(FLOW_REL);
  assert.ok(
    /loading=\{projectTemplates === null\}/.test(src),
    "TemplateStep is no longer told to load from `projectTemplates === null`. " +
      "That null is the only signal that says the catalogue message has not " +
      "arrived; anything derived from the array's length cannot tell a " +
      "pending fetch from an SDK that ships nothing, and would shimmer forever.",
  );
  assert.ok(
    !/loading=\{[^}]*\.length[^}]*\}/.test(src),
    "the loading flag is derived from a list length. An SDK with no " +
      "templates would then load forever.",
  );
});

test("a loading step draws placeholders for BOTH groups", () => {
  const src = read(FLOW_REL);
  const guard = src.indexOf("if (loading)");
  assert.ok(guard !== -1, "TemplateStep no longer short-circuits on `loading`");
  const body = src.slice(guard, guard + 500);
  for (const label of ["Starters", "Examples"]) {
    assert.ok(
      new RegExp(`TemplateSkeletonGroup label="${label}"`).test(body),
      `the loading branch draws no placeholder for ${label}. Both groups ` +
        "arrive in one message, so showing only one of them claims this SDK " +
        "ships none of the other.",
    );
  }
});

test("placeholder cards reuse the real card's geometry", () => {
  const src = read(FLOW_REL);
  const group = src.indexOf("function TemplateSkeletonGroup");
  assert.ok(group !== -1, "TemplateSkeletonGroup is gone");
  const body = src.slice(group, src.indexOf("interface TemplateStepProps"));
  assert.ok(
    /styles\.templateGrid/.test(body) && /styles\.templateCard/.test(body),
    "the placeholders no longer reuse .templateGrid/.templateCard. Their " +
      "whole point is that the real cards land on the same geometry — a " +
      "bespoke placeholder size makes the layout jump on arrival.",
  );
  assert.ok(
    /aria-hidden="true"/.test(body) && /role="status"/.test(body),
    "the placeholder group lost its role=status wrapper or its aria-hidden " +
      "cards, so a screen reader is either told nothing or read six empty " +
      "cards.",
  );
});

test("the shimmer stops under prefers-reduced-motion", () => {
  // Comments stripped first: the previous version of this arm asked only
  // whether ".line" appeared inside the media block, which a comment saying
  // "/* .line left shimmering */" satisfies while .line keeps animating.
  const css = read(SKELETON_CSS_REL).replace(/\/\*[\s\S]*?\*\//g, " ");
  const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(
    at !== -1,
    "Skeleton.module.css has no prefers-reduced-motion block. The shimmer's " +
      "duration is a literal 1.5s, so the --duration-*: 0ms override in " +
      "tokens.css does NOT reach it, and DESIGN.md's claim that this stops " +
      "entirely becomes false again.",
  );
  // Every `selectors { body }` rule inside the media block.
  const body = css.slice(css.indexOf("{", at) + 1);
  const stopped = new Set();
  for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/animation:\s*none/.test(rule[2])) continue;
    for (const sel of rule[1].split(",")) stopped.add(sel.trim());
  }
  for (const selector of [".skeleton", ".line"]) {
    assert.ok(
      stopped.has(selector),
      `${selector} is not in the selector list of a rule that sets ` +
        "`animation: none` under reduced motion. `.line` is the multi-line " +
        "variant — most placeholders on screen — so covering only part of " +
        "the component is worse than not claiming to cover it.",
    );
  }
});

test("a lines placeholder fills its parent instead of collapsing to nothing", () => {
  const css = read(SKELETON_CSS_REL).replace(/\/\*[\s\S]*?\*\//g, " ");
  const at = css.indexOf(".block");
  assert.ok(at !== -1, ".block is gone");
  const rule = css.slice(at, css.indexOf("}", at));
  assert.ok(
    /width:\s*100%/.test(rule),
    "`.block` no longer fills its parent. Its children are EMPTY divs sized " +
      "in percentages, so they contribute no intrinsic width: in a parent " +
      "that does not stretch its items (`align-items: flex-start`, which the " +
      "template cards use) the block shrink-to-fits to 0px and the lines take " +
      "vertical space while painting nothing. Measured in a browser before " +
      "this rule existed: block 0px, both lines 0px, 36px tall.",
  );
});

test("an explicit Skeleton height is not floored by the min-height", () => {
  const tsx = read("shared/ui/Skeleton/Skeleton.tsx");
  assert.ok(
    /minHeight:\s*height/.test(tsx),
    "`.skeleton` carries `min-height: 16px` for the no-height case, so an " +
      "explicit smaller height is silently raised to 16px — a caller asking " +
      "for 12px to match real content gets geometry it did not ask for, and " +
      "the placeholder stops matching what replaces it.",
  );
});

test("the template catalogue goes back to pending before it is re-fetched", () => {
  const flow = read(FLOW_REL);
  const post = flow.indexOf('type: "reloadProjectTemplates"');
  assert.ok(post !== -1, "the catalogue re-fetch is gone");
  const before = flow.slice(0, post);
  assert.ok(
    /beginTemplateReload\(\)/.test(
      before.slice(before.lastIndexOf("function handleSelectSdk")),
    ),
    "the SDK change re-fetches the catalogue without putting it back to " +
      "pending first. `projectTemplates === null` is then true exactly ONCE " +
      "per panel, so every later fetch renders the PREVIOUS SDK's templates " +
      "as final and selectable — and stepping Back offers cards this SDK does " +
      'not ship, which fails as `alp init --from-example` "was not found".',
  );
  const ctx = read("shared/AppContext.tsx");
  assert.ok(
    !/beginTemplateReload[\s\S]{0,120}setE1mModules\(null\)/.test(ctx),
    "clearing the catalogue now also clears the module list. Those arrive in " +
      "the same message, and the Cores step rebuilds its defaults whenever " +
      "the module list changes identity — clearing it hands " +
      "reconcileCoreChoices an empty core list and wipes answers the customer " +
      "already gave (#582).",
  );
});
