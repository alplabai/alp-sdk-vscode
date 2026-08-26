// SPDX-License-Identifier: Apache-2.0
//
// New Project has to stay the lead action on both surfaces, and stay reachable.
//
// Two failures this closes, both of which shipped:
//
//  1. The command was listed TWICE in the Overview — once in `ACTIONS` and
//     again in the ready-state array built inside the component — so the same
//     action could drift apart, or appear on screen twice once a CTA existed.
//     "Exactly once per surface" is the invariant; a second copy is not a
//     styling question, it is two buttons that can disagree.
//
//  2. In the sidebar it was rendered only when no `board.yaml` existed, inside
//     the "Project" section — and that section is `defaultOpen={boardYamlExists}`,
//     so the one case where the action was offered was the one case where its
//     section started COLLAPSED. Pinning the row above the first `<Section>` is
//     what makes it un-collapsible; a test that only counted occurrences would
//     have passed the whole time it was hidden.
//
// Source-level on purpose: what is being asserted is where the JSX sits
// relative to other JSX, which is a structural property of the file, not
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

test("New Project is wired exactly once per surface", () => {
  for (const rel of [OVERVIEW_REL, SIDEBAR_REL]) {
    const hits = occurrences(read(rel));
    assert.equal(
      hits.length,
      1,
      `${rel} references ${COMMAND} ${hits.length} times. It must be wired ` +
        "once: a second copy is a button that can drift from the first, and " +
        "it is how the same action ended up in two places on the Overview.",
    );
  }
});

test("the Overview wires it above the lead paragraph, not in Quick Actions", () => {
  const src = read(OVERVIEW_REL);
  const at = occurrences(src)[0];
  const lead = src.indexOf("styles.lead");
  assert.ok(lead !== -1, "styles.lead is gone — this arm's landmark moved");
  assert.ok(
    at < lead,
    "New Project is wired after the lead paragraph, so it is no longer the " +
      "page's first action. It belongs in the CTA above the prose; putting " +
      "it back in a section is what buried it before.",
  );
  assert.ok(
    !/label:\s*"New Project"/.test(src),
    "New Project is back in an action-list literal. It renders as the CTA " +
      "now; listing it as well puts the same command on screen twice.",
  );
});

test("the sidebar pins it above every collapsible section", () => {
  const src = read(SIDEBAR_REL);
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
