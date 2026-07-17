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

// #142: a hand-authored comment must survive a single configurator change.
test("serializeBoardConfig preserves comments on a single-field change", () => {
  const prior = [
    "som:",
    "  # pin rationale: E1 bus reserved for TBD sensor",
    "  sku: E1M-AEN701",
    "cores:",
    "  m55_hp:",
    "    app: ./src",
    "",
  ].join("\n");

  const cfg = parseBoardConfig(prior);
  cfg.som.sku = "E1M-AEN801";
  const out = serializeBoardConfig(cfg, prior);

  assert.ok(
    out.includes("# pin rationale: E1 bus reserved for TBD sensor"),
    "comment must survive a single-field change",
  );
  assert.ok(out.includes("E1M-AEN801"), "the changed field must be applied");
  assert.deepEqual(parseBoardConfig(out), cfg);
});

// #142: a comment inside an UNCHANGED sequence (chips:/models:) must survive a
// change to an unrelated field — the else-branch guard must not rebuild the
// untouched sequence node.
test("serializeBoardConfig keeps a comment inside an unchanged list", () => {
  const prior = [
    "som:",
    "  sku: E1M-AEN701",
    "cores:",
    "  m55_hp:",
    "    app: ./src",
    "chips:",
    "  # imu shares the E1 bus with the codec",
    "  - lsm6dso",
    "  - bmp390",
    "",
  ].join("\n");

  const cfg = parseBoardConfig(prior);
  cfg.som.sku = "E1M-AEN801"; // change something else entirely
  const out = serializeBoardConfig(cfg, prior);

  assert.ok(
    out.includes("# imu shares the E1 bus with the codec"),
    "comment inside the unchanged chips: list must survive",
  );
  assert.ok(out.includes("E1M-AEN801"), "the changed field must be applied");
  assert.deepEqual(parseBoardConfig(out), cfg);
});
