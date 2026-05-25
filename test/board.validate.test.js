const test = require("node:test");
const assert = require("node:assert/strict");

const { parseBoardConfig } = require("../packages/alp-core/dist/board/parse.js");
const { validateBoardConfig } = require("../packages/alp-core/dist/board/validate.js");
const { PRODUCTION, ALLBLOCKS } = require("./fixtures/board.fixtures.js");

test("a valid real board has no errors", () => {
  const r = validateBoardConfig(parseBoardConfig(PRODUCTION));
  assert.deepEqual(r.errors, []);
});

test("ALLBLOCKS (inline populated, no preset) is also error-free", () => {
  const r = validateBoardConfig(parseBoardConfig(ALLBLOCKS));
  assert.deepEqual(r.errors, []);
});

test("missing som.sku and empty cores are errors", () => {
  const r = validateBoardConfig({ som: { sku: "" }, cores: {} });
  assert.ok(r.errors.some((e) => /som\.sku/.test(e)));
  assert.ok(r.errors.some((e) => /cores/.test(e)));
});

test("preset is mutually exclusive with inline populated", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN701" },
    cores: { m55_hp: { app: "./src" } },
    preset: "e1m-evk",
    populated: { lsm6dso: true },
  });
  assert.ok(r.errors.some((e) => /preset.*mutually exclusive|mutually exclusive.*inline/i.test(e)));
});

test("iot.tls without mbedtls/bearssl on the same core is an error", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN701" },
    cores: { m55_hp: { app: "./src", iot: { tls: true }, libraries: ["fmt"] } },
  });
  assert.ok(r.errors.some((e) => /m55_hp.*tls.*mbedtls|tls.*requires/i.test(e)));
});

test("iot.tls with mbedtls present is fine", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN701" },
    cores: { m55_hp: { app: "./src", iot: { tls: true }, libraries: ["mbedtls"] } },
  });
  assert.deepEqual(r.errors, []);
});

test("mcuboot without signing is an error", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN701" },
    cores: { m55_hp: { app: "./src" } },
    boot: { method: "mcuboot" },
  });
  assert.ok(r.errors.some((e) => /mcuboot.*signing|signing.*required/i.test(e)));
});
