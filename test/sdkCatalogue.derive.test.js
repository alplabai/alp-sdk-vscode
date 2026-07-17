const test = require("node:test");
const assert = require("node:assert/strict");

const {
  boardsForSom,
  acceleratorAvailability,
  chipDefaults,
  coreIdsForSom,
} = require("../packages/alp-core/dist/sdkCatalogue/derive.js");

function som(partial) {
  return {
    sku: "E1M-AEN801",
    displayName: "",
    family: "alif-ensemble",
    silicon: "",
    capabilities: {},
    topologyCoreIds: ["m55_hp", "m55_he"],
    onModule: [],
    preliminary: false,
    ...partial,
  };
}

const catalogue = {
  soms: [som({ sku: "E1M-AEN801", family: "alif-ensemble" })],
  boards: [
    {
      name: "e1m-evk",
      displayName: "",
      hostsSomFamilies: ["alif-ensemble", "nxp-imx9"],
      populated: { lsm6dso: true },
    },
    {
      name: "e1m-x-evk",
      displayName: "",
      hostsSomFamilies: ["renesas-rzv2n"],
      populated: {},
    },
  ],
  chips: [],
  libraries: [],
  socs: [],
};

test("boardsForSom filters boards by the SoM family", () => {
  const boards = boardsForSom(catalogue, "E1M-AEN801");
  assert.deepEqual(
    boards.map((b) => b.name),
    ["e1m-evk"],
  );
});

test("boardsForSom returns [] for an unknown sku", () => {
  assert.deepEqual(boardsForSom(catalogue, "E1M-NOPE"), []);
});

test("acceleratorAvailability lights ethos_u for AEN, not deepx", () => {
  const a = acceleratorAvailability(
    som({ preferredBackend: "ethos_u", capabilities: {} }),
  );
  const by = Object.fromEntries(a.map((x) => [x.id, x.available]));
  assert.equal(by.ethos_u, true);
  assert.equal(by.deepx_dxm1, false);
  assert.equal(by.cpu, true);
});

test("acceleratorAvailability lights deepx for a V2M SoM", () => {
  const a = acceleratorAvailability(
    som({ preferredBackend: "deepx_dxm1", capabilities: { deepx_dx: true } }),
  );
  const by = Object.fromEntries(a.map((x) => [x.id, x.available]));
  assert.equal(by.deepx_dxm1, true);
  assert.equal(by.ethos_u, false);
});

test("chipDefaults returns the board populated map", () => {
  assert.deepEqual(chipDefaults(catalogue.boards[0]), { lsm6dso: true });
});

test("coreIdsForSom returns the SoM topology core ids", () => {
  assert.deepEqual(coreIdsForSom(catalogue, "E1M-AEN801"), [
    "m55_hp",
    "m55_he",
  ]);
});

const {
  chipFamilyForSku,
  chipsForSom,
} = require("../packages/alp-core/dist/sdkCatalogue/derive.js");

test("chipFamilyForSku maps SKU prefixes to chip family tokens", () => {
  assert.equal(chipFamilyForSku("E1M-AEN801"), "aen");
  assert.equal(chipFamilyForSku("E1M-NX9101"), "imx93");
  assert.equal(chipFamilyForSku("E1M-V2N101"), "v2n");
  assert.equal(chipFamilyForSku("E1M-V2M101"), "v2n-m1");
  assert.equal(chipFamilyForSku("E1M-NOPE"), undefined);
  assert.equal(chipFamilyForSku(""), undefined);
});

test("chipsForSom filters chips by the SKU's family token", () => {
  const cat = {
    soms: [],
    boards: [],
    libraries: [],
    socs: [],
    chips: [
      {
        chipId: "lsm6dso",
        displayName: "",
        families: ["aen", "v2n", "v2n-m1"],
      },
      { chipId: "deepx_dxm1", displayName: "", families: ["v2n-m1"] },
      { chipId: "imx_only", displayName: "", families: ["imx93"] },
    ],
  };
  assert.deepEqual(
    chipsForSom(cat, "E1M-AEN801").map((c) => c.chipId),
    ["lsm6dso"],
  );
  assert.deepEqual(
    chipsForSom(cat, "E1M-V2M101").map((c) => c.chipId),
    ["lsm6dso", "deepx_dxm1"],
  );
  assert.deepEqual(
    chipsForSom(cat, "E1M-NX9101").map((c) => c.chipId),
    ["imx_only"],
  );
  assert.deepEqual(chipsForSom(cat, "E1M-NOPE"), []);
});

test("chipsForSom accepts the vendor family alias (nxp-imx9) for i.MX 9", () => {
  const cat = {
    soms: [],
    boards: [],
    libraries: [],
    socs: [],
    chips: [
      { chipId: "imx_only", displayName: "", families: ["imx93"] },
      {
        chipId: "murata_lbee5pl2dl",
        displayName: "",
        families: ["nxp-imx9"],
      },
    ],
  };
  assert.deepEqual(
    chipsForSom(cat, "E1M-NX9101").map((c) => c.chipId),
    ["imx_only", "murata_lbee5pl2dl"],
  );
});
