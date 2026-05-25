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
    sku: "E1M-AEN701", displayName: "", family: "alif-ensemble", silicon: "",
    capabilities: {}, topologyCoreIds: ["m55_hp", "m55_he"], onModule: [],
    preliminary: false, ...partial,
  };
}

const catalogue = {
  soms: [som({ sku: "E1M-AEN701", family: "alif-ensemble" })],
  boards: [
    { name: "e1m-evk", displayName: "", hostsSomFamilies: ["alif-ensemble", "nxp-imx9"], populated: { lsm6dso: true } },
    { name: "e1m-x-evk", displayName: "", hostsSomFamilies: ["renesas-rzv2n"], populated: {} },
  ],
  chips: [], libraries: [], socs: [],
};

test("boardsForSom filters boards by the SoM family", () => {
  const boards = boardsForSom(catalogue, "E1M-AEN701");
  assert.deepEqual(boards.map((b) => b.name), ["e1m-evk"]);
});

test("boardsForSom returns [] for an unknown sku", () => {
  assert.deepEqual(boardsForSom(catalogue, "E1M-NOPE"), []);
});

test("acceleratorAvailability lights ethos_u for AEN, not deepx", () => {
  const a = acceleratorAvailability(som({ preferredBackend: "ethos_u", capabilities: {} }));
  const by = Object.fromEntries(a.map((x) => [x.id, x.available]));
  assert.equal(by.ethos_u, true);
  assert.equal(by.deepx_dxm1, false);
  assert.equal(by.cpu, true);
});

test("acceleratorAvailability lights deepx for a V2M SoM", () => {
  const a = acceleratorAvailability(som({ preferredBackend: "deepx_dxm1", capabilities: { deepx_dx: true } }));
  const by = Object.fromEntries(a.map((x) => [x.id, x.available]));
  assert.equal(by.deepx_dxm1, true);
  assert.equal(by.ethos_u, false);
});

test("chipDefaults returns the board populated map; coreIdsForSom returns topology ids", () => {
  assert.deepEqual(chipDefaults(catalogue.boards[0]), { lsm6dso: true });
  assert.deepEqual(coreIdsForSom(catalogue, "E1M-AEN701"), ["m55_hp", "m55_he"]);
});
