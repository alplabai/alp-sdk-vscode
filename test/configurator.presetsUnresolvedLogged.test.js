// SPDX-License-Identifier: Apache-2.0
//
// The board.yaml configurator's `presets` fetch used the old data-only
// `fetchEnvelopeData` (deleted, #611 follow-up — zero production callers
// once every site migrated), which dropped `issues[]` unconditionally — so
// `presets.sdk-root-unresolved` never reached even the "Alp SDK" channel
// when the library vocabulary scan stayed on the filesystem fallback (#611).
//
// SOURCE-LEVEL: `CustomTextEditorProvider.resolveCustomTextEditor` builds a
// live webview panel and document; no test file drives this class today.
// `unresolvedSdkReason`/`fetchEnvelopeResult` are exercised for real
// elsewhere; this pins that THIS file actually calls them instead of the
// data-only helper, the same technique `test/lsp.presetsUnresolvedLogged.
// test.js` uses for the sibling `presets` reader in `src/lsp/client.ts`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "configurator", "customEditor.ts"),
  "utf8",
);

test("customEditor.ts reads `presets` through fetchEnvelopeResult", () => {
  // `fetchEnvelopeData` is DELETED (#611 follow-up) — this guards against a
  // regression re-introducing a same-named local helper that recreates the
  // same drop, not against importing a function that no longer exists.
  assert.doesNotMatch(
    SOURCE,
    /\bfetchEnvelopeData\b/,
    "this file must read data without also reading issues",
  );
  assert.match(
    SOURCE,
    /import\s*\{\s*fetchEnvelopeResult\s*\}\s*from\s*"\.\.\/alpCli\/envelope"/,
  );
});

test("an unresolved-SDK presets warning reaches the channel here too", () => {
  assert.match(
    SOURCE,
    /import\s*\{[^}]*PRESETS_SDK_ROOT_UNRESOLVED_CODE[^}]*\}\s*from\s*"\.\.\/alpCli\/service"/,
    "must share the same code constant the other two `presets` readers use " +
      "(#611 point 2), not an inline literal",
  );
  assert.match(SOURCE, /unresolvedSdkReason\(/);
});

// Adversarial review (#611 follow-up): the assertion above pins that
// `unresolvedSdkReason(...)` is CALLED, not that its result is ever LOGGED.
// Reproduced: replacing the `log(...)` call below with a no-op `void reason;`
// left the whole suite green, including the test above — this one requires
// the LOG CALL ITSELF, tied to the same variable, so that mutation has
// nothing left to match.
test("the computed reason actually reaches log(), not just a variable", () => {
  assert.match(
    SOURCE,
    /if \(reason\) log\(`\[configurator\] presets: \$\{reason\}`\);/,
    "reason must be passed to log() — computing it and never logging it " +
      "(e.g. `void reason;`) must fail this assertion",
  );
});
