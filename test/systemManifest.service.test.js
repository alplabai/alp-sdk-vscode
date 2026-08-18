const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseSystemManifest,
  zephyrCoreIds,
  SystemManifestError,
} = require("../packages/alp-core/dist/systemManifest/service.js");
const {
  isActiveSlice,
} = require("../packages/alp-core/dist/systemManifest/models.js");

// Ground truth: the real `--emit system-manifest` output for the heterogeneous
// AEN801 example (off A-core + two Zephyr M-cores + a helper MCU).
const FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "system-manifest.aen801.yaml"),
  "utf-8",
);

test("parseSystemManifest reads the real AEN801 manifest", () => {
  const m = parseSystemManifest(FIXTURE);
  assert.equal(m.schema_version, 1);
  assert.equal(m.hw_info.sku, "E1M-AEN801");
  assert.equal(m.slices.length, 3);
  // a32 is os: off -> not active; both M55 cores are.
  assert.equal(m.slices.filter(isActiveSlice).length, 2);

  const a32 = m.slices.find((s) => s.core_id === "a32_cluster");
  assert.equal(a32.os, "off");
  assert.equal(a32.flash_method, undefined); // omitted by emitter, tolerated

  const hp = m.slices.find((s) => s.core_id === "m55_hp");
  assert.equal(hp.flash_method, "zephyr_west_flash");

  // Helper MCU keeps its string flash_args + the undeclared `note` field.
  assert.equal(m.helper_mcus.length, 1);
  assert.equal(m.helper_mcus[0].chip, "cc3501e");
  assert.equal(m.helper_mcus[0].flash_args, "TBD");
});

test("parseSystemManifest tolerates unknown additive-v1 fields", () => {
  const m = parseSystemManifest(`${FIXTURE}\nfuture_block:\n  anything: 1\n`);
  assert.equal(m.slices.length, 3);
});

test("parseSystemManifest rejects an unsupported schema_version", () => {
  assert.throws(
    () => parseSystemManifest("schema_version: 2\nslices: []\n"),
    SystemManifestError,
  );
  assert.throws(
    () => parseSystemManifest("slices: []\n"), // missing schema_version
    SystemManifestError,
  );
});

test("zephyrCoreIds lists every Zephyr core in manifest order", () => {
  // The E1M-AEN801 shape: two Zephyr slices plus a Yocto A-core. The Renode
  // core picker and the debug slice resolver both key off this.
  const manifest = parseSystemManifest(`
schema_version: 1
hw_info:
  sku: E1M-AEN801
slices:
- core_id: a32_cluster
  os: yocto
  status: skipped
- core_id: m55_hp
  os: zephyr
  status: ok
- core_id: m55_he
  os: zephyr
  status: ok
`);
  assert.deepStrictEqual(zephyrCoreIds(manifest), ["m55_hp", "m55_he"]);
});

test("zephyrCoreIds keeps a non-ok slice", () => {
  // Deliberate: a failed/skipped core is still a core, and the tool acting on
  // it is the one that knows whether it can — the CLI refuses a stale artefact
  // with a message naming the reason. Filtering here would hide that.
  const manifest = parseSystemManifest(`
schema_version: 1
slices:
- core_id: m55_hp
  os: zephyr
  status: failed
`);
  assert.deepStrictEqual(zephyrCoreIds(manifest), ["m55_hp"]);
});

test("zephyrCoreIds is empty for an all-Yocto manifest", () => {
  const manifest = parseSystemManifest(`
schema_version: 1
slices:
- core_id: a32_cluster
  os: yocto
  status: ok
`);
  assert.deepStrictEqual(zephyrCoreIds(manifest), []);
});
