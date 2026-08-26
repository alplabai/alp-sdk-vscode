// SPDX-License-Identifier: Apache-2.0
//
// New Project has to lead Quick Actions on the Overview, and stay reachable in
// the sidebar no matter what is collapsed or open.
//
// Two failures this closes, both of which shipped:
//
//  1. On the Overview it was the SECOND button of the THIRD section. The
//     Overview builds two different action lists — one for a workspace that is
//     still being set up, one for a ready workspace — so "first" has to hold in
//     both; ordering the list you happen to be looking at is how the other one
//     drifts. A brief attempt to lift it out into a full-width CTA under the
//     brand was reverted: at the Hub's real width the button read as a slab,
//     which is why the invariant below is about ORDER inside Quick Actions and
//     not about a hero element.
//
//  2. In the sidebar it was rendered only when no `board.yaml` existed, inside
//     the "Project" section — and that section is `defaultOpen={boardYamlExists}`,
//     so the one case where the action was offered was the one case where its
//     section started COLLAPSED. Pinning the row above the first `<Section>` is
//     what makes it un-collapsible; a test that only counted occurrences would
//     have passed the whole time it was hidden.
//
// Source-level on purpose: what is being asserted is where a literal sits
// relative to other literals, which is a structural property of the file, not
// something a rendered snapshot states plainly.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "packages", "alp-webview", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const OVERVIEW_REL = "features/overview/OverviewView.tsx";
const SIDEBAR_REL = "features/sidebar-hub/SidebarHubView.tsx";
const COMMAND = "alp.newProjectWizard";

/** Every index at which the command id appears. */
function occurrences(src) {
  const out = [];
  let i = src.indexOf(COMMAND);
  while (i !== -1) {
    out.push(i);
    i = src.indexOf(COMMAND, i + 1);
  }
  return out;
}

/** The command id of the first entry of the action-list literal that starts at
 *  `anchor`, so "is it first?" is asked of the list rather than of the file. */
function firstCommandAfter(src, anchor) {
  const at = src.indexOf(anchor);
  assert.ok(at !== -1, `the action list anchored on \`${anchor}\` is gone`);
  const match = /command:\s*"([^"]+)"/.exec(src.slice(at));
  assert.ok(match, `no command found after \`${anchor}\``);
  return match[1];
}

test("New Project leads Quick Actions in BOTH workspace states", () => {
  const src = read(OVERVIEW_REL);
  // The setup-state list, and the ready-state list built inside the component.
  for (const anchor of [
    "const ACTIONS: ActionItem[] = [",
    "const actions: ActionItem[] = allReady",
  ]) {
    assert.equal(
      firstCommandAfter(src, anchor),
      COMMAND,
      `the list at \`${anchor}\` does not lead with New Project. Both lists ` +
        `have to lead with it: whichever one you are not looking at is the ` +
        `one that drifts.`,
    );
  }
});

test("the Overview offers it only through Quick Actions", () => {
  const src = read(OVERVIEW_REL);
  const hits = occurrences(src);
  assert.equal(
    hits.length,
    2,
    `the Overview references ${COMMAND} ${hits.length} times; it should be ` +
      "exactly twice — once per state list. A third is a second button on " +
      "screen at the same time, and a first-and-only means one state lost it.",
  );
  assert.ok(
    !/styles\.cta/.test(src),
    "the full-width CTA is back. It was reverted on purpose: at the Hub's " +
      "real width it renders as a slab across the panel.",
  );
});

test("the sidebar wires it exactly once, pinned above every section", () => {
  const src = read(SIDEBAR_REL);
  assert.equal(
    occurrences(src).length,
    1,
    "the sidebar references New Project more than once — a second copy is a " +
      "row that can drift from the pinned one.",
  );
  const at = occurrences(src)[0];
  const firstSection = src.indexOf("<Section");
  assert.ok(
    firstSection !== -1,
    "no <Section> found — the panel's shape moved",
  );
  assert.ok(
    at < firstSection,
    "New Project is wired inside (or after the start of) a collapsible " +
      "<Section>. Anything in a Section can be collapsed away, and the " +
      '"Project" section in particular defaults to collapsed when no project ' +
      "exists — which is exactly when this action matters most.",
  );
});

test("the sidebar no longer hides it once a project is open", () => {
  const src = read(SIDEBAR_REL);
  const pinned = src.indexOf("styles.pinnedAction");
  assert.ok(
    pinned !== -1,
    "the pinned wrapper is gone. New Project used to live inside a " +
      "boardYamlExists ternary in the Project section, which meant it " +
      "vanished the moment a project existed; the pinned wrapper is what " +
      "holds it in both states.",
  );
  const firstSection = src.indexOf("<Section");
  const region = src.slice(pinned, firstSection);
  assert.ok(
    region.includes(COMMAND),
    "the pinned wrapper no longer contains New Project — the row moved out " +
      "of the one place that cannot be collapsed or conditioned away.",
  );
  assert.ok(
    !/boardYamlExists|wsName/.test(region),
    "the pinned row is behind a workspace condition again. Whether a " +
      "board.yaml exists must not decide whether you can start a project.",
  );
});
