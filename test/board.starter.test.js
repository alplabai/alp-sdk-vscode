const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildStarterBoardConfig } = require("@alp-sdk/core/board/starter");
const { validateBoardConfig } = require("@alp-sdk/core/board/validate");

test("builds a valid multi-core starter from core ids", () => {
  const cfg = buildStarterBoardConfig("E1M-AEN701", ["a32_cluster", "m55_hp"]);
  assert.equal(cfg.som.sku, "E1M-AEN701");
  assert.match(cfg.name, /E1M-AEN701/);
  assert.equal(cfg.name, "E1M-AEN701_project");
  assert.equal(cfg.cores.a32_cluster.os, "zephyr");
  assert.equal(cfg.cores.a32_cluster.app, "app");
  assert.equal(cfg.cores.m55_hp.os, "off");
  assert.equal(cfg.preset, undefined);
  assert.deepEqual(validateBoardConfig(cfg).errors, []);
});

test("falls back to a single app core when no core ids", () => {
  const cfg = buildStarterBoardConfig("X", []);
  assert.deepEqual(Object.keys(cfg.cores), ["app"]);
  assert.equal(cfg.cores.app.os, "zephyr");
  assert.deepEqual(validateBoardConfig(cfg).errors, []);
});

test("emits board names matching the vendored schema pattern", () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "schemas", "board.schema.json"),
      "utf-8",
    ),
  );
  const namePattern = new RegExp(schema.properties.name.pattern);

  for (const sku of ["E1M-AEN701", "9 bad sku", ""]) {
    const cfg = buildStarterBoardConfig(sku, []);
    assert.match(cfg.name, namePattern);
    assert.doesNotMatch(cfg.name, /\s/);
  }
});
