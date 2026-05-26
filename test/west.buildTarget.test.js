const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeBuildTarget } = require("@alp-sdk/core/west/buildTarget");

test("returns a target when both fields are non-empty", () => {
  assert.deepEqual(
    normalizeBuildTarget({ board: "native_sim/native/64", example: "examples/blinky" }),
    { board: "native_sim/native/64", example: "examples/blinky" },
  );
});

test("trims surrounding whitespace", () => {
  assert.deepEqual(
    normalizeBuildTarget({ board: "  b  ", example: "  e  " }),
    { board: "b", example: "e" },
  );
});

test("returns null when input is null/undefined", () => {
  assert.equal(normalizeBuildTarget(null), null);
  assert.equal(normalizeBuildTarget(undefined), null);
});

test("returns null when a field is missing or blank", () => {
  assert.equal(normalizeBuildTarget({ board: "b" }), null);
  assert.equal(normalizeBuildTarget({ board: "b", example: "   " }), null);
  assert.equal(normalizeBuildTarget({ board: "", example: "e" }), null);
});
