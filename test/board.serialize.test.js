const test = require("node:test");
const assert = require("node:assert/strict");

const { parseBoardConfig } = require("../packages/alp-core/dist/board/parse.js");
const { serializeBoardConfig } = require("../packages/alp-core/dist/board/serialize.js");
const { EDGEAI, OBJDET, PRODUCTION } = require("./board.parse.test.js");

for (const [name, text] of [["EDGEAI", EDGEAI], ["OBJDET", OBJDET], ["PRODUCTION", PRODUCTION]]) {
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
