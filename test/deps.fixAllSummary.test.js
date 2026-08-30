// SPDX-License-Identifier: Apache-2.0
//
// #603 (second adversarial pass), blocker 1: the Fix-all summary notice
// `deps/panel.ts` raises after a run finished silently dropped what a
// cancelled/raced-away row had already installed.
//
// Measured end to end: a 2-step `hostPrerequisites` row where step 1 (cmake)
// succeeds and step 2 never runs (cancelled) produces
// `{"installed":[],"failed":[],"skipped":[{"name":"hostPrerequisites",
// "reason":"cancelled","completed":["cmake"]}]}`. `outcome.failed` is EMPTY,
// so the panel took the `planSuccess` branch — `planSuccess(message, {
// detail })` with no `actions` renders on VS Code's STATUS BAR, which shows
// only `message`; `detail` is written to the "Alp SDK" output channel and
// never reaches the customer at all (`src/notify/vscodeAdapter.ts`'s own doc:
// "the ONLY place `detail` is ever written"). The customer read
// "Fix all: 0 of 1 installed" for a machine that now has cmake on it.
//
// SOURCE-LEVEL, for the same reason `deps.rowConsent.test.js` gives:
// `DependencyPanel`'s constructor builds a live `vscode.window
// .createWebviewPanel`, so instantiating it here would test the webview
// harness rather than the gate. `withFixAllPartialNote` itself — the pure
// function that carries `completed` into the sentence — is value-tested in
// `test/deps.fixAll.test.js`; what this file pins is that `runFixAll` (the
// panel's private method) actually feeds it to the CUSTOMER-VISIBLE argument
// (`planSuccess`'s `message`, `planFailure`'s `cause`) and not to `detail`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "deps", "panel.ts"),
  "utf8",
);

/** The body of the panel's private `runFixAll` method. */
function runFixAllBody() {
  const start = SOURCE.indexOf("private async runFixAll(): Promise<void> {");
  assert.notEqual(start, -1, "runFixAll must exist as a private method");
  const end = SOURCE.indexOf("\n  private ", start + 1);
  return SOURCE.slice(start, end === -1 ? undefined : end);
}

test("the planSuccess message carries withFixAllPartialNote, not just the bare count", () => {
  const body = runFixAllBody();

  assert.match(
    body,
    /planSuccess\(\s*withFixAllPartialNote\(/,
    "planSuccess's message argument must be built through withFixAllPartialNote — " +
      "a bare `Fix all: N of M installed` string drops what a cancelled row " +
      "already completed",
  );
});

test("the planFailure cause carries withFixAllPartialNote too", () => {
  const body = runFixAllBody();

  assert.match(
    body,
    /cause:\s*withFixAllPartialNote\(/,
    "planFailure's cause must ALSO be built through withFixAllPartialNote — " +
      "the failure branch can just as easily follow a partial completion",
  );
});

test("detail stays the plain parts join — the note belongs on the customer-visible side, not the channel-only one", () => {
  const body = runFixAllBody();

  assert.match(
    body,
    /detail: parts\.join\(" · "\)/,
    "detail must still be the unwrapped parts join",
  );
  assert.doesNotMatch(
    body,
    /detail:\s*withFixAllPartialNote/,
    "the partial note must NOT be routed through `detail` — that is the " +
      "channel-only field the customer never sees on the status-bar path, " +
      "which is exactly how blocker 1 happened",
  );
});
