// SPDX-License-Identifier: Apache-2.0
//
// Which heading an SDK example renders under (#482 §1/§2).
//
// The rule has one safety property worth more than the rest: an explicit
// `category` from tan ALWAYS wins over anything derived here. tan's envelope
// does not carry one today — measured against the pinned v0.6.0-rc1's own
// published `envelope-contract.json`, whose `examples-catalog` entry offers
// exactly `id`, `sourceDir`, `title`, `description` — so the leading segment of
// `sourceDir` stands in. The day the producer sends the fact outright, this
// stops guessing with no code change, and these tests are what pin that
// ordering rather than leaving it to a reviewer to notice.
//
// The derivation is not a guess about the SDK's taxonomy either: it is measured
// against the SDK's own catalogue below.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  exampleCategory,
} = require("../packages/alp-core/dist/examples/category.js");

// ---------------------------------------------------------------------------
// The ordering that makes this safe
// ---------------------------------------------------------------------------

test("tan's own category always wins over the derived one", () => {
  // Arrange -- the producer disagreeing with the directory is the case this
  // whole design defers on. If the fallback ever won, a tan that started
  // sending categories would be silently overruled by a path segment.
  assert.equal(
    exampleCategory({
      id: "multicore/rpmsg-v2n",
      sourceDir: "multicore/rpmsg-v2n",
      category: "connectivity",
    }),
    "connectivity",
  );
});

test("an empty or blank category is not an answer, so the fallback runs", () => {
  // Arrange -- `""` and `"   "` are what an envelope carries when a field
  // exists but was never populated. Treating them as a category would put a
  // heading with no name on screen.
  for (const category of ["", "   ", null, undefined]) {
    assert.equal(
      exampleCategory({ id: "ai/x", sourceDir: "ai/x", category }),
      "ai",
      `category ${JSON.stringify(category)} must fall through`,
    );
  }
});

test("the category is the leading segment of sourceDir", () => {
  assert.equal(
    exampleCategory({
      id: "multicore/rpmsg-v2n",
      sourceDir: "multicore/rpmsg-v2n",
    }),
    "multicore",
  );
  assert.equal(
    exampleCategory({ id: "x", sourceDir: "peripheral-io/i2c-scan" }),
    "peripheral-io",
  );
});

test("`id` is the fallback when there is no sourceDir", () => {
  // Arrange -- `sourceDir` is optional on the wire; `id` carries the same
  // shape on every row the pinned tan emits.
  assert.equal(exampleCategory({ id: "audio/i2s-loopback" }), "audio");
  assert.equal(
    exampleCategory({ id: "audio/i2s-loopback", sourceDir: null }),
    "audio",
  );
});

test("an example with no directory has NO category, rather than an invented one", () => {
  // Arrange -- `null` is a real answer the view renders as "no heading".
  // Returning "Other" or "Uncategorised" would put a name on screen that
  // exists nowhere in the SDK.
  for (const source of [
    { id: "blinky" },
    { id: "blinky", sourceDir: "blinky" },
    { id: "blinky", sourceDir: "" },
    { id: "/leading-slash-only" },
  ]) {
    assert.equal(
      exampleCategory(source),
      null,
      `${JSON.stringify(source)} must not be given a heading`,
    );
  }
});

test("a Windows separator is normalised, not treated as one long segment", () => {
  // Arrange -- `sourceDir` is a relative path the producer built; a
  // Windows-built catalogue can hand back backslashes, and splitting only on
  // `/` would make the whole path the category.
  assert.equal(
    exampleCategory({ id: "x", sourceDir: "camera-vision\\qcif-stream" }),
    "camera-vision",
  );
});

// ---------------------------------------------------------------------------
// The derivation, measured against the SDK's own catalogue
// ---------------------------------------------------------------------------

test("every example in the vendored SDK catalogue derives its real category", () => {
  // Arrange -- the oracle. `metadata/catalog.json` groups the examples BY
  // category and each entry carries `path: examples/<category>/<name>`; tan's
  // `sourceDir` is that path with the `examples/` prefix dropped. This asserts
  // the two agree for every entry, so the fallback is a measured property of
  // the SDK's layout rather than a guess about it.
  //
  // Read here as a TEST ORACLE only. Nothing in `src/` or `packages/alp-core/`
  // opens this file: SDK metadata reaches the extension through the CLI, and a
  // second filesystem scanner is what that rule exists to prevent.
  const catalogPath = path.join(
    __dirname,
    "..",
    "alp-sdk-upstream",
    "metadata",
    "catalog.json",
  );
  if (!fs.existsSync(catalogPath)) {
    // The submodule is not checked out. Skipping is correct — this is an
    // oracle, and every rule above is asserted without it.
    return;
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const entries = Object.entries(catalog.examples ?? {});
  assert.ok(
    entries.length >= 10,
    `the catalogue produced ${entries.length} categories — the oracle is not being read`,
  );

  let checked = 0;
  for (const [category, list] of entries) {
    for (const example of list) {
      // `examples/aen/aen-analog-validate` -> `aen/aen-analog-validate`
      const sourceDir = String(example.path).replace(/^examples\//, "");
      assert.equal(
        exampleCategory({ id: sourceDir, sourceDir }),
        category,
        `${example.path} should derive "${category}"`,
      );
      checked += 1;
    }
  }
  assert.ok(
    checked >= 50,
    `only ${checked} examples were checked — the oracle is nearly empty`,
  );
});

// ---------------------------------------------------------------------------
// The view no longer keeps its own copy of the rule
// ---------------------------------------------------------------------------

test("the panel actually assigns the group it computes", () => {
  // Arrange -- closes a hole found by mutation: deleting the `group` assignment
  // in the panel left every example ungrouped and reddened NOTHING. The pure
  // rule above is well covered, and the view guard below only checks the view;
  // between them sat the one line that connects the two.
  //
  // SOURCE-LEVEL, and weaker than a behavioural test would be: driving
  // `newProjectFlowPanel` needs a harness no test in this repo has yet, and a
  // guard that catches the line being deleted is worth more than one that does
  // not exist. If that harness ever lands, replace this.
  const panel = fs.readFileSync(
    path.join(__dirname, "..", "src", "ideHub", "newProjectFlowPanel.ts"),
    "utf8",
  );
  assert.match(
    panel,
    /exampleCategory\(ex\)/,
    "the panel should derive each example's category through the shared rule",
  );
  assert.match(
    panel,
    /^\s*group,$/m,
    "the panel computes a group but never puts it on the template, so every " +
      "example would render ungrouped",
  );
});

test("the wizard reads the host-computed group, not a second split of its own", () => {
  // Arrange -- the view used to re-split `sourceDir` inline, which was a
  // second copy of this rule that could not defer to tan's `category`. Two
  // copies of one rule is the drift class test/webview.payloadMirror.test.js
  // exists for, and a VALUE like this one is invisible to it.
  const view = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "packages",
      "alp-webview",
      "src",
      "features",
      "new-project-flow",
      "NewProjectFlowView.tsx",
    ),
    "utf8",
  );
  assert.ok(
    !/sourceDir\?\.split\(/.test(view),
    "NewProjectFlowView is splitting `sourceDir` again — use the host's " +
      "`template.group`, which defers to tan's own category when it sends one",
  );
  assert.match(
    view,
    /t\.group/,
    "the view should be reading the host-computed group",
  );
});
