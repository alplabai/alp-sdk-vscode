// SPDX-License-Identifier: Apache-2.0
//
// Pulling an ALP-Bxxx diagnostic code back out of a `tan validate` issue
// message (#617). See `packages/alp-core/src/validation/diagnosticCode.ts`
// for the measured shape this reads and why the regex is anchored this
// strictly.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractDiagnosticCode,
  extractDiagnosticCodes,
} = require("../packages/alp-core/dist/validation/diagnosticCode.js");

// ---------------------------------------------------------------------------
// extractDiagnosticCode
// ---------------------------------------------------------------------------

test("pulls the code out of the measured ALP-B002 message", () => {
  assert.equal(
    extractDiagnosticCode(
      "ALP-B002: unknown key 'totally_unknown_key'\n  see: docs/diagnostics/ALP-B002.md",
    ),
    "ALP-B002",
  );
});

test("pulls the code out of the measured ALP-B003 message", () => {
  assert.equal(
    extractDiagnosticCode(
      "ALP-B003: 'verbose' is not one of ['error','warn','info','debug','trace']\n  hint: ...\n  see: docs/diagnostics/ALP-B003.md",
    ),
    "ALP-B003",
  );
});

test("finds the code wherever it sits in the message, not only at the start", () => {
  assert.equal(
    extractDiagnosticCode("west failed: see ALP-B005 for the reason"),
    "ALP-B005",
  );
});

test("a message with no code is a miss, not an error", () => {
  assert.equal(extractDiagnosticCode("board.yaml: something went wrong"), null);
  assert.equal(extractDiagnosticCode(""), null);
});

test("rejects a digit count other than exactly three (the strict anchor)", () => {
  // \d{3} consumes exactly three digits; a fourth adjacent digit means the
  // match position has no word boundary after it, so it must not partially
  // match "ALP-B123" out of "ALP-B1234".
  assert.equal(extractDiagnosticCode("ALP-B1234: too many digits"), null);
  // Two digits never reaches the quantifier at all.
  assert.equal(extractDiagnosticCode("ALP-B02: too few digits"), null);
});

test("rejects a lowercase spelling — the documented shape is uppercase", () => {
  assert.equal(extractDiagnosticCode("alp-b002: unknown key"), null);
});

test("rejects an unanchored prefix that merely contains the shape", () => {
  // "REALP-B002" has "ALP-B002" as a substring but not on a word boundary at
  // its start (the preceding "RE" is a word character), so \b must refuse it.
  assert.equal(extractDiagnosticCode("REALP-B002 nonsense"), null);
});

// ---------------------------------------------------------------------------
// extractDiagnosticCodes
// ---------------------------------------------------------------------------

test("the measured two-error board.yaml yields both codes, in order", () => {
  assert.deepEqual(
    extractDiagnosticCodes([
      "ALP-B002: unknown key 'totally_unknown_key'\n  see: docs/diagnostics/ALP-B002.md",
      "ALP-B003: 'verbose' is not one of ['error','warn','info','debug','trace']\n  hint: ...\n  see: docs/diagnostics/ALP-B003.md",
    ]),
    ["ALP-B002", "ALP-B003"],
  );
});

test("a repeated code is not offered twice", () => {
  assert.deepEqual(
    extractDiagnosticCodes([
      "ALP-B002: unknown key 'a'",
      "ALP-B002: unknown key 'b'",
    ]),
    ["ALP-B002"],
  );
});

test("messages with no code contribute nothing, and do not throw", () => {
  assert.deepEqual(
    extractDiagnosticCodes([
      "board.yaml: something went wrong",
      "ALP-B002: unknown key 'x'",
      "",
    ]),
    ["ALP-B002"],
  );
});

test("an empty issue list yields an empty code list", () => {
  assert.deepEqual(extractDiagnosticCodes([]), []);
});
