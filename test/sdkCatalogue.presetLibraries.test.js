// SPDX-License-Identifier: Apache-2.0
//
// `tan presets` owns the library vocabulary; the filesystem scan is the
// fallback, and an empty answer must never be mistaken for one.
//
// The catalogue's `libraries` are the canonical manifest names board.yaml's
// `libraries[]` accepts (#564). `tan presets` reports exactly that set as
// `data.boardLibraries`, and the LSP completion already reads it from there.
// This is the seam that lets the Configurator read it from there too.
//
// The trap this encodes is measured, not theoretical. With an unresolved SDK,
// `tan presets` does NOT fail: it exits 0 with `ok: true`, omits the `sdk`
// envelope key entirely, returns an EMPTY `boardLibraries`, and says so only
// through `issues[].code == presets.sdk-root-unresolved`. A caller that trusts
// the exit code and overwrites unconditionally would blank a picker that the
// filesystem scan could still have filled — so an empty list must leave the
// fallback standing.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  withPresetLibraries,
} = require("../packages/alp-core/dist/sdkCatalogue/derive.js");

function catalogue(libraryIds) {
  return {
    soms: [],
    boards: [],
    chips: [],
    socs: [],
    libraries: libraryIds.map((id) => ({ id })),
    sdkVersion: "0.16.0-rc1",
  };
}

test("preset libraries replace the scanned ones", () => {
  const merged = withPresetLibraries(catalogue(["etl", "fmt"]), [
    "littlefs",
    "arm-2d",
  ]);

  assert.deepEqual(
    merged.libraries.map((l) => l.id),
    ["arm-2d", "littlefs"],
    "the CLI's vocabulary wins, sorted",
  );
});

test("an empty preset list leaves the filesystem fallback standing", () => {
  // `presets.sdk-root-unresolved` is exit 0 + ok:true + an empty list.
  const scanned = catalogue(["etl", "fmt"]);

  assert.deepEqual(
    withPresetLibraries(scanned, []).libraries.map((l) => l.id),
    ["etl", "fmt"],
  );
});

test("non-string entries are dropped, never coerced", () => {
  const merged = withPresetLibraries(catalogue([]), [
    "etl",
    null,
    42,
    "",
    "fmt",
  ]);

  assert.deepEqual(
    merged.libraries.map((l) => l.id),
    ["etl", "fmt"],
  );
});

test("the input catalogue is not mutated", () => {
  const scanned = catalogue(["etl"]);
  const before = scanned.libraries;

  const merged = withPresetLibraries(scanned, ["littlefs"]);

  assert.notEqual(merged, scanned, "a new catalogue is returned");
  assert.equal(scanned.libraries, before, "the original array is untouched");
  assert.deepEqual(
    scanned.libraries.map((l) => l.id),
    ["etl"],
  );
});

test("everything other than libraries is carried through", () => {
  const scanned = catalogue(["etl"]);
  const merged = withPresetLibraries(scanned, ["littlefs"]);

  assert.equal(merged.sdkVersion, "0.16.0-rc1");
  assert.equal(merged.soms, scanned.soms);
  assert.equal(merged.boards, scanned.boards);
  assert.equal(merged.chips, scanned.chips);
  assert.equal(merged.socs, scanned.socs);
});

// ── boardLibrariesFromPresets: the envelope's shape is a claim ─────────────
//
// The payload crosses a process boundary from a separately-versioned binary,
// so every level of it is `unknown` until proven otherwise.

const {
  boardLibrariesFromPresets,
} = require("../packages/alp-core/dist/sdkCatalogue/derive.js");

test("boardLibrariesFromPresets reads the field when it is an array", () => {
  assert.deepEqual(
    boardLibrariesFromPresets({ boardLibraries: ["etl", "littlefs"] }),
    ["etl", "littlefs"],
  );
});

test("boardLibrariesFromPresets returns [] for anything that is not one", () => {
  for (const payload of [
    undefined,
    null,
    42,
    "boardLibraries",
    {},
    { boardLibraries: null },
    { boardLibraries: "etl" },
    { boardLibraries: { 0: "etl" } },
  ]) {
    assert.deepEqual(
      boardLibrariesFromPresets(payload),
      [],
      `payload ${JSON.stringify(payload)} must yield no vocabulary`,
    );
  }
});

test("an unresolved-SDK presets payload yields no vocabulary", () => {
  // Measured against tan 0.6.0: no --sdk-root is exit 0, ok:true, the `sdk`
  // key absent, and every SDK-sourced list empty — while tan's OWN built-in
  // `libraries` (8 build profiles) stays populated. Reading that field instead
  // of `boardLibraries` would look like a working catalogue and be the wrong
  // vocabulary; reading the right field yields [], which keeps the fallback.
  const unresolved = {
    schemaVersion: 1,
    sdkRoot: null,
    skus: [],
    soms: [],
    boardLibraries: [],
    libraries: ["etl", "fmt", "nlohmann_json", "doctest"],
  };

  assert.deepEqual(boardLibrariesFromPresets(unresolved), []);
});

// ── The Configurator must actually go through that seam ───────────────────
//
// A unit test on withPresetLibraries stays green while nothing calls it, so
// the call site is gated in the source itself — the same failure mode the
// diagnostic-range fix hit (#566).
const fs = require("node:fs");
const path = require("node:path");

test("the Configurator builds its view model from the merged catalogue", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "configurator", "customEditor.ts"),
    "utf8",
  );

  assert.match(
    source,
    /withPresetLibraries\(\s*loadSdkCatalogue\(/,
    "the scanned catalogue must pass through withPresetLibraries before it reaches the view model",
  );
  assert.doesNotMatch(
    source,
    /const catalogue = loadSdkCatalogue\(/,
    "using the raw filesystem scan puts the picker back on the wrong vocabulary source",
  );
});
