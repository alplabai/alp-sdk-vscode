// SPDX-License-Identifier: Apache-2.0
//
// Narrowing `tan init --preview`'s `data` (#616): the file list the New
// Project wizard's Confirm step shows before Create writes anything.
//
// NARROW, NEVER CAST. A payload missing `fileChanges` answers `null`, never an
// empty-looking `[]` — `written ?? []` is the shape that once reported
// "Materialised 0 file(s)" through a SUCCESS toast for a run whose output
// nobody could read (`test/ideHub.materialiseGuard.test.js`). The fixtures
// below are chosen to tell those two states apart: a payload that narrows to
// zero files (this narrower has nothing wrong with it) vs one that cannot be
// narrowed at all (this narrower refuses to guess).

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  narrowInitPreview,
} = require("../packages/alp-core/dist/project/initPreview.js");

// Verbatim shape from the pinned tan 0.6.0 (`tan init --preview --format
// json` for the `minimal-app` template): 8 entries, every one `kind: "new"`
// on an empty destination.
const MINIMAL_APP_DATA = {
  preview: true,
  written: [],
  sdkPinned: null,
  fileChanges: [
    { relativePath: "board.yaml", kind: "new" },
    { relativePath: "README.md", kind: "new" },
    { relativePath: "prj.conf", kind: "new" },
    { relativePath: "CMakeLists.txt", kind: "new" },
    { relativePath: "src/CMakeLists.txt", kind: "new" },
    { relativePath: "include/app/app.h", kind: "new" },
    { relativePath: "src/main.c", kind: "new" },
    { relativePath: "src/features/app_bootstrap.c", kind: "new" },
  ],
};

test("the pinned tan's real minimal-app preview narrows in full", () => {
  const result = narrowInitPreview(MINIMAL_APP_DATA);
  assert.ok(result);
  assert.equal(result.fileChanges.length, 8);
  assert.deepEqual(result.fileChanges[0], {
    relativePath: "board.yaml",
    kind: "new",
  });
  assert.deepEqual(result.fileChanges[7], {
    relativePath: "src/features/app_bootstrap.c",
    kind: "new",
  });
});

test("sdkPinned and written are not carried — the preview pass never has the first and always sends [] for the second", () => {
  // Measured: `data.sdkPinned` is `null` on a `--preview` pass at this pin —
  // only the real (non-preview) run resolves and reports it (#616's own
  // correction). `InitPreviewResult` carries neither field so nothing here
  // could accidentally read `sdkPinned` as if Create had already run.
  const result = narrowInitPreview(MINIMAL_APP_DATA);
  assert.deepEqual(Object.keys(result), ["fileChanges"]);
});

test("a payload with no fileChanges array answers null, not an empty list", () => {
  // The distinction this whole narrower exists for: `null` means "could not
  // be read", `{fileChanges: []}` means "read fine, genuinely nothing" — and
  // the two must never collapse into each other.
  assert.equal(narrowInitPreview({ preview: true, written: [] }), null);
  assert.equal(narrowInitPreview({ fileChanges: null }), null);
  assert.equal(narrowInitPreview({ fileChanges: "not-a-list" }), null);
});

test("a genuinely empty fileChanges list narrows to an empty list, not null", () => {
  const result = narrowInitPreview({ fileChanges: [] });
  assert.ok(result);
  assert.deepEqual(result.fileChanges, []);
});

test("a malformed or absent envelope data is not a result", () => {
  assert.equal(narrowInitPreview(undefined), null);
  assert.equal(narrowInitPreview(null), null);
  assert.equal(narrowInitPreview("fileChanges"), null);
  assert.equal(narrowInitPreview(42), null);
  assert.equal(narrowInitPreview([]), null);
});

test("a malformed entry is dropped, not thrown on and not passed through", () => {
  const result = narrowInitPreview({
    fileChanges: [
      { relativePath: "board.yaml", kind: "new" },
      null,
      42,
      "board.yaml",
      { relativePath: "no-kind.txt" },
      { kind: "new" },
      { relativePath: 7, kind: "new" },
      { relativePath: "prj.conf", kind: "update" },
    ],
  });
  assert.ok(result);
  assert.deepEqual(result.fileChanges, [
    { relativePath: "board.yaml", kind: "new" },
    { relativePath: "prj.conf", kind: "update" },
  ]);
});

test("an unrecognised `kind` is kept, not dropped — display only, never a closed union", () => {
  // Same rule ScaffoldFileChange.kind documents: an unseen word must still be
  // LISTED to the customer, never silently swallowed by a union this
  // extension guessed at.
  const result = narrowInitPreview({
    fileChanges: [{ relativePath: "board.yaml", kind: "some-future-kind" }],
  });
  assert.deepEqual(result.fileChanges, [
    { relativePath: "board.yaml", kind: "some-future-kind" },
  ]);
});
