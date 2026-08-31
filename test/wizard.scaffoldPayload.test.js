// SPDX-License-Identifier: Apache-2.0
//
// Reading `tan scaffold`'s answer (#601): the payload narrowing and the refusal
// classification, against envelopes CAPTURED from the pinned tan 0.6.0 rather
// than invented.
//
// Every `data`/`issues` literal below was produced by running the pinned binary
// (`.../globalStorage/alplabai.alp-sdk/cli/tan`, `tan 0.6.0`) against a scratch
// project scaffolded with `tan init --template zephyr-app --som E1M-AEN801`.
// Only the absolute paths were rewritten, to `/home/dev/proj`. That matters
// because the two things this file asserts — which fields exist, and which
// codes come back — are exactly the things a hand-typed fixture gets to decide
// for itself.
//
// What is NOT claimed: that these are the only codes `tan scaffold` can emit.
// They are the ones reachable from this extension's argv, measured. An
// unrecognised code answers `null` by design, so a code added upstream keeps
// tan's own reporting instead of being wrapped in a wrong sentence.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyScaffoldRefusal,
  isScaffoldNoOp,
  narrowScaffoldResult,
} = require("../packages/alp-core/dist/wizard/scaffoldPayload.js");

// ---------------------------------------------------------------------------
// Captured payloads
// ---------------------------------------------------------------------------

/** `tan scaffold --project <p> --template sensor-driver --name probesens
 *  --preview --non-interactive --format json` on a project with no such
 *  module. exit 0, ok: true. */
const PREVIEW_NEW = {
  schemaVersion: "1",
  templateId: "sensor-driver",
  moduleName: "probesens",
  normalizedModuleName: "probesens",
  destination: "/home/dev/proj",
  preview: true,
  fileChanges: [
    { relativePath: "include/modules/probesens.h", kind: "new" },
    { relativePath: "src/modules/probesens/probesens.c", kind: "new" },
    { relativePath: "src/modules/probesens/README.md", kind: "new" },
  ],
  written: [],
  unchanged: [],
};

/** The same argv without `--preview`, on the same project. exit 0, ok: true. */
const WRITE_NEW = {
  schemaVersion: "1",
  templateId: "sensor-driver",
  moduleName: "probesens",
  normalizedModuleName: "probesens",
  destination: "/home/dev/proj",
  preview: false,
  fileChanges: [
    { relativePath: "include/modules/probesens.h", kind: "new" },
    { relativePath: "src/modules/probesens/probesens.c", kind: "new" },
    { relativePath: "src/modules/probesens/README.md", kind: "new" },
  ],
  written: [
    "include/modules/probesens.h",
    "src/modules/probesens/probesens.c",
    "src/modules/probesens/README.md",
  ],
  unchanged: [],
};

/** Re-running the write with every file already byte-identical. exit 0,
 *  ok: true, `written: []` and three `unchanged` — the genuine no-op. */
const WRITE_ALL_UNCHANGED = {
  schemaVersion: "1",
  templateId: "sensor-driver",
  moduleName: "probesens",
  normalizedModuleName: "probesens",
  destination: "/home/dev/proj",
  preview: false,
  fileChanges: [
    { relativePath: "include/modules/probesens.h", kind: "unchanged" },
    { relativePath: "src/modules/probesens/probesens.c", kind: "unchanged" },
    { relativePath: "src/modules/probesens/README.md", kind: "unchanged" },
  ],
  written: [],
  unchanged: [
    "include/modules/probesens.h",
    "src/modules/probesens/probesens.c",
    "src/modules/probesens/README.md",
  ],
};

/** After appending a line to `probesens.c`, the write pass with no `--force`.
 *  exit 3, ok: false — and note it STILL carries `fileChanges[]` naming the
 *  offending path, which is what the overwrite confirm renders. */
const WOULD_OVERWRITE = {
  data: {
    schemaVersion: "1",
    templateId: "sensor-driver",
    moduleName: "probesens",
    normalizedModuleName: "probesens",
    destination: "/home/dev/proj",
    preview: false,
    fileChanges: [
      { relativePath: "include/modules/probesens.h", kind: "unchanged" },
      { relativePath: "src/modules/probesens/probesens.c", kind: "update" },
      { relativePath: "src/modules/probesens/README.md", kind: "unchanged" },
    ],
    written: [],
    unchanged: [],
  },
  issues: [
    {
      code: "scaffold.would-overwrite",
      severity: "error",
      message:
        "One or more files would be overwritten. Use --force to allow updates.",
    },
  ],
};

/** `--name ---`. exit 2, ok: false, and `data` is BLANKED — every string empty
 *  and every list `[]`, `project.root: null`. */
const INVALID_NAME = {
  data: {
    schemaVersion: "1",
    templateId: "",
    moduleName: "",
    normalizedModuleName: "",
    destination: "",
    preview: false,
    fileChanges: [],
    written: [],
    unchanged: [],
  },
  issues: [
    {
      code: "scaffold.invalid-name",
      severity: "error",
      message: "Module name is empty after normalization.",
    },
  ],
};

/** `--template nope`. exit 2, ok: false, `data` blanked the same way. */
const INVALID_TEMPLATE_ISSUES = [
  {
    code: "scaffold.invalid-template",
    severity: "error",
    message: "Unknown module template 'nope'.",
  },
];

/** `tan scaffold --non-interactive --format json` with no `--name`. exit 2. */
const NAME_REQUIRED_ISSUES = [
  {
    code: "scaffold.name-required",
    severity: "error",
    message: "Module name is required. Use --name <name> or run interactively.",
  },
];

// ---------------------------------------------------------------------------
// narrowScaffoldResult
// ---------------------------------------------------------------------------

test("a captured preview payload narrows to its file list with nothing written", () => {
  const result = narrowScaffoldResult(PREVIEW_NEW);
  assert.ok(result);
  assert.equal(result.normalizedModuleName, "probesens");
  assert.deepEqual(result.fileChanges, [
    { relativePath: "include/modules/probesens.h", kind: "new" },
    { relativePath: "src/modules/probesens/probesens.c", kind: "new" },
    { relativePath: "src/modules/probesens/README.md", kind: "new" },
  ]);
  assert.deepEqual(result.written, []);
});

test("a captured write payload narrows to the three paths tan reports writing", () => {
  const result = narrowScaffoldResult(WRITE_NEW);
  assert.ok(result);
  assert.deepEqual(result.written, [
    "include/modules/probesens.h",
    "src/modules/probesens/probesens.c",
    "src/modules/probesens/README.md",
  ]);
});

test("a payload with no `written` list is unreadable, not an empty success", () => {
  const { written: _dropped, ...renamed } = WRITE_NEW;
  assert.equal(
    narrowScaffoldResult({ ...renamed, files: WRITE_NEW.written }),
    null,
    "`written ?? []` is the exact shape that reported `Materialised 0 " +
      "file(s)` through a SUCCESS toast while a rename went unnoticed " +
      "(test/ideHub.materialiseGuard.test.js). A missing list must answer " +
      "`null` so the caller can say it could not read the result.",
  );
});

test("a payload with no `fileChanges` list is unreadable", () => {
  const { fileChanges: _dropped, ...renamed } = PREVIEW_NEW;
  assert.equal(narrowScaffoldResult(renamed), null);
});

test("a malformed file-change entry is DROPPED, never coerced", () => {
  const result = narrowScaffoldResult({
    ...PREVIEW_NEW,
    fileChanges: [
      { relativePath: "include/modules/probesens.h", kind: "new" },
      { relativePath: 42, kind: "new" },
      { relativePath: "src/modules/probesens/probesens.c" },
      null,
      "src/modules/probesens/README.md",
    ],
  });
  assert.ok(result);
  assert.deepEqual(result.fileChanges, [
    { relativePath: "include/modules/probesens.h", kind: "new" },
  ]);
});

test("a non-string entry in `written` is dropped rather than reaching a path join", () => {
  const result = narrowScaffoldResult({
    ...WRITE_NEW,
    written: ["src/modules/probesens/probesens.c", null, 7, { a: 1 }],
  });
  assert.ok(result);
  assert.deepEqual(result.written, ["src/modules/probesens/probesens.c"]);
});

test("a missing `unchanged` degrades to [] rather than dropping the result", () => {
  const { unchanged: _dropped, ...without } = WRITE_NEW;
  const result = narrowScaffoldResult(without);
  assert.ok(
    result,
    "`unchanged` is only ever counted in a summary line, so losing it must " +
      "not lose the file list the caller needs to act on",
  );
  assert.deepEqual(result.unchanged, []);
});

test("a non-object payload answers null", () => {
  for (const raw of [undefined, null, "written", 5, []]) {
    assert.equal(
      narrowScaffoldResult(raw),
      null,
      `${JSON.stringify(raw ?? String(raw))} narrowed to something`,
    );
  }
});

test("an unknown `kind` survives narrowing verbatim", () => {
  const result = narrowScaffoldResult({
    ...PREVIEW_NEW,
    fileChanges: [{ relativePath: "src/modules/x/x.c", kind: "replaced" }],
  });
  assert.ok(result);
  assert.equal(
    result.fileChanges[0].kind,
    "replaced",
    "narrowing drops what it cannot trust and leaves vocabulary alone — " +
      "coercing an unseen word into a known one is how a forward-compatible " +
      "tan gets misread",
  );
});

// ---------------------------------------------------------------------------
// isScaffoldNoOp
// ---------------------------------------------------------------------------

test("every file already identical is the no-op", () => {
  assert.equal(isScaffoldNoOp(narrowScaffoldResult(WRITE_ALL_UNCHANGED)), true);
});

test("a fresh scaffold is not a no-op", () => {
  assert.equal(isScaffoldNoOp(narrowScaffoldResult(PREVIEW_NEW)), false);
});

test("one differing file among unchanged ones is not a no-op", () => {
  assert.equal(
    isScaffoldNoOp(narrowScaffoldResult(WOULD_OVERWRITE.data)),
    false,
  );
});

test("an UNKNOWN kind is not treated as a no-op", () => {
  const result = narrowScaffoldResult({
    ...PREVIEW_NEW,
    fileChanges: [
      { relativePath: "include/modules/probesens.h", kind: "unchanged" },
      { relativePath: "src/modules/probesens/probesens.c", kind: "replaced" },
    ],
  });
  assert.equal(
    isScaffoldNoOp(result),
    false,
    "a word this extension has never seen must fall through to the confirm. " +
      "Reading it as `nothing to do` announces success for a run that would " +
      "have changed files.",
  );
});

test("an EMPTY file list is not a no-op", () => {
  const result = narrowScaffoldResult({ ...PREVIEW_NEW, fileChanges: [] });
  assert.equal(
    isScaffoldNoOp(result),
    false,
    "`[].every(...)` is `true`, so the obvious spelling turns a payload that " +
      "named no files at all into `Nothing to write.` — drift reported as " +
      "agreement.",
  );
});

// ---------------------------------------------------------------------------
// classifyScaffoldRefusal
// ---------------------------------------------------------------------------

test("the captured would-overwrite refusal classifies, keeping tan's own sentence", () => {
  const refusal = classifyScaffoldRefusal(WOULD_OVERWRITE.issues);
  assert.deepEqual(refusal, {
    kind: "would-overwrite",
    code: "scaffold.would-overwrite",
    message:
      "One or more files would be overwritten. Use --force to allow updates.",
  });
});

test("both empty-name refusals classify as the same recoverable kind", () => {
  assert.equal(
    classifyScaffoldRefusal(INVALID_NAME.issues).kind,
    "invalid-name",
  );
  assert.equal(
    classifyScaffoldRefusal(NAME_REQUIRED_ISSUES).kind,
    "invalid-name",
  );
});

test("the captured unknown-template refusal classifies", () => {
  const refusal = classifyScaffoldRefusal(INVALID_TEMPLATE_ISSUES);
  assert.equal(refusal.kind, "invalid-template");
  assert.equal(refusal.message, "Unknown module template 'nope'.");
});

test("an unrecognised code answers null so tan keeps reporting it", () => {
  assert.equal(
    classifyScaffoldRefusal([
      {
        code: "scaffold.some-future-refusal",
        severity: "error",
        message: "Something this extension has never heard of.",
      },
    ]),
    null,
    "wrapping an unclassified refusal in one of these sentences would send " +
      "the customer down a route that does not apply; planCliOutcome shows " +
      "tan's own issues instead",
  );
});

test("classification is on the CODE, never on the message prose", () => {
  assert.equal(
    classifyScaffoldRefusal([
      {
        code: "scaffold.reworded-upstream",
        severity: "error",
        message:
          "One or more files would be overwritten. Use --force to allow updates.",
      },
    ]),
    null,
    "matching the sentence would make a copy-edit upstream silently rename " +
      "this branch — and, worse here, would route a DIFFERENT refusal into " +
      "the one confirm that sends `--force`",
  );
});

test("issues that are not a list, or carry no code, never throw", () => {
  for (const issues of [undefined, null, "boom", 3, {}, [null], [{}], [[]]]) {
    assert.equal(
      classifyScaffoldRefusal(issues),
      null,
      `${JSON.stringify(issues ?? String(issues))} did not answer null`,
    );
  }
});

test("an inherited Object.prototype key is NOT a classification", () => {
  for (const code of [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "__proto__",
  ]) {
    assert.equal(
      classifyScaffoldRefusal([{ code, severity: "error", message: "x" }]),
      null,
      `\`${code}\` classified. A plain object literal inherits ` +
        "`Object.prototype`, so `KINDS[code]` reads back a FUNCTION, which is " +
        "truthy — the refusal then carries a kind that does not exist, " +
        "`scaffoldAdvice` falls off the end of its switch returning " +
        "`undefined`, and the customer's sentence ends in the literal word " +
        '"undefined" while tan\'s own issues never reach them.',
    );
  }
});

test("a code with a non-string message keeps the classification and drops the message", () => {
  assert.deepEqual(
    classifyScaffoldRefusal([
      { code: "scaffold.would-overwrite", severity: "error", message: 42 },
    ]),
    {
      kind: "would-overwrite",
      code: "scaffold.would-overwrite",
      message: null,
    },
  );
});

test("the first classifiable issue wins, and a leading unknown does not hide it", () => {
  const refusal = classifyScaffoldRefusal([
    { code: "scaffold.unknown", severity: "warning", message: "noise" },
    ...WOULD_OVERWRITE.issues,
  ]);
  assert.equal(refusal.kind, "would-overwrite");
});
