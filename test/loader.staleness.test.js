const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeGenerationStaleness } = require("@alp-sdk/core/loader/staleness");

const files = (genMtime) => [{ emit: "zephyr-conf", displayName: "Zephyr config", generatedMtimeMs: genMtime }];

test("board newer than generated → stale", () => {
  const r = analyzeGenerationStaleness(200, files(100));
  assert.equal(r.entries[0].status, "stale");
  assert.equal(r.stale, 1);
  assert.equal(r.ok, false);
});

test("generated missing → missing", () => {
  const r = analyzeGenerationStaleness(200, files(null));
  assert.equal(r.entries[0].status, "missing");
  assert.equal(r.missing, 1);
  assert.equal(r.ok, false);
});

test("generated newer than board → current, ok", () => {
  const r = analyzeGenerationStaleness(100, files(200));
  assert.equal(r.entries[0].status, "current");
  assert.equal(r.ok, true);
  assert.equal(r.stale, 0);
  assert.equal(r.missing, 0);
});

test("no board.yaml (null) with an existing file → current", () => {
  const r = analyzeGenerationStaleness(null, files(100));
  assert.equal(r.entries[0].status, "current");
  assert.equal(r.ok, true);
});

test("mixed: counts stale and missing across entries", () => {
  const r = analyzeGenerationStaleness(500, [
    { emit: "a", displayName: "A", generatedMtimeMs: 100 },
    { emit: "b", displayName: "B", generatedMtimeMs: null },
    { emit: "c", displayName: "C", generatedMtimeMs: 900 },
  ]);
  assert.equal(r.stale, 1);
  assert.equal(r.missing, 1);
  assert.equal(r.ok, false);
  assert.equal(r.entries[2].status, "current");
});
