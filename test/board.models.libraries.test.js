// SPDX-License-Identifier: Apache-2.0
//
// Unit + round-trip coverage for the top-level `libraries[]` contract
// (ADR 0018, board.schema.json): the per-core `cores.<id>.libraries` field
// was removed, so librariesForCore/applyCoreLibrarySelection are the single
// place that resolve/write a core's effective library picks.

const test = require("node:test");
const assert = require("node:assert/strict");
const yaml = require("js-yaml");

const {
  librariesForCore,
  applyCoreLibrarySelection,
} = require("../packages/alp-core/dist/board/models.js");
const {
  parseBoardConfig,
} = require("../packages/alp-core/dist/board/parse.js");
const {
  serializeBoardConfig,
} = require("../packages/alp-core/dist/board/serialize.js");

test("librariesForCore: bare string and cores-less object are project-wide", () => {
  const libs = ["etl", { name: "mbedtls" }];
  assert.deepEqual(librariesForCore(libs, "m55_hp"), ["etl", "mbedtls"]);
  assert.deepEqual(librariesForCore(libs, "a32_cluster"), ["etl", "mbedtls"]);
});

test("librariesForCore: scoped object only counts for its listed cores", () => {
  const libs = [{ name: "cmsis_dsp", cores: ["m33_sm"] }];
  assert.deepEqual(librariesForCore(libs, "m33_sm"), ["cmsis_dsp"]);
  assert.deepEqual(librariesForCore(libs, "a55_cluster"), []);
});

test("librariesForCore: undefined libraries resolves to an empty list", () => {
  assert.deepEqual(librariesForCore(undefined, "m55_hp"), []);
});

test("applyCoreLibrarySelection: adding a new name for a core creates a scoped entry", () => {
  const next = applyCoreLibrarySelection(undefined, "m55_hp", ["mbedtls"], [
    "m55_hp",
    "m55_he",
  ]);
  assert.deepEqual(next, [{ name: "mbedtls", cores: ["m55_hp"] }]);
});

test("applyCoreLibrarySelection: adding for a second core merges into the existing entry (dedupe)", () => {
  const start = [{ name: "mbedtls", cores: ["m55_hp"] }];
  const next = applyCoreLibrarySelection(start, "m55_he", ["mbedtls"], [
    "m55_hp",
    "m55_he",
  ]);
  assert.deepEqual(next, [{ name: "mbedtls", cores: ["m55_hp", "m55_he"] }]);
  // Re-applying the same pick for the same core is a no-op (no duplicate id).
  const again = applyCoreLibrarySelection(next, "m55_he", ["mbedtls"], [
    "m55_hp",
    "m55_he",
  ]);
  assert.deepEqual(again, next);
});

test("applyCoreLibrarySelection: removing from a multi-core scoped entry narrows it", () => {
  const start = [{ name: "mbedtls", cores: ["m55_hp", "m55_he"] }];
  const next = applyCoreLibrarySelection(start, "m55_he", [], [
    "m55_hp",
    "m55_he",
  ]);
  assert.deepEqual(next, [{ name: "mbedtls", cores: ["m55_hp"] }]);
});

test("applyCoreLibrarySelection: removing the last scoped core drops the entry", () => {
  const start = [{ name: "mbedtls", cores: ["m55_hp"] }];
  const next = applyCoreLibrarySelection(start, "m55_hp", [], ["m55_hp"]);
  assert.deepEqual(next, []);
});

test("applyCoreLibrarySelection: removing a project-wide pick from one core narrows it to the others", () => {
  const next = applyCoreLibrarySelection(["mbedtls"], "m55_he", [], [
    "m55_hp",
    "m55_he",
  ]);
  assert.deepEqual(next, [{ name: "mbedtls", cores: ["m55_hp"] }]);
});

test("applyCoreLibrarySelection: removing a project-wide pick with no other cores drops it", () => {
  const next = applyCoreLibrarySelection(["mbedtls"], "m55_hp", [], [
    "m55_hp",
  ]);
  assert.deepEqual(next, []);
});

// The configurator round trip (unit 4a): the webview TagSelector for a core
// writes a core-scoped pick via this same resolver, then the mutated
// BoardConfig is serialized. It must land ONLY as a top-level `libraries:`
// entry -- never as `cores.<id>.libraries` (that key fails schema validation).
test("configurator round trip: a core-scoped library pick serializes to top-level libraries only", () => {
  const board = parseBoardConfig(
    "som:\n  sku: E1M-AEN801\ncores:\n  m55_hp:\n    app: ./src\n  m55_he:\n    app: ./he\n",
  );
  board.libraries = applyCoreLibrarySelection(
    board.libraries,
    "m55_hp",
    ["mbedtls"],
    Object.keys(board.cores),
  );

  const yamlText = serializeBoardConfig(board);
  const raw = yaml.load(yamlText);
  assert.deepEqual(raw.libraries, [{ name: "mbedtls", cores: ["m55_hp"] }]);
  assert.equal(
    "libraries" in raw.cores.m55_hp,
    false,
    "libraries: must not be nested under cores.<id> (core_entry forbids the key)",
  );

  const reparsed = parseBoardConfig(yamlText);
  assert.deepEqual(reparsed.libraries, [{ name: "mbedtls", cores: ["m55_hp"] }]);
  assert.equal(reparsed.cores.m55_hp.libraries, undefined);
  assert.deepEqual(librariesForCore(reparsed.libraries, "m55_hp"), ["mbedtls"]);
  assert.deepEqual(librariesForCore(reparsed.libraries, "m55_he"), []);
});
