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
  const css = read(SKELETON_CSS_REL);
  const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(
    at !== -1,
    "Skeleton.module.css has no prefers-reduced-motion block. The shimmer's " +
      "duration is a literal 1.5s, so the --duration-*: 0ms override in " +
      "tokens.css does NOT reach it, and DESIGN.md's claim that this stops " +
      "entirely becomes false again.",
  );
  const block = css.slice(at, css.indexOf("}", css.indexOf("}", at) + 1) + 1);
  assert.ok(
    /animation:\s*none/.test(block),
    "the reduced-motion block does not stop the animation",
  );
  for (const selector of [".skeleton", ".line"]) {
    assert.ok(
      block.includes(selector),
      `${selector} keeps shimmering under reduced motion — the block covers ` +
        "only part of the component, which is worse than not claiming to.",
    );
  }
});
