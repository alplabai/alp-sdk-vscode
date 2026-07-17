const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseBoardConfig,
} = require("../packages/alp-core/dist/board/parse.js");
const {
  validateBoardConfig,
} = require("../packages/alp-core/dist/board/validate.js");
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
    som: { sku: "E1M-AEN801" },
    cores: { m55_hp: { app: "./src" } },
    preset: "e1m-evk",
    populated: { lsm6dso: true },
  });
  assert.ok(
    r.errors.some((e) =>
      /preset.*mutually exclusive|mutually exclusive.*inline/i.test(e),
    ),
  );
});

test("iot.tls without mbedtls/bearssl on the same core is an error", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN801" },
    cores: { m55_hp: { app: "./src", iot: { tls: true }, libraries: ["fmt"] } },
  });
  assert.ok(
    r.errors.some((e) => /m55_hp.*tls.*mbedtls|tls.*requires/i.test(e)),
  );
});

test("iot.tls with mbedtls present is fine", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN801" },
    cores: {
      m55_hp: { app: "./src", iot: { tls: true }, libraries: ["mbedtls"] },
    },
  });
  assert.deepEqual(r.errors, []);
});

test("mcuboot without explicit signing is valid (SDK defaults the family signing)", () => {
  // The SoM family supplies the default signing (AEN -> ECDSA-P256), so an
  // mcuboot board.yaml that omits boot.signing is valid — not an error.
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN801" },
    cores: { m55_hp: { app: "./src" } },
    boot: { method: "mcuboot" },
  });
  assert.equal(
    r.errors.some((e) => /signing/i.test(e)),
    false,
    "mcuboot without signing must not error (the SDK defaults it)",
  );
});

test("ipc channel with fewer than two endpoints is an error (#109)", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN801" },
    cores: { m55_hp: { app: "./src" }, m55_he: { app: "./he" } },
    ipc: [
      { name: "ch0", kind: "rpmsg", endpoints: ["m55_hp"], carve_out_kb: 64 },
    ],
  });
  assert.ok(
    r.errors.some((e) => /ipc 'ch0'.*at least 2 endpoints/i.test(e)),
    `expected a too-few-endpoints error, got: ${JSON.stringify(r.errors)}`,
  );
});

test("ipc endpoint referencing an undeclared core is an error (#109)", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN801" },
    cores: { m55_hp: { app: "./src" }, m55_he: { app: "./he" } },
    ipc: [
      {
        name: "ch0",
        kind: "rpmsg",
        endpoints: ["m55_hp", "core_a"],
        carve_out_kb: 64,
      },
    ],
  });
  assert.ok(
    r.errors.some((e) => /endpoint 'core_a' is not a declared core/i.test(e)),
    `expected an undeclared-core error, got: ${JSON.stringify(r.errors)}`,
  );
});

test("ipc channel with two declared-core endpoints is valid (#109)", () => {
  const r = validateBoardConfig({
    som: { sku: "E1M-AEN801" },
    cores: { m55_hp: { app: "./src" }, m55_he: { app: "./he" } },
    ipc: [
      {
        name: "ch0",
        kind: "rpmsg",
        endpoints: ["m55_hp", "m55_he"],
        carve_out_kb: 64,
      },
    ],
  });
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
});
