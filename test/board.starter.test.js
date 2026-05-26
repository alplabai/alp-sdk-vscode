const test = require("node:test");
const assert = require("node:assert/strict");
const { buildStarterBoardConfig } = require("@alp-sdk/core/board/starter");
const { validateBoardConfig } = require("@alp-sdk/core/board/validate");

test("builds a valid multi-core starter from core ids", () => {
  const cfg = buildStarterBoardConfig("E1M-AEN701", ["a32_cluster", "m55_hp"]);
  assert.equal(cfg.som.sku, "E1M-AEN701");
  assert.match(cfg.name, /E1M-AEN701/);
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
