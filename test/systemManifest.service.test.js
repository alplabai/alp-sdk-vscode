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

// Ground truth: a BYTE-EXACT copy of alp-sdk's own governed golden
// `tests/fixtures/emit-snapshots/rpmsg-aen.system-manifest.snap` at tag
// `v0.16.0` — SKU E1M-AEN801, a Yocto A-core plus two Zephyr M-cores, a
// `blocked` rpmsg link, and one helper MCU with `flash_policy: recovery_only`.
// Regenerate (never hand-patch) with:
//   cd alp-sdk-upstream && PYTHONPATH=scripts python3 -m alp_orchestrate \
//     --input examples/multicore/rpmsg-aen/board.yaml --emit system-manifest
// Upstream's `check_emit_snapshots.py` keeps that command byte-identical to
// the golden, so this fixture is governed on both sides.
//
// It replaced a file this header used to call "the real output" while it was
// in fact a v0.7.0 E1M-AEN701 emit with `sku`/`silicon` string-substituted
// (`eb2d77d6`) — it still carried `machine: e1m-aen701-a32`. The shapes that
// vintage happened to cover and this one does not are in `LEGACY_SHAPES`.
const FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "system-manifest.aen801.yaml"),
  "utf-8",
);

// An `off` A-core with no `flash_method`, and a helper whose recipe is not
// finalized so `flash_args` is the STRING "TBD". Both are live reader paths
// (`isActiveSlice`, the flash_args union) that the current golden does not
// exercise; constructed inline so it is plain they are not measured.
const LEGACY_SHAPES = [
  "schema_version: 1",
  "hw_info:",
  "  sku: E1M-AEN801",
  "slices:",
  "- core_id: a32_cluster",
  "  os: 'off'",
  "  status: pending",
  "helper_mcus:",
  "- name: cc3501e_otp",
  "  chip: cc3501e",
  "  flash_args: TBD",
  // An undeclared key INSIDE a helper item. This is the `[key: string]:
  // unknown` tolerance `update_channel` rode in on before v0.16.0 modelled it,
  // and the only other additive test appends a ROOT-level block, not this.
  "  note: firmware_path TBD; populated when the upstream release lands",
  "",
].join("\n");

test("parseSystemManifest reads the real AEN801 manifest", () => {
  const m = parseSystemManifest(FIXTURE);
  assert.equal(m.schema_version, 1);
  assert.equal(m.hw_info.sku, "E1M-AEN801");
  assert.equal(m.slices.length, 3);
  // Every core in this example builds — the A-core runs Yocto here.
  assert.equal(m.slices.filter(isActiveSlice).length, 3);

  const a32 = m.slices.find((s) => s.core_id === "a32_cluster");
  assert.equal(a32.os, "yocto");
  assert.equal(a32.flash_method, "yocto_wic_to_sd_or_emmc");

  const hp = m.slices.find((s) => s.core_id === "m55_hp");
  assert.equal(hp.flash_method, "zephyr_west_flash");
  // Verbatim, quoted-hex: the manifest pins WHERE the image loads, and a
  // reformatted copy would name a different place in MRAM.
  assert.equal(hp.flash_args.slot0_load_address, "0x802b0000");
  const he = m.slices.find((s) => s.core_id === "m55_he");
  assert.equal(he.flash_args.slot0_load_address, "0x80010000");

  // The helper MCU, with the authority key that became REQUIRED at v0.16.0.
  assert.equal(m.helper_mcus.length, 1);
  assert.equal(m.helper_mcus[0].chip, "cc3501e");
  assert.equal(m.helper_mcus[0].flash_policy, "recovery_only");
  assert.equal(m.helper_mcus[0].update_channel, "alp_ota_spi_otp");
  // Independent facts: a field-update channel does not imply a flash method.
  assert.equal(m.helper_mcus[0].flash_method, undefined);

  // A blocked link is reported with its reason, never silently dropped.
  assert.equal(m.ipc.length, 1);
  assert.equal(m.ipc[0].status, "blocked");
  assert.match(
    m.ipc[0].reason,
    /memory_map\.base is TBD for region 'mram_main'/,
  );
});

test("an off A-core and a string flash_args still read the way they did", () => {
  const m = parseSystemManifest(LEGACY_SHAPES);
  const a32 = m.slices.find((s) => s.core_id === "a32_cluster");
  assert.equal(a32.os, "off");
  assert.equal(a32.flash_method, undefined); // omitted upstream, tolerated
  assert.equal(m.slices.filter(isActiveSlice).length, 0);
  // The STRING, not an object and not coerced into one.
  assert.equal(m.helper_mcus[0].flash_args, "TBD");
  // No policy declared is distinct from every declared value.
  assert.equal(m.helper_mcus[0].flash_policy, undefined);
  // An undeclared key inside a helper item survives the parse verbatim.
  assert.equal(
    m.helper_mcus[0].note,
    "firmware_path TBD; populated when the upstream release lands",
  );
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
