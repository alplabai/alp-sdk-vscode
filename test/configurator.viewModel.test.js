const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseBoardConfig,
} = require("../packages/alp-core/dist/board/parse.js");
const {
  buildConfiguratorViewModel,
} = require("../packages/alp-core/dist/configurator/viewModel.js");
const { EDGEAI, OBJDET } = require("./fixtures/board.fixtures.js");

function catalogue() {
  return {
    soms: [
      {
        sku: "E1M-AEN801",
        displayName: "E1M-AEN801 (Alif Ensemble E8)",
        family: "alif-ensemble",
        silicon: "alif:ensemble:e8",
        preferredBackend: "ethos_u",
        capabilities: {},
        defaultBoard: "E1M-EVK",
        topologyCoreIds: ["a32_cluster", "m55_hp", "m55_he"],
        onModule: ["cc3501e"],
        preliminary: false,
      },
      {
        sku: "E1M-V2M101",
        displayName: "E1M-V2M101 (RZ/V2N + DEEPX)",
        family: "renesas-rzv2n",
        silicon: "renesas:rzv2n:n44",
        preferredBackend: "deepx_dxm1",
        capabilities: { deepx_dx: true },
        defaultBoard: "E1M-X-EVK",
        topologyCoreIds: ["a55_cluster", "m33_sm"],
        onModule: [],
        preliminary: false,
      },
    ],
    boards: [
      {
        name: "e1m-evk",
        displayName: "EVK",
        hostsSomFamilies: ["alif-ensemble"],
        populated: { lsm6dso: true },
      },
      {
        name: "e1m-x-evk",
        displayName: "X-EVK",
        hostsSomFamilies: ["renesas-rzv2n"],
        populated: {},
      },
    ],
    chips: [
      {
        chipId: "lsm6dso",
        displayName: "LSM6DSO",
        families: ["aen", "v2n", "v2n-m1"],
      },
      {
        chipId: "deepx_dxm1",
        displayName: "DEEPX DX-M1",
        families: ["v2n-m1"],
      },
    ],
    libraries: [{ id: "etl" }, { id: "mbedtls" }],
    socs: [
      {
        ref: "alif:ensemble:e8",
        vendor: "Alif",
        family: "Ensemble",
        part: "E7",
        cores: [{ id: "m55_hp", type: "cortex-m55", count: 1, freqMhz: 400 }],
      },
    ],
    sdkVersion: "0.6.0",
  };
}

test("VM for an AEN board derives hardware, accelerators, carriers, cores", () => {
  const vm = buildConfiguratorViewModel(parseBoardConfig(EDGEAI), catalogue());
  assert.equal(vm.sdkConnected, true);
  assert.equal(vm.som.selected, "E1M-AEN801");
  assert.equal(vm.hardware.preferredBackend, "ethos_u");
  assert.deepEqual(
    vm.hardware.cores.map((c) => c.id),
    ["m55_hp"],
  );
  assert.equal(vm.hardware.defaultBoard, "E1M-EVK");
  const acc = Object.fromEntries(
    vm.accelerators.map((a) => [a.id, a.available]),
  );
  assert.equal(acc.ethos_u, true);
  assert.equal(acc.deepx_dxm1, false);
  assert.equal(vm.boardMode, "preset");
  assert.equal(vm.carriers.selected, "e1m-evk");
  assert.deepEqual(
    vm.carriers.options.map((b) => b.name),
    ["e1m-evk"],
  );
  assert.deepEqual(
    vm.cores.map((c) => c.id),
    ["a32_cluster", "m55_hp", "m55_he"],
  );
  assert.equal(
    vm.cores.find((c) => c.id === "m55_he").inheritedFromTopology,
    true,
  );
  assert.equal(vm.cores.find((c) => c.id === "m55_hp").inferenceArenaKib, 256);
  assert.deepEqual(
    vm.chips.map((c) => c.chipId),
    ["lsm6dso"],
  );
  assert.equal(vm.chips[0].enabled, true);
  assert.deepEqual(vm.libraries, ["etl", "mbedtls"]);
  assert.deepEqual(vm.validation.errors, []);
});

test("VM for a V2M board lights DeepX and offers the deepx chip", () => {
  const vm = buildConfiguratorViewModel(parseBoardConfig(OBJDET), catalogue());
  const acc = Object.fromEntries(
    vm.accelerators.map((a) => [a.id, a.available]),
  );
  assert.equal(acc.deepx_dxm1, true);
  assert.ok(vm.chips.some((c) => c.chipId === "deepx_dxm1"));
});

// #165: libraries are declared ONCE at the top level (ADR 0018); a CorePanel's
// `libraries` must be the top-level array resolved for that core id, honoring
// `cores:` scoping -- not a (removed) `cores.<id>.libraries` field.
test("CorePanel.libraries resolves the top-level libraries[] scoped to each core", () => {
  const board = parseBoardConfig(EDGEAI);
  board.libraries = [
    "etl", // project-wide: every core
    { name: "mbedtls", cores: ["m55_hp"] }, // scoped: only m55_hp
  ];
  const vm = buildConfiguratorViewModel(board, catalogue());
  const m55hp = vm.cores.find((c) => c.id === "m55_hp");
  const a32 = vm.cores.find((c) => c.id === "a32_cluster");
  assert.deepEqual(m55hp.libraries, ["etl", "mbedtls"]);
  assert.deepEqual(a32.libraries, ["etl"]);
});

test("VM with an empty catalogue reports disconnected and null hardware", () => {
  const empty = {
    soms: [],
    boards: [],
    chips: [],
    libraries: [],
    socs: [],
    sdkVersion: undefined,
  };
  const vm = buildConfiguratorViewModel(parseBoardConfig(EDGEAI), empty);
  assert.equal(vm.sdkConnected, false);
  assert.equal(vm.hardware, null);
  assert.deepEqual(vm.accelerators, []);
  assert.deepEqual(vm.chips, []);
  assert.deepEqual(vm.carriers.options, []);
});
