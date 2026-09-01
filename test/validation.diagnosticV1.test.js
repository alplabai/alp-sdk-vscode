// SPDX-License-Identifier: Apache-2.0
//
// `tan validate --format diagnostic-v1`, parsed from its measured shape.
//
// Everything asserted here was recorded from the PINNED tan 0.6.0, because
// this format breaks three rules the rest of tan follows:
//
//   1. It does NOT emit the envelope. The top level is
//      `{schemaVersion, tool, diagnostics}` — no `command`/`ok`/`exitCode`/
//      `data`/`issues`. Envelope-parsing code pointed at it finds nothing.
//   2. `schemaVersion` is the NUMBER 1 here, while the json envelope's
//      `data.schemaVersion` is the STRING "1".
//   3. Codes come in two spellings: tan's own structural checks report
//      `validate-schema-violation` (hyphenated), while the SDK-backed
//      validator reports `ALP-B002` (the diagnostic catalogue). A classifier
//      that knows only one of them silently matches nothing.
//
// Ranges are 0-based (LSP convention); `ValidationIssue.line`/`col` are
// 1-based (they were defined for the `--> board.yaml:LINE:COL` arrow). The
// conversion is the whole reason this parser exists rather than a cast.
//
// The zero-width range at the origin is tan saying "I have no location", not
// "line 1". `--offline` returns `0,0 -> 0,0` for every failure it reports, so
// treating it as a real position would pin every offline diagnostic to the
// first line — worse than the prose scan it would displace.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createTanValidateArgs,
  parseDiagnosticV1,
} = require("../packages/alp-core/dist/validation/diagnosticV1.js");

test("createTanValidateArgs names the format and the file, with the SDK root global", () => {
  assert.deepEqual(
    createTanValidateArgs("/Users/x/.alp/sdk/v0.16.0-rc1", "/w/board.yaml"),
    [
      "--sdk-root",
      "/Users/x/.alp/sdk/v0.16.0-rc1",
      "validate",
      "--format",
      "diagnostic-v1",
      "--board-yaml",
      "/w/board.yaml",
    ],
    "--sdk-root must sit BEFORE the subcommand: that pre-subcommand position is the one tan's own reorder shim supports",
  );
});

test("createTanValidateArgs omits --sdk-root when there is none to name", () => {
  assert.deepEqual(createTanValidateArgs(null, "/w/board.yaml"), [
    "validate",
    "--format",
    "diagnostic-v1",
    "--board-yaml",
    "/w/board.yaml",
  ]);
});

test("createTanValidateArgs never passes --offline", () => {
  // Measured: `--offline` accepts an unknown top-level key (`not_a_key: 3`) at
  // exit 0 with an EMPTY diagnostics list; only the SDK-backed path reports it
  // (ALP-B002). Falling back to offline would weaken validation in silence.
  assert.ok(
    !createTanValidateArgs("/sdk", "/w/board.yaml").includes("--offline"),
  );
  assert.ok(
    !createTanValidateArgs(null, "/w/board.yaml").includes("--offline"),
  );
});

const SDK_BACKED = JSON.stringify({
  schemaVersion: 1,
  tool: { name: "tan", version: "0.6.0" },
  diagnostics: [
    {
      uri: "/w/board.yaml",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 9 },
      },
      severity: "error",
      code: "ALP-B002",
      message: "unknown key 'not_a_key'",
      documentationUri: "docs/diagnostics/ALP-B002.md",
    },
  ],
});

test("an SDK-backed diagnostic keeps its code and converts its range to 1-based", () => {
  const result = parseDiagnosticV1(SDK_BACKED, 2);

  assert.equal(result.outcome, "schema-violation");
  assert.deepEqual(result.issues, [
    {
      message: "unknown key 'not_a_key'",
      severity: "error",
      code: "ALP-B002",
      line: 4,
      col: 1,
    },
  ]);
});

test("the hyphenated structural code is kept verbatim, not rewritten", () => {
  const offline = JSON.stringify({
    schemaVersion: 1,
    tool: { name: "tan", version: "0.6.0" },
    diagnostics: [
      {
        uri: "./board.yaml",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        severity: "error",
        code: "validate-schema-violation",
        message: "required key 'cores' is missing.",
      },
    ],
  });

  const result = parseDiagnosticV1(offline, 2);

  assert.equal(result.issues[0].code, "validate-schema-violation");
});

test("a zero-width range at the origin carries no location at all", () => {
  const stub = JSON.stringify({
    schemaVersion: 1,
    tool: { name: "tan", version: "0.6.0" },
    diagnostics: [
      {
        uri: "./board.yaml",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        severity: "error",
        code: "validate-board-yaml-missing",
        message: "no board.yaml found at ./board.yaml",
      },
    ],
  });

  const issue = parseDiagnosticV1(stub, 2).issues[0];

  assert.equal(issue.line, undefined, "no line, so the prose scan decides");
  assert.equal(issue.col, undefined);
});

test("a real range on line 1 is kept — it is not the stub", () => {
  const firstLine = JSON.stringify({
    schemaVersion: 1,
    tool: { name: "tan", version: "0.6.0" },
    diagnostics: [
      {
        uri: "./board.yaml",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 14 },
        },
        severity: "error",
        code: "ALP-B002",
        message: "unknown key 'schema_version'",
      },
    ],
  });

  assert.equal(parseDiagnosticV1(firstLine, 2).issues[0].line, 1);
});

test("no diagnostics and exit 0 is a clean verdict", () => {
  const clean = JSON.stringify({
    schemaVersion: 1,
    tool: { name: "tan", version: "0.6.0" },
    diagnostics: [],
  });

  assert.deepEqual(parseDiagnosticV1(clean, 0), {
    outcome: "clean",
    issues: [],
  });
});

test("severities map onto the validation vocabulary", () => {
  const payload = JSON.stringify({
    schemaVersion: 1,
    tool: { name: "tan", version: "0.6.0" },
    diagnostics: [
      { message: "a", severity: "error" },
      { message: "b", severity: "warning" },
      { message: "c", severity: "note" },
      { message: "d", severity: "something-new" },
    ],
  });

  assert.deepEqual(
    parseDiagnosticV1(payload, 2).issues.map((i) => i.severity),
    ["error", "warning", "suggestion", "error"],
  );
});

test("unparseable output is an infrastructure failure, never a clean file", () => {
  // A crashed or non-JSON run must not read as "board.yaml is fine".
  for (const output of [
    "",
    "Traceback (most recent call last):",
    "{not json",
  ]) {
    const result = parseDiagnosticV1(output, 2);
    assert.equal(result.outcome, "failed", `for ${JSON.stringify(output)}`);
  }
});

test("a non-zero exit with no diagnostics is still a failure", () => {
  const empty = JSON.stringify({ schemaVersion: 1, diagnostics: [] });

  assert.equal(parseDiagnosticV1(empty, 2).outcome, "failed");
});

test("diagnostics that are not objects are dropped, never coerced", () => {
  const messy = JSON.stringify({
    schemaVersion: 1,
    diagnostics: [null, 42, "boom", { message: "real", severity: "error" }],
  });

  assert.deepEqual(
    parseDiagnosticV1(messy, 2).issues.map((i) => i.message),
    ["real"],
  );
});

// ── The server must actually prefer tan, and never reach for --offline ─────
//
// A unit test on the parser stays green while nothing calls it, and the
// fallback is the part that is easy to get subtly wrong, so the wiring is
// gated in the source itself (the failure mode #566 hit).
const fs = require("node:fs");
const path = require("node:path");

function serverSource() {
  return fs.readFileSync(
    path.join(__dirname, "..", "src", "lsp", "server.ts"),
    "utf8",
  );
}

test("the server validates through tan when a CLI path was pushed", () => {
  const source = serverSource();

  assert.match(
    source,
    /createTanValidateArgs\(context\.sdkRoot,\s*filePath\)/,
    "board.yaml validation must go through tan validate when a CLI is available",
  );
  assert.match(
    source,
    /parseDiagnosticV1\(execution\.stdout,\s*execution\.status\)/,
    "the diagnostic-v1 payload must be parsed, not the envelope",
  );
});

test("the Python validator stays as the fallback", () => {
  // No resolved CLI must not mean no validation: the client pushes null when
  // nothing resolves (including a declined download), and the server has to
  // keep shelling the SDK's validator as it always did.
  const source = serverSource();

  assert.match(source, /createValidatorPlan\(context,\s*filePath\)/);
  assert.match(source, /analyzeValidationResult\(execution\)/);
});

test("nothing in the server asks tan for an offline validation", () => {
  // Measured: --offline accepts an unknown top-level key at exit 0 with an
  // empty diagnostics list. Degrading to it would weaken validation silently.
  assert.doesNotMatch(serverSource(), /"--offline"/);
});
