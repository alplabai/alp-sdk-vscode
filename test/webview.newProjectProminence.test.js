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

/** The text of the array literal that starts at the first `[` after `anchor`,
 *  brackets counted so a nested object does not end it early. */
function arrayLiteralAfter(src, anchor) {
  const at = src.indexOf(anchor);
  assert.ok(at !== -1, `the action list anchored on \`${anchor}\` is gone`);
  // From AFTER the anchor: the anchors contain `ActionItem[]`, whose own `[`
  // would otherwise be read as the array and yield an empty list.
  const open = src.indexOf("[", at + anchor.length);
  assert.ok(open !== -1, `no array literal follows \`${anchor}\``);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  assert.fail(`unterminated array literal after \`${anchor}\``);
}

/** The first element of an array literal's body, braces counted. */
function firstElementOf(body) {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) return body.slice(0, i).trim();
  }
  return body.trim();
}

/**
 * True when `element` is New Project — whether it is written inline or is an
 * identifier pointing at a shared const.
 *
 * The identifier arm matters: hoisting the entry both lists duplicate into one
 * `const` is the obvious correct refactor here, and an earlier version of this
 * arm failed it — it scanned for the next `command:` string after the anchor,
 * which skipped the identifier and matched the NEXT entry's literal instead. A
 * gate that punishes de-duplicating the duplication it mandates gets deleted,
 * and rightly.
 */
function elementIsNewProject(src, element) {
  if (element.includes(COMMAND)) return true;
  const identifier = /^[A-Za-z_$][\w$]*$/.exec(element);
  if (!identifier) return false;
  const at = src.indexOf(`const ${element}`);
  if (at === -1) return false;
  const semi = src.indexOf(";", at);
  return src.slice(at, semi === -1 ? undefined : semi).includes(COMMAND);
}

test("New Project leads Quick Actions in BOTH workspace states", () => {
  const src = read(OVERVIEW_REL);
  for (const anchor of [
    "const ACTIONS: ActionItem[] = ",
    "const actions: ActionItem[] = allReady",
  ]) {
    const first = firstElementOf(arrayLiteralAfter(src, anchor));
    assert.ok(
      elementIsNewProject(src, first),
      `the list at \`${anchor}\` leads with \`${first}\`, not New Project. ` +
        `Both lists have to lead with it: whichever one you are not looking ` +
        `at is the one that drifts.`,
    );
  }
});

test("nothing re-orders the actions between the list and the screen", () => {
  const src = read(OVERVIEW_REL);
  // Leading the source array means nothing if the render flips it back. This
  // is the hole the ordering arm above cannot see on its own.
  assert.ok(
    !/actions[^;]*\.(reverse|sort)\s*\(/.test(src),
    "the actions array is reversed or sorted before rendering, so leading " +
      "the literal no longer decides what the user sees first.",
  );
  const css = read("features/overview/OverviewView.module.css");
  const grid = css.slice(
    css.indexOf(".actionGrid"),
    css.indexOf("}", css.indexOf(".actionGrid")),
  );
  assert.ok(
    !/row-reverse|column-reverse|\border\b\s*:/.test(grid),
    "the action grid reverses or re-orders its items in CSS, which moves New " +
      "Project away from first without touching the array at all.",
  );
});

test("the Overview offers it only through Quick Actions", () => {
  const src = read(OVERVIEW_REL);
  assert.ok(
    !/styles\.cta/.test(src),
    "the full-width CTA is back. It was reverted on purpose: at the Hub's " +
      "real width it renders as a slab across the panel.",
  );
  // Deliberately NOT an occurrence count. Two inline copies and one shared
  // const are both correct shapes, and pinning the number outlaws the second.
  const inLists = [
    "const ACTIONS: ActionItem[] = ",
    "const actions: ActionItem[] = allReady",
  ].every(
    (anchor) =>
      arrayLiteralAfter(src, anchor).includes(COMMAND) ||
      elementIsNewProject(src, firstElementOf(arrayLiteralAfter(src, anchor))),
  );
  assert.ok(
    inLists,
    "New Project is no longer reachable from both action lists.",
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
  // The region starts at the header, NOT at the wrapper: a guard that re-hides
  // the row is written AROUND it, so a scan beginning at the wrapper reads the
  // guard as being outside itself and passes the exact regression it names.
  const header = src.indexOf("</header>");
  assert.ok(header !== -1, "the panel header is gone — landmark is stale");
  const firstSection = src.indexOf("<Section");
  const region = src.slice(header, firstSection);
  assert.ok(
    region.includes(COMMAND),
    "New Project is no longer wired between the header and the first " +
      "<Section> — it moved out of the one place that cannot be collapsed " +
      "or conditioned away.",
  );
  assert.ok(
    !/boardYamlExists|wsName/.test(region),
    "the pinned row is behind a workspace condition again. Whether a " +
      "board.yaml exists must not decide whether you can start a project.",
  );
});
