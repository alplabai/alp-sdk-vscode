const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseBoardConfig,
} = require("../packages/alp-core/dist/board/parse.js");
const {
  serializeBoardConfig,
} = require("../packages/alp-core/dist/board/serialize.js");
const {
  EDGEAI,
  OBJDET,
  PRODUCTION,
  ALLBLOCKS,
} = require("./fixtures/board.fixtures.js");

for (const [name, text] of [
  ["EDGEAI", EDGEAI],
  ["OBJDET", OBJDET],
  ["PRODUCTION", PRODUCTION],
  ["ALLBLOCKS", ALLBLOCKS],
]) {
  test(`serializeBoardConfig round-trips ${name} (data-stable)`, () => {
    const parsed = parseBoardConfig(text);
    const reparsed = parseBoardConfig(serializeBoardConfig(parsed));
    assert.deepEqual(reparsed, parsed);
  });
}

test("serializeBoardConfig emits canonical top-level order (name, then som before cores)", () => {
  const yamlText = serializeBoardConfig({
    name: "demo",
    som: { sku: "E1M-AEN701" },
    cores: { m55_hp: { app: "./src" } },
    chips: ["lsm6dso"],
  });
  assert.ok(yamlText.startsWith("name: demo"));
  assert.ok(yamlText.indexOf("som:") < yamlText.indexOf("cores:"));
  assert.equal(yamlText.includes("boot:"), false);
});

// Regression gate: `models:` must survive parse -> serialize. A whitelist gap in
// BOARD_KEY_ORDER once made the configurator silently DELETE the block on save.
test("models: block round-trips through parse -> serialize (no data loss)", () => {
  const text = [
    "som:",
    "  sku: E1M-V2M101",
    "cores:",
    "  m33_sm:",
    "    os: zephyr",
    "models:",
    "  - name: kws",
    "    source: models/kws.tflite",
    "    compile:",
    "      deepx_dxm1:",
    "        config: models/kws.dxcom.json",
    "        calibration: models/calib",
    "",
  ].join("\n");

  const parsed = parseBoardConfig(text);
  assert.equal(parsed.models?.length, 1);
  assert.equal(parsed.models[0].name, "kws");
  assert.equal(
    parsed.models[0].compile.deepx_dxm1.config,
    "models/kws.dxcom.json",
  );

  const out = serializeBoardConfig(parsed);
  assert.ok(out.includes("models:"), "serialize must emit the models block");
  const reparsed = parseBoardConfig(out);
  assert.deepEqual(reparsed, parsed);
});
