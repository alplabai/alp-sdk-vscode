const test = require("node:test");
const assert = require("node:assert/strict");

const { parseSomPreset } = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

const AEN = `
schema_version: 1
sku: E1M-AEN701
family: alif-ensemble
silicon: alif:ensemble:e7
silicon_variant: AE722F80F55D5LS
display_name: "E1M-AEN701 (Alif Ensemble E7)"
on_module:
  silicon: alif:ensemble:e7
  wifi_ble: cc3501e
  secure_element: optiga_trust_m
inference:
  preferred_backend: ethos_u
capabilities:
  optiga_trust_m: true
topology:
  a32_cluster: { app: x }
  m55_hp: { app: y }
  m55_he: { app: z }
default_board: E1M-EVK
status:
  preliminary: false
`;

const V2M = `
sku: E1M-V2M101
family: renesas-rzv2n
silicon: renesas:rzv2n:n44
display_name: "E1M-V2M101 (Renesas RZ/V2N + DEEPX DX-M1)"
memory: { dram_mbit: 32768, flash_mbit: 32768 }
inference:
  preferred_backend: deepx_dxm1
capabilities:
  deepx_dx: true
  optiga_trust_m: true
topology:
  a55_cluster: { app: x }
  m33_sm: { app: y }
default_board: E1M-X-EVK
status:
  preliminary: false
`;

const NX_TBD = `
sku: E1M-NX9101
family: nxp-imx9
silicon: nxp:imx9:imx93
silicon_variant: TBD
display_name: "E1M-NX9101 (NXP i.MX 93 -- exact SKU TBD)"
memory: { dram_mbit: TBD, flash_mbit: TBD }
inference:
  preferred_backend: ethos_u
topology:
  a55_cluster: { app: x }
status:
  preliminary: true
`;

test("parseSomPreset maps an AEN preset", () => {
  const s = parseSomPreset(AEN);
  assert.equal(s.sku, "E1M-AEN701");
  assert.equal(s.family, "alif-ensemble");
  assert.equal(s.silicon, "alif:ensemble:e7");
  assert.equal(s.siliconVariant, "AE722F80F55D5LS");
  assert.equal(s.preferredBackend, "ethos_u");
  assert.equal(s.defaultBoard, "E1M-EVK");
  assert.deepEqual(s.topologyCoreIds, ["a32_cluster", "m55_hp", "m55_he"]);
  assert.equal(s.capabilities.optiga_trust_m, true);
  assert.equal(s.capabilities.deepx_dx ?? false, false);
  assert.equal(s.preliminary, false);
  assert.ok(s.onModule.includes("cc3501e"));
});

test("parseSomPreset maps a V2M preset with deepx + memory", () => {
  const s = parseSomPreset(V2M);
  assert.equal(s.preferredBackend, "deepx_dxm1");
  assert.equal(s.capabilities.deepx_dx, true);
  assert.deepEqual(s.memory, { dramMbit: 32768, flashMbit: 32768 });
  assert.equal(s.defaultBoard, "E1M-X-EVK");
});

test("parseSomPreset treats TBD as unknown", () => {
  const s = parseSomPreset(NX_TBD);
  assert.equal(s.siliconVariant, undefined);
  assert.equal(s.memory, undefined);
  assert.equal(s.preliminary, true);
});

const { parseBoardPreset } = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

const BOARD = `
name: e1m-evk
display_name: "E1M-EVK reference board"
hosts_som_families: [alif-ensemble, nxp-imx9]
populated:
  lsm6dso: true
  ssd1306: true
  ov5640: false
`;

test("parseBoardPreset maps name, families, and populated", () => {
  const b = parseBoardPreset(BOARD);
  assert.equal(b.name, "e1m-evk");
  assert.equal(b.displayName, "E1M-EVK reference board");
  assert.deepEqual(b.hostsSomFamilies, ["alif-ensemble", "nxp-imx9"]);
  assert.deepEqual(b.populated, { lsm6dso: true, ssd1306: true, ov5640: false });
});

const { parseChipDef } = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

const CHIP = `
schema_version: 1
chip_id: lsm6dso
driver_status: partial
display_name: "STMicroelectronics LSM6DSO 6-axis IMU"
vendor: st
bus: i2c
kconfig:
  zephyr: ALP_SDK_CHIP_LSM6DSO
  baremetal: ALP_SDK_CHIP_LSM6DSO
families:
  - aen
  - v2n
  - v2n-m1
`;

test("parseChipDef maps chip fields including families + kconfig", () => {
  const c = parseChipDef(CHIP);
  assert.equal(c.chipId, "lsm6dso");
  assert.equal(c.displayName, "STMicroelectronics LSM6DSO 6-axis IMU");
  assert.equal(c.vendor, "st");
  assert.equal(c.bus, "i2c");
  assert.equal(c.driverStatus, "partial");
  assert.deepEqual(c.families, ["aen", "v2n", "v2n-m1"]);
  assert.deepEqual(c.kconfig, { zephyr: "ALP_SDK_CHIP_LSM6DSO", baremetal: "ALP_SDK_CHIP_LSM6DSO" });
});
