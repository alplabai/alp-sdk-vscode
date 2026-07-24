// SPDX-License-Identifier: Apache-2.0

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  boardUsesYocto,
} = require("../packages/alp-core/dist/board/backend.js");

test("boardUsesYocto: true when any core targets yocto", () => {
  assert.equal(
    boardUsesYocto({ cores: { a55: { os: "yocto" }, m33: { os: "zephyr" } } }),
    true,
  );
});

test("boardUsesYocto: false for an all-Zephyr/baremetal board", () => {
  assert.equal(
    boardUsesYocto({ cores: { m55_he: { os: "zephyr" }, m55_hp: {} } }),
    false,
  );
});

test("boardUsesYocto: tolerant of missing/malformed input", () => {
  assert.equal(boardUsesYocto(null), false);
  assert.equal(boardUsesYocto({}), false);
  assert.equal(boardUsesYocto({ cores: "nope" }), false);
  assert.equal(boardUsesYocto("board"), false);
});
