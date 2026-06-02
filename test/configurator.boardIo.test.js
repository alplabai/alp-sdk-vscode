const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  loadBoardConfigFromFile,
  saveBoardConfigToFile,
} = require("../out/configurator/boardIo.js");

test("save then load round-trips a v0.6 board", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpio-"));
  try {
    const file = path.join(dir, "board.yaml");
    const cfg = {
      som: { sku: "E1M-AEN701" },
      cores: { m55_hp: { app: "./src" } },
      preset: "e1m-evk",
    };
    saveBoardConfigToFile(file, cfg);
    const loaded = loadBoardConfigFromFile(file);
    assert.equal(loaded.som.sku, "E1M-AEN701");
    assert.equal(loaded.preset, "e1m-evk");
    assert.deepEqual(Object.keys(loaded.cores), ["m55_hp"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadBoardConfigFromFile returns a default board for a missing file", () => {
  const cfg = loadBoardConfigFromFile(
    path.join(os.tmpdir(), "does-not-exist-12345.yaml"),
  );
  assert.equal(cfg.som.sku, "");
  assert.deepEqual(cfg.cores, {});
});
