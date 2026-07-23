// SPDX-License-Identifier: Apache-2.0

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  starterBoardName,
  buildStarterBoardConfig,
} = require("../packages/alp-core/dist/board/starter.js");
const {
  validateBoardConfig,
} = require("../packages/alp-core/dist/board/validate.js");

// The vendored board schema pins `name` to this pattern (issue #73). The
// starter generator must never emit a name that violates it — a space, or any
// punctuation a SKU carries, would be rejected by board.schema.json.
const NAME_PATTERN = require("../schemas/board.schema.json").properties.name
  .pattern;
const nameRe = new RegExp(NAME_PATTERN);

test("starterBoardName is schema-valid for the qualified SKU", () => {
  const name = starterBoardName("E1M-AEN801");
  assert.match(name, nameRe);
  assert.equal(name, "E1M-AEN801-project");
});

test("starterBoardName sanitizes spaces and punctuation to a valid name", () => {
  for (const sku of [
    "AEN 801",
    "E1M/AEN801",
    "foo.bar@baz",
    "  weird sku!  ",
    "E1M-AEN801", // already valid, must round-trip
  ]) {
    assert.match(
      starterBoardName(sku),
      nameRe,
      `SKU ${JSON.stringify(sku)} -> ${JSON.stringify(starterBoardName(sku))}`,
    );
  }
});

test("starterBoardName drops leading non-letters and empty falls back", () => {
  assert.match(starterBoardName("801-abc"), nameRe);
  assert.equal(starterBoardName("801-abc"), "abc-project");
  assert.equal(starterBoardName("!!!"), "board-project");
  assert.equal(starterBoardName(""), "board-project");
});

test("buildStarterBoardConfig emits a schema-valid name and passes validateBoardConfig", () => {
  const cfg = buildStarterBoardConfig("E1M-AEN801", ["m55_hp", "m55_he"]);
  assert.match(cfg.name, nameRe);
  const { errors } = validateBoardConfig(cfg);
  assert.deepEqual(errors, []);
});

test("buildStarterBoardConfig defaults to an 'app' core when none are known", () => {
  const cfg = buildStarterBoardConfig("E1M-AEN801", []);
  assert.match(cfg.name, nameRe);
  assert.deepEqual(Object.keys(cfg.cores), ["app"]);
});
