const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadSdkCatalogue } = require("../out/sdkCatalogue/vscodeAdapter.js");

function writeTree(root) {
  const m = path.join(root, "metadata");
  fs.mkdirSync(path.join(m, "e1m_modules"), { recursive: true });
  fs.mkdirSync(path.join(m, "boards"), { recursive: true });
  fs.mkdirSync(path.join(m, "chips"), { recursive: true });
  fs.mkdirSync(path.join(m, "socs", "alif", "ensemble"), { recursive: true });
  fs.mkdirSync(path.join(m, "library-profiles", "etl"), { recursive: true });
  fs.mkdirSync(path.join(m, "library-profiles", "fmt"), { recursive: true });

  fs.writeFileSync(path.join(m, "e1m_modules", "E1M-AEN701.yaml"),
    "sku: E1M-AEN701\nfamily: alif-ensemble\nsilicon: alif:ensemble:e7\ndisplay_name: AEN701\ninference:\n  preferred_backend: ethos_u\ntopology:\n  m55_hp: { app: x }\ndefault_board: E1M-EVK\nstatus: { preliminary: false }\n");
  fs.writeFileSync(path.join(m, "e1m_modules", "README.md"), "# not a sku\n");
  fs.writeFileSync(path.join(m, "boards", "e1m-evk.yaml"),
    "name: e1m-evk\ndisplay_name: EVK\nhosts_som_families: [alif-ensemble]\npopulated: { lsm6dso: true }\n");
  fs.writeFileSync(path.join(m, "chips", "lsm6dso.yaml"),
    "chip_id: lsm6dso\ndisplay_name: LSM6DSO\nvendor: st\nbus: i2c\nfamilies: [aen]\n");
  fs.writeFileSync(path.join(m, "socs", "alif", "ensemble", "e7.json"),
    JSON.stringify({ ref: "alif:ensemble:e7", vendor: "Alif", family: "Ensemble", part: "E7", cores: [] }));
  fs.writeFileSync(path.join(m, "sdk_version.yaml"), 'version: "0.6.0"\nstatus: development\n');
}

test("loadSdkCatalogue reads the real metadata layout", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alpsdk-"));
  try {
    writeTree(root);
    const cat = loadSdkCatalogue(root);
    assert.deepEqual(cat.soms.map((s) => s.sku), ["E1M-AEN701"]); // README.md ignored
    assert.deepEqual(cat.boards.map((b) => b.name), ["e1m-evk"]);
    assert.deepEqual(cat.chips.map((c) => c.chipId), ["lsm6dso"]);
    assert.deepEqual(cat.libraries.map((l) => l.id).sort(), ["etl", "fmt"]);
    assert.equal(cat.socs.length, 1);
    assert.equal(cat.sdkVersion, "0.6.0");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("loadSdkCatalogue returns empty catalogue for a missing root", () => {
  const cat = loadSdkCatalogue(null);
  assert.deepEqual(cat, { soms: [], boards: [], chips: [], libraries: [], socs: [], sdkVersion: undefined });
});
