// SPDX-License-Identifier: Apache-2.0
//
// The single-row install path runs the SAME consent screen the Fix all does
// (#467 acceptance 1: "installing a toolchain from the dependency panel shows
// exactly one consent screen").
//
// Without this, the gate would have a quiet way around it: press "Fix all" and
// you are asked; press one row's own Install button and you are not. The set
// size is the only difference between the two paths, and a set of one is still
// software being installed on the customer's machine.
//
// SOURCE-LEVEL on purpose. `runRowAction` is a private method of
// `DependencyPanel`, whose constructor builds a live webview
// (`vscode.window.createWebviewPanel`) — instantiating it here would test the
// webview harness rather than the gate. The behaviour of the screen itself is
// covered for real in `test/deps.installConsent.test.js`; what is asserted here
// is only the ORDER of two calls in one function, which reads faithfully off
// the source.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "deps", "panel.ts"),
  "utf8",
);

/** The body of `runRowAction`, up to the closing of its dispatch call. */
function runRowActionBody() {
  const start = SOURCE.indexOf("private async runRowAction(");
  assert.notEqual(
    start,
    -1,
    "runRowAction must exist and be async — the consent screen is awaited",
  );
  const end = SOURCE.indexOf("\n  private ", start + 1);
  return SOURCE.slice(start, end === -1 ? undefined : end);
}

test("the row's install dispatch is gated on the consent screen", () => {
  // Arrange
  const body = runRowActionBody();

  // Act
  const consent = body.indexOf("confirmDependencyInstalls");
  const dispatch = body.indexOf("runDependencyAction({");

  // Assert -- both present, consent FIRST.
  assert.notEqual(
    consent,
    -1,
    "runRowAction must call confirmDependencyInstalls",
  );
  assert.notEqual(dispatch, -1, "runRowAction must still dispatch the action");
  assert.ok(
    consent < dispatch,
    "consent must be obtained before the action is dispatched",
  );
});

test("a declined or empty answer returns without dispatching", () => {
  // Arrange -- `null` (dismissed) and `[]` (answered, nothing checked) are
  // different answers and both mean "do not install".
  const body = runRowActionBody();

  // Act / Assert
  assert.match(
    body,
    /consented === null \|\| consented\.length === 0/,
    "both the dismissed and the none-checked answers must stop the dispatch",
  );
  assert.match(body, /return;/);
});

test("an open-docs row is exempt — it installs nothing", () => {
  // Arrange -- asking for consent to install, over a button that opens a web
  // page, would be asking about something that is not happening.
  const body = runRowActionBody();

  // Act / Assert
  assert.match(body, /effect !== "open-docs"/);
});

test("the awaited call is handed to fireAndForget, not left floating", () => {
  // Arrange -- `runRowAction` is now async and is called from the webview
  // message pump, which is sync. An unhandled rejection there is an extension
  // host error the customer sees as nothing at all.
  assert.match(
    SOURCE,
    /fireAndForget\(\s*this\.runRowAction\(msg\.name\),/,
    "the message pump must route the promise through fireAndForget",
  );
});
