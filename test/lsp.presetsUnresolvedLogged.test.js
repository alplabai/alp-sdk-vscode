// SPDX-License-Identifier: Apache-2.0
//
// `pushSdkCatalog`'s `presets` fetch (`src/lsp/client.ts`) used the old
// data-only `fetchEnvelopeData` (deleted, #611 follow-up — zero production
// callers once every site migrated), which dropped `issues[]`
// unconditionally — so `presets.sdk-root-unresolved` never reached even the
// "Alp SDK" channel on a background LSP catalog refresh, and a
// `kconfig --core` failure's issues were dropped the same way (#611).
//
// SOURCE-LEVEL, not a driven test: `pushSdkCatalog` is a private, unexported
// function in a file that imports `vscode-languageclient/node` at module
// scope. Every other test file that touches `src/lsp/client.ts` stubs the
// whole module rather than drive it for real
// (`test/extension.firstRun.test.js`, `test/extension.buildResultAction.
// test.js`, both: "lsp/client pulls in vscode-languageclient, which
// subclasses real ... for an hour") — this checks the source directly rather
// than building a fourth from-scratch vscode-languageclient harness for one
// log line. `unresolvedSdkReason` and `fetchEnvelopeResult` are exercised for
// real elsewhere (`test/alpCli.unresolvedSdkReason.test.js`,
// `test/alpCli.envelopeResult.test.js`); what is pinned here is that THIS
// file actually calls them instead of the data-only helper.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "lsp", "client.ts"),
  "utf8",
);

test("client.ts reads presets/kconfig through fetchEnvelopeResult", () => {
  // `fetchEnvelopeData` is DELETED (#611 follow-up) — this guards against a
  // regression re-introducing a same-named local helper that recreates the
  // same drop, not against importing a function that no longer exists to
  // import (that would already be a compile error).
  assert.doesNotMatch(
    SOURCE,
    /\bfetchEnvelopeData\b/,
    "no call site in this file may read data without also reading issues",
  );
  assert.match(
    SOURCE,
    /import\s*\{\s*fetchEnvelopeResult\s*\}\s*from\s*"\.\.\/alpCli\/envelope"/,
  );
});

test("the presets fetch shares the same unresolved-SDK check as the other two `presets` readers", () => {
  assert.match(
    SOURCE,
    /import\s*\{[^}]*PRESETS_SDK_ROOT_UNRESOLVED_CODE[^}]*\}\s*from\s*"\.\.\/alpCli\/service"/,
    "must import the shared code constant rather than an inline literal " +
      "(#611 point 2: three `presets` readers, three different readings)",
  );
  assert.match(
    SOURCE,
    /unresolvedSdkReason\(\s*\{\s*issues:\s*presetsResult\.issues\s*\}\s*,\s*PRESETS_SDK_ROOT_UNRESOLVED_CODE\s*,?\s*\)/,
  );
});

// Adversarial review (#611 follow-up): the two assertions above pin that
// `unresolvedSdkReason(...)` is CALLED, not that its result is ever LOGGED.
// Reproduced: replacing the `log(...)` call below with a no-op
// `void presetsUnresolvedReason;` left the whole suite green, including both
// tests above — `reason computed, never logged` is exactly the defect this
// file exists to catch, and neither assertion above notices it. This one
// requires the LOG CALL ITSELF, tied to the same variable the reason was
// assigned to, so a mutation that computes-and-discards it has nothing left
// to match.
test("the computed reason actually reaches log(), not just a variable", () => {
  assert.match(
    SOURCE,
    /if \(presetsUnresolvedReason\) \{\s*log\(`\[lsp\] presets: \$\{presetsUnresolvedReason\}`\);\s*\}/,
    "presetsUnresolvedReason must be passed to log() inside its own guard — " +
      "computing it and never logging it (e.g. `void presetsUnresolvedReason;`) " +
      "must fail this assertion",
  );
});

test("a kconfig --core fetch's issues reach the channel", () => {
  const fnStart = SOURCE.indexOf("async function fetchOpenPrjConfKconfig");
  assert.notEqual(fnStart, -1, "fetchOpenPrjConfKconfig must still exist");
  const body = SOURCE.slice(fnStart, SOURCE.indexOf("\n}\n", fnStart));

  assert.match(
    body,
    /fetchEnvelopeResult\(/,
    "must call fetchEnvelopeResult so a failing kconfig lookup's issues are " +
      "not silently dropped the way fetchEnvelopeData dropped them",
  );
  assert.match(
    body,
    /result\.issues/,
    "the fetched issues must actually be read, not only the data",
  );
  assert.match(
    body,
    /log\(\s*`\[lsp\] kconfig --core \$\{coreId\}: \$\{issue\.severity\}: \$\{issue\.message\}`,?\s*\)/,
    "each issue's message must actually reach log(), not merely be iterated",
  );
});
