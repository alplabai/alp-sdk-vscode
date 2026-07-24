const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseSomPreset,
} = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

const AEN = `
schema_version: 1
sku: E1M-AEN801
family: alif-ensemble
silicon: alif:ensemble:e8
silicon_variant: AE722F80F55D5LS
display_name: "E1M-AEN801 (Alif Ensemble E8)"
on_module:
  silicon: alif:ensemble:e8
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
  assert.equal(s.sku, "E1M-AEN801");
  assert.equal(s.family, "alif-ensemble");
  assert.equal(s.silicon, "alif:ensemble:e8");
  assert.equal(s.siliconVariant, "AE722F80F55D5LS");
  assert.equal(s.preferredBackend, "ethos_u");
  assert.equal(s.defaultBoard, "E1M-EVK");
  assert.deepEqual(s.topologyCoreIds, ["a32_cluster", "m55_hp", "m55_he"]);
  assert.equal(s.capabilities.optiga_trust_m, true);
  assert.equal(s.capabilities.deepx_dx ?? false, false);
  assert.equal(s.preliminary, false);
  assert.ok(s.onModule.includes("cc3501e"));
  // the `silicon:` ref under on_module is NOT a companion chip
  assert.ok(!s.onModule.includes("alif:ensemble:e8"));
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

const {
  parseBoardPreset,
} = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

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
  assert.deepEqual(b.populated, {
    lsm6dso: true,
    ssd1306: true,
    ov5640: false,
  });
});

const {
  parseSocSpec,
} = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

const SOC = JSON.stringify({
  soc_spec_version: 1,
  ref: "alif:ensemble:e8",
  vendor: "Alif Semiconductor",
  family: "Ensemble",
  part: "E7",
  cores: [
    { id: "a32_cluster", type: "cortex-a32", count: 2, freq_mhz: 800 },
    { id: "m55_hp", type: "cortex-m55", count: 1, freq_mhz: 400 },
  ],
});

test("parseSocSpec maps ref + cores", () => {
  const s = parseSocSpec(SOC);
  assert.equal(s.ref, "alif:ensemble:e8");
  assert.equal(s.part, "E7");
  assert.deepEqual(s.cores, [
    { id: "a32_cluster", type: "cortex-a32", count: 2, freqMhz: 800 },
    { id: "m55_hp", type: "cortex-m55", count: 1, freqMhz: 400 },
  ]);
});

const {
  parseChipDef,
} = require("../packages/alp-core/dist/sdkCatalogue/parse.js");

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
  assert.deepEqual(c.kconfig, {
    zephyr: "ALP_SDK_CHIP_LSM6DSO",
    baremetal: "ALP_SDK_CHIP_LSM6DSO",
  });
});

const AEN_ROUTES = `
sku: E1M-AEN801
family: alif-ensemble
silicon: alif:ensemble:e8
display_name: AEN801
on_module:
  silicon: alif:ensemble:e8
  wifi_ble: cc3501e
  i2c_devices:
    brd_i2c:
      bus_master: alif
      devices:
        - { chip: rv3028c7, role: rtc, address_7bit: "0x52" }
        - { chip: tmp112, role: temp_sensor, address_7bit: "0x40" }
pad_routes:
  - { e1m: E1M_SPI1, dispatch: cc3501e, doc: "inter-chip SPI" }
  - { e1m: E1M_GPIO_IO11, dispatch: cc3501e, dispatch_pin: 2 }
topology:
  m55_hp: { app: x }
status: { preliminary: false }
`;

test("parseSomPreset captures pad_routes", () => {
  const s = parseSomPreset(AEN_ROUTES);
  assert.equal(s.padRoutes.length, 2);
  assert.deepEqual(s.padRoutes[0], {
    e1m: "E1M_SPI1",
    dispatch: "cc3501e",
    dispatchPin: undefined,
    doc: "inter-chip SPI",
  });
  assert.equal(s.padRoutes[1].e1m, "E1M_GPIO_IO11");
  assert.equal(s.padRoutes[1].dispatchPin, "2");
});

test("parseSomPreset flattens on-module i2c_devices", () => {
  const s = parseSomPreset(AEN_ROUTES);
  assert.equal(s.i2cDevices.length, 2);
  assert.deepEqual(s.i2cDevices[0], {
    bus: "brd_i2c",
    chip: "rv3028c7",
    role: "rtc",
    address: "0x52",
  });
  assert.equal(s.i2cDevices[1].chip, "tmp112");
});

test("parseSomPreset defaults padRoutes/i2cDevices to [] when absent", () => {
  const s = parseSomPreset(
    "sku: E1M-AEN801\nfamily: alif-ensemble\nsilicon: x\ndisplay_name: y\ntopology: { m55_hp: {} }\nstatus: { preliminary: false }\n",
  );
  assert.deepEqual(s.padRoutes, []);
  assert.deepEqual(s.i2cDevices, []);
});

const TOPO = `
sku: E1M-AEN801
family: alif-ensemble
silicon: alif:ensemble:e8
display_name: AEN801
topology:
  a32_cluster: { app: alp-image-edge, machine: e1m-aen701-a32, toolchain: poky-glibc }
  m55_hp: { app: alp-stock-shim, board: alp_e1m_aen701_m55_hp, toolchain: arm-zephyr-eabi }
status: { preliminary: false }
`;

test("parseSomPreset captures full topology detail", () => {
  const s = parseSomPreset(TOPO);
  assert.deepEqual(s.topologyCoreIds, ["a32_cluster", "m55_hp"]);
  assert.equal(s.topology.length, 2);
  assert.deepEqual(s.topology[0], {
    id: "a32_cluster",
    app: "alp-image-edge",
    image: undefined,
    machine: "e1m-aen701-a32",
    board: undefined,
    toolchain: "poky-glibc",
    hwConsole: undefined,
  });
  assert.equal(s.topology[1].id, "m55_hp");
  assert.equal(s.topology[1].board, "alp_e1m_aen701_m55_hp");
  assert.equal(s.topology[1].toolchain, "arm-zephyr-eabi");
});

test("parseSomPreset reads hw_console: false as a headless core (alp-sdk#686)", () => {
  const s = parseSomPreset(
    "sku: E1M-V2N101\nfamily: renesas-rzv2n\nsilicon: x\ndisplay_name: y\n" +
      "topology:\n  m33_sm: { app: system-manager, hw_console: false }\n  a55_cluster: { app: alp-image-edge }\n" +
      "status: { preliminary: false }\n",
  );
  assert.equal(s.topology.find((t) => t.id === "m33_sm").hwConsole, false);
  assert.equal(
    s.topology.find((t) => t.id === "a55_cluster").hwConsole,
    undefined,
  );
});
