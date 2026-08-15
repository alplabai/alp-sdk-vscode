// SPDX-License-Identifier: Apache-2.0
//
// The state word — Ready / Will install / Needs you / Unknown (#466 §1).
//
// The panel is opened to answer one question: do I have to do something? tan's
// `pass` / `warn` / `fail` does not answer it. A `fail` the extension fixes
// with one press and a `fail` that needs the user to go install a vendor
// toolchain read identically, so the reader has to open every row to find out.
//
// The rule this must not break is `deps/planner.ts`'s: "tan owns the facts …
// it is never a TypeScript re-derivation — that is how tan-cli#104/#105
// happened." What makes the mapping legal is that **"Will install" is not a
// status, it is the presence of an action** — both halves are facts the
// producer already stated, and nothing here looks at `check.name`. The tests
// below pin exactly that: the same status maps to different words purely
// because the ACTION differs, and never because of which check it is.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { dependencyState } = require("../packages/alp-core/dist/deps/state.js");
const {
  planDependencyReport,
  TAN_ROW_NAME,
} = require("../packages/alp-core/dist/deps/planner.js");

const envelope = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "tan-doctor-build.v0.3.1.json"),
    "utf-8",
  ),
);
const data = envelope.data;

const plan = (over = {}) =>
  planDependencyReport({
    data,
    bootstrapRunning: false,
    cli: { installed: "0.3.1", latest: { version: "0.3.1", kind: "pin" } },
    compareVersions: () => "same",
    ...over,
  });

// ---------------------------------------------------------------------------
// The mapping itself
// ---------------------------------------------------------------------------

test("a passing check is Ready, whatever action it happens to carry", () => {
  // Arrange / Act / Assert -- `pass` wins outright. A passing row with a
  // leftover action must not advertise an install nobody needs.
  for (const effect of [null, "install", "open-docs", "bootstrap"]) {
    assert.equal(dependencyState("pass", effect), "ready");
  }
});

test("the SAME status splits on the action alone — the whole doctrine, in one test", () => {
  // Arrange -- this is what makes the mapping presentation rather than a
  // re-derivation: `fail` is one fact, and the word differs only because the
  // other fact (is there an installing action?) differs.
  assert.equal(dependencyState("fail", "install"), "will-install");
  assert.equal(dependencyState("fail", null), "needs-you");
  assert.equal(dependencyState("warn", "bootstrap"), "will-install");
  assert.equal(dependencyState("warn", null), "needs-you");
});

test("an action that only opens a page is NOT 'Will install'", () => {
  // Arrange -- `DependencyActionEffect`'s own docs: `open-docs` "opens a web
  // page and installs NOTHING". A row whose only button is a pointer is still
  // the user's job, and saying otherwise is a button that lies.
  assert.equal(dependencyState("fail", "open-docs"), "needs-you");
  assert.equal(dependencyState("warn", "open-docs"), "needs-you");
});

test("tan's own `unknown` stays unknown rather than collapsing into the three", () => {
  // Arrange -- #466's acceptance criteria name this case explicitly.
  for (const effect of [null, "install", "open-docs", "bootstrap"]) {
    assert.equal(dependencyState("unknown", effect), "unknown");
  }
});

test("a status tan has not shipped yet also lands on unknown, not on a guess", () => {
  // Arrange -- `DependencyStatus` is deliberately `string`, not a union, so
  // "a status tan adds later survives the trip instead of being coerced into
  // today's vocabulary". A three-word mapping with no escape would do exactly
  // that coercion. Whitelisting the settled statuses is what keeps the promise
  // for words nobody has written yet, not just for the literal `unknown`.
  for (const status of ["degraded", "skipped", "PASS", "", "n/a"]) {
    assert.equal(
      dependencyState(status, "install"),
      "unknown",
      `${JSON.stringify(status)} must not be labelled with confidence`,
    );
  }
});

// ---------------------------------------------------------------------------
// Wired into the planner
// ---------------------------------------------------------------------------

test("every row the planner emits carries a state", () => {
  // Arrange / Act
  const rows = plan().rows;

  // Assert -- membership, not a named list: a check tan adds tomorrow must get
  // a state for free, the same way it gets a row for free.
  const states = new Set(["ready", "will-install", "needs-you", "unknown"]);
  assert.ok(rows.length >= 5, "the fixture should produce a real table");
  for (const row of rows) {
    assert.ok(
      states.has(row.state),
      `row \`${row.name}\` has state ${JSON.stringify(row.state)}`,
    );
  }
});

test("a row's state agrees with the action the SAME row carries", () => {
  // Arrange / Act -- the planner resolves the action once and feeds it to both
  // the row and the state. Computing it twice is how a row ends up labelled
  // "Will install" with no button under it.
  for (const row of plan().rows) {
    // Assert
    assert.equal(
      row.state,
      dependencyState(row.status, row.action?.effect ?? null),
      `row \`${row.name}\` (${row.status}, ${row.action?.effect ?? "no action"})`,
    );
  }
});

test("tan's own status is still on the row, untouched", () => {
  // Arrange -- `state` is an EXTRA field. If it ever replaced `status`, the
  // panel would lose tan's word and this summary would be the only thing on
  // screen, which is precisely the coercion the planner forbids.
  const byName = new Map(plan().rows.map((row) => [row.name, row]));
  for (const check of data.checks) {
    assert.equal(byName.get(check.name)?.status, check.status);
  }
});

test("a mid-flight bootstrap moves rows to Needs you, not to Will install", () => {
  // Arrange -- `actionFor` returns null while a bootstrap runs, because "a
  // second installer racing it is how half-written workspaces happen". The
  // state has to follow: promising an install the panel has just decided not
  // to offer would be the label contradicting the button.
  const rows = plan({ bootstrapRunning: true }).rows;

  // Assert
  for (const row of rows) {
    assert.equal(row.action, null, `row \`${row.name}\` must offer no action`);
    if (["warn", "fail"].includes(row.status)) {
      assert.equal(row.state, "needs-you", `row \`${row.name}\``);
    }
  }
});

test("an unresolved tan CLI row reads Needs you, never Will install", () => {
  // Arrange -- the tan row deliberately carries no action: the resolver owns
  // that binary, not a button. By the time this panel paints the resolver has
  // already run, so a tan still missing means something outside it (offline, a
  // proxy, a refused download) needs the user.
  const rows = plan({
    cli: { installed: null, latest: { version: "0.5.1", kind: "pin" } },
  }).rows;
  const tan = rows.find((row) => row.name === TAN_ROW_NAME);

  // Assert
  assert.ok(tan, "the host-owned tan row must exist");
  assert.equal(tan.status, "fail");
  assert.equal(tan.action, null);
  assert.equal(tan.state, "needs-you");
});

test("a resolved tan CLI row reads Ready", () => {
  // Arrange / Act / Assert
  const tan = plan().rows.find((row) => row.name === TAN_ROW_NAME);
  assert.equal(tan.status, "pass");
  assert.equal(tan.state, "ready");
});

// ---------------------------------------------------------------------------
// The forbidden shape
// ---------------------------------------------------------------------------

test("the mapping cannot see which check it is looking at", () => {
  // Arrange -- the guard against the shape #466 warns about. `dependencyState`
  // takes two primitives and no name, so a per-check special case is not
  // something a reviewer has to notice: it is unrepresentable. Pinning the
  // arity keeps it that way — a third `name` parameter would red here first.
  assert.equal(
    dependencyState.length,
    2,
    "dependencyState took a new parameter; if it is a check name, that is the " +
      "re-derivation deps/planner.ts forbids",
  );
});

test("the state module names no check", () => {
  // Arrange -- the same guard, one level up: a lookup table keyed on
  // `west` / `ninja` / `zephyrSdk` inside the module would pass the arity test
  // above while being exactly the forbidden shape.
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "packages",
      "alp-core",
      "src",
      "deps",
      "state.ts",
    ),
    "utf8",
  );
  const body = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const check of data.checks) {
    assert.ok(
      !body.includes(check.name),
      `packages/alp-core/src/deps/state.ts mentions the check \`${check.name}\`. ` +
        `The state word is derived from the (status, action) pair and nothing ` +
        `else — a per-check branch is the re-derivation that produced ` +
        `tan-cli#104/#105.`,
    );
  }
});
