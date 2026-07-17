const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseBoardConfig,
} = require("../packages/alp-core/dist/board/parse.js");
const {
  librariesForCore,
} = require("../packages/alp-core/dist/board/models.js");
const {
  EDGEAI,
  OBJDET,
  PRODUCTION,
  ALLBLOCKS,
} = require("./fixtures/board.fixtures.js");

test("parseBoardConfig maps the EDGEAI example", () => {
  const c = parseBoardConfig(EDGEAI);
  assert.equal(c.som.sku, "E1M-AEN801");
  assert.equal(c.preset, "e1m-evk");
  assert.deepEqual(Object.keys(c.cores), ["a32_cluster", "m55_hp"]);
  assert.equal(c.cores.a32_cluster.os, "off");
  assert.equal(c.cores.m55_hp.inference.default_arena_kib, 256);
  assert.equal(c.pins.length, 1);
  assert.equal(c.diagnostics.log_level, "info");
});

test("parseBoardConfig maps the OBJDET example (chips + top-level libraries)", () => {
  const c = parseBoardConfig(OBJDET);
  assert.equal(c.som.sku, "E1M-V2M101");
  assert.deepEqual(c.chips, ["ov5640", "st7789"]);
  // libraries live only at the top level (ADR-0018); a per-core pick is a
  // `{name, cores}` entry there, not `cores.<id>.libraries` (forbidden).
  assert.equal(c.cores.m33_sm.libraries, undefined);
  assert.deepEqual(librariesForCore(c.libraries, "m33_sm"), ["cmsis_dsp"]);
});

test("parseBoardConfig maps the PRODUCTION example (boot/ota/memory/power/iot)", () => {
  const c = parseBoardConfig(PRODUCTION);
  assert.equal(c.cores.m55_hp.iot.wifi, true);
  assert.equal(c.cores.m55_hp.memory.stack_kib, 8);
  assert.equal(c.cores.m55_hp.power.sleep_mode, "standby");
  assert.deepEqual(c.cores.m55_hp.power.wakeup_sources, [
    "uart",
    "gpio",
    "rtc",
  ]);
  assert.equal(c.boot.method, "mcuboot");
  assert.equal(c.boot.signing.algorithm, "ecdsa_p256");
  assert.equal(c.boot.slots.primary.size_kib, 1024);
  assert.equal(c.ota.provider, "mender");
  assert.equal(c.ota.rollback.min_version, 1);
  assert.ok(c.chips.includes("optiga_trust_m"));
});

test("parseBoardConfig maps the ALLBLOCKS example (inline populated/routes/ipc/storage/security/features)", () => {
  const c = parseBoardConfig(ALLBLOCKS);
  assert.equal(c.populated.lsm6dso, true);
  assert.equal(c.populated.bme280, false);
  assert.equal(c.e1m_routes.gpio[0].macro, "BTN_USER");
  assert.equal(c.e1m_routes.gpio[0].active_low, true);
  assert.equal(c.ipc[0].kind, "rpmsg");
  assert.deepEqual(c.ipc[0].endpoints, ["a55_cluster", "m33_sm"]);
  assert.equal(c.storage[0].fs, "littlefs");
  assert.equal(c.security.psa.tfm, true);
  assert.equal(c.security.psa.attestation_root, "optiga_trust_m");
  assert.equal(c.features.custom_flag, true);
  assert.deepEqual(c.supported_boards, ["e1m-x-evk"]);
  assert.equal(c.diagnostics.modules.alp_inference, "trace");
  assert.equal(c.cores.a55_cluster.image, "alp-image-edge");
  assert.ok(c.cores.m33_sm.peripherals.includes("i2c"));
});

test("parseBoardConfig defaults missing som/cores rather than throwing", () => {
  const c = parseBoardConfig("name: empty\n");
  assert.equal(c.som.sku, "");
  assert.deepEqual(c.cores, {});
  assert.equal(c.name, "empty");
});

test("parseBoardConfig throws on malformed YAML but not on empty input (#127)", () => {
  // Empty / whitespace-only input is a valid empty board, never a throw — the
  // configurator relies on this to tell "new file" from "broken file" so it
  // never overwrites an unreadable board.yaml with a stub.
  assert.deepEqual(parseBoardConfig("").cores, {});
  assert.deepEqual(parseBoardConfig("   \n").cores, {});
  // A real syntax error must throw so the caller can refuse to overwrite it.
  assert.throws(() => parseBoardConfig('name: "unterminated'));
});
