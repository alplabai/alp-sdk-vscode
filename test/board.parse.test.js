const test = require("node:test");
const assert = require("node:assert/strict");

const { parseBoardConfig } = require("../packages/alp-core/dist/board/parse.js");

const EDGEAI = `
som:
  sku: E1M-AEN701
preset: e1m-evk
pins:
  - { e1m: E1M_I2C0, macro: EVK_I2C_BUS_SENSORS, doc: "Shared sensor bus" }
cores:
  a32_cluster:
    os: "off"
  m55_hp:
    app: ./src
    inference:
      default_arena_kib: 256
diagnostics:
  log_level: info
`;

const OBJDET = `
som:
  sku: E1M-V2M101
preset: e1m-evk
chips:
  - ov5640
  - st7789
cores:
  a55_cluster:
    os: "off"
  m33_sm:
    app: ./src
    libraries:
      - cmsis_dsp
`;

const PRODUCTION = `
som:
  sku: E1M-AEN701
preset: e1m-evk
cores:
  a32_cluster:
    os: "off"
  m55_hp:
    app: ./src
    iot: { wifi: true, mqtt: true, tls: true }
    libraries: [mbedtls]
    memory: { stack_kib: 8, heap_kib: 64, isr_stack_kib: 4 }
    power:
      sleep_mode: standby
      wakeup_sources: [uart, gpio, rtc]
  m55_he:
    os: "off"
chips:
  - optiga_trust_m
  - eeprom_24c128
boot:
  method: mcuboot
  signing: { algorithm: ecdsa_p256, key_file: keys/prod_ecdsa_p256.pub.pem }
  slots:
    primary: { size_kib: 1024 }
    secondary: { size_kib: 1024 }
  swap_algorithm: scratch
  scratch_size_kib: 64
  anti_rollback: true
ota:
  provider: mender
  artifact_name: production-deployment
  server: { url: "https://hosted.mender.io" }
  rollback: { enabled: true, retries: 3, min_version: 1 }
  poll_interval_s: 1800
diagnostics:
  log_level: info
`;

module.exports = { EDGEAI, OBJDET, PRODUCTION };

test("parseBoardConfig maps the EDGEAI example", () => {
  const c = parseBoardConfig(EDGEAI);
  assert.equal(c.som.sku, "E1M-AEN701");
  assert.equal(c.preset, "e1m-evk");
  assert.deepEqual(Object.keys(c.cores), ["a32_cluster", "m55_hp"]);
  assert.equal(c.cores.a32_cluster.os, "off");
  assert.equal(c.cores.m55_hp.inference.default_arena_kib, 256);
  assert.equal(c.pins.length, 1);
  assert.equal(c.diagnostics.log_level, "info");
});

test("parseBoardConfig maps the OBJDET example (chips + per-core libraries)", () => {
  const c = parseBoardConfig(OBJDET);
  assert.equal(c.som.sku, "E1M-V2M101");
  assert.deepEqual(c.chips, ["ov5640", "st7789"]);
  assert.deepEqual(c.cores.m33_sm.libraries, ["cmsis_dsp"]);
});

test("parseBoardConfig maps the PRODUCTION example (boot/ota/memory/power/iot)", () => {
  const c = parseBoardConfig(PRODUCTION);
  assert.equal(c.cores.m55_hp.iot.wifi, true);
  assert.equal(c.cores.m55_hp.memory.stack_kib, 8);
  assert.equal(c.cores.m55_hp.power.sleep_mode, "standby");
  assert.deepEqual(c.cores.m55_hp.power.wakeup_sources, ["uart", "gpio", "rtc"]);
  assert.equal(c.boot.method, "mcuboot");
  assert.equal(c.boot.signing.algorithm, "ecdsa_p256");
  assert.equal(c.boot.slots.primary.size_kib, 1024);
  assert.equal(c.ota.provider, "mender");
  assert.equal(c.ota.rollback.min_version, 1);
  assert.ok(c.chips.includes("optiga_trust_m"));
});

test("parseBoardConfig defaults missing som/cores rather than throwing", () => {
  const c = parseBoardConfig("name: empty\n");
  assert.equal(c.som.sku, "");
  assert.deepEqual(c.cores, {});
  assert.equal(c.name, "empty");
});
