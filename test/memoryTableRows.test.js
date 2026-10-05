// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the unified memory map's pure row-building logic (#484
// phase 3), the same way authorityTier.test.js and railScale.test.js
// cover their own modules. The tier derivation and sort order were
// component-local in MemoryTable.tsx — a harness assertion reading a
// row's rendered `data-tier` against the very field that placed it in
// its group could never disagree with itself. These tests assert group
// MEMBERSHIP by name, off the pure function directly, so a misfiled row
// fails regardless of how faithfully the swatch renders whatever tier it
// was given.

const test = require("node:test");
const assert = require("node:assert/strict");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/memoryTableRows.ts",
  );

/** A minimal, fully-resolved `MemoryRegion`. */
function region(overrides) {
  return {
    id: `memory:${overrides.name}`,
    name: overrides.name,
    source: "som_preset",
    kind: "flash",
    status: "ok",
    base: null,
    sizeBytes: null,
    writeAuthority: null,
    authorityClass: "unstated",
    cores: [],
    reason: null,
    ...overrides,
  };
}

/** A minimal `MemorySpan`. */
function span(overrides) {
  return {
    id: `slot_image:${overrides.label}`,
    kind: "slot_image",
    label: overrides.label,
    base: null,
    deviceOffset: null,
    sizeBytes: null,
    region: null,
    device: null,
    cores: [],
    fs: null,
    ...overrides,
  };
}

test("a placed image takes the tier of the region whose extent contains its base — not a name match", async () => {
  const { buildRows } = await load();
  // he_slot0 covers 0x80010000 - 0x802b0000. m55_he's slot image lands at
  // 0x80010000 and, like every slot image, carries no `region` name at
  // all (memoryView.ts's slotSpans always sets it null) — the OLD
  // name-based derivation could only ever answer "unproven" here.
  const regions = [
    region({
      name: "he_slot0",
      base: 0x80010000,
      sizeBytes: 0x2a0000,
      writeAuthority: "customer_image",
      authorityClass: "customer_image",
    }),
  ];
  const spans = [span({ label: "m55_he", base: 0x80010000, region: null })];
  const rows = buildRows(regions, spans, new Map(), null, null);
  assert.equal(
    rows.find((r) => r.name === "m55_he").tier,
    "yours",
    "a span whose base falls inside a customer_image region's extent must share its tier",
  );
});

test("containment fails closed to unproven when nothing contains the address", async () => {
  const { buildRows } = await load();
  const regions = [
    region({
      name: "he_slot0",
      base: 0x80010000,
      sizeBytes: 0x2a0000,
      writeAuthority: "customer_image",
      authorityClass: "customer_image",
    }),
  ];
  const spans = [span({ label: "orphan", base: 0x90000000 })];
  const rows = buildRows(regions, spans, new Map(), null, null);
  assert.equal(rows.find((r) => r.name === "orphan").tier, "unproven");
});

test("containment fails closed to unproven when two resolved regions both cover the address — never guessed", async () => {
  const { buildRows } = await load();
  const regions = [
    region({
      name: "outer",
      base: 0x80000000,
      sizeBytes: 0x100000,
      writeAuthority: "customer_image",
      authorityClass: "customer_image",
    }),
    region({
      name: "inner",
      base: 0x80000000,
      sizeBytes: 0x1000,
      writeAuthority: "vendor_image",
      authorityClass: "locked",
    }),
  ];
  const spans = [span({ label: "straddler", base: 0x80000000 })];
  const rows = buildRows(regions, spans, new Map(), null, null);
  assert.equal(rows.find((r) => r.name === "straddler").tier, "unproven");
});

test("a span with no base never claims containment", async () => {
  const { buildRows } = await load();
  const regions = [
    region({
      name: "he_slot0",
      base: 0x80010000,
      sizeBytes: 0x2a0000,
      writeAuthority: "customer_image",
      authorityClass: "customer_image",
    }),
  ];
  const spans = [
    span({
      label: "storage_part",
      kind: "partition",
      base: null,
      deviceOffset: 0,
      sizeBytes: 4096,
      device: "flash0",
    }),
  ];
  const rows = buildRows(regions, spans, new Map(), null, null);
  assert.equal(rows.find((r) => r.name === "storage_part").tier, "unproven");
});

test("the DECLARED name join (span.region) is a separate question from containment", async () => {
  // A carve-out can name a region by `carve_out_region` (the aperture it
  // was allocated FROM) that is NOT the region whose extent contains its
  // base — the two joins must not be conflated into one answer.
  const { buildRows } = await load();
  const regions = [
    region({
      name: "named_from",
      base: 0x90000000,
      sizeBytes: 0x1000,
      writeAuthority: "customer_runtime",
      authorityClass: "customer_runtime",
    }),
    region({
      name: "actually_contains",
      base: 0x80000000,
      sizeBytes: 0x1000,
      writeAuthority: "vendor_image",
      authorityClass: "locked",
    }),
  ];
  const spans = [
    span({
      label: "carve1",
      kind: "carve_out",
      base: 0x80000000,
      sizeBytes: 0x100,
      region: "named_from",
    }),
  ];
  const rows = buildRows(regions, spans, new Map(), null, null);
  const row = rows.find((r) => r.name === "carve1");
  assert.equal(
    row.tier,
    "locked",
    "tier follows containment (actually_contains), not the declared carve_out_region name",
  );
  assert.equal(
    row.note,
    "extent from region named_from",
    "the declared join still names the aperture the manifest says it came from",
  );
});

test("at an equal base, the region sorts before the span it contains", async () => {
  const { compareRows } = await load();
  const regionRow = { origin: "region", base: 0x80010000, name: "he_slot0" };
  const spanRow = { origin: "span", base: 0x80010000, name: "m55_he" };
  const sorted = [spanRow, regionRow].sort(compareRows);
  assert.deepEqual(
    sorted.map((r) => r.name),
    ["he_slot0", "m55_he"],
  );
});

test("groupRowsByTier puts every row in the group its NAME belongs in, not the field under test", async () => {
  const { buildRows, groupRowsByTier } = await load();
  const regions = [
    region({
      name: "mcuboot",
      base: 0x80000000,
      sizeBytes: 0x10000,
      writeAuthority: "vendor_image",
      authorityClass: "locked",
    }),
    region({
      name: "he_slot0",
      base: 0x80010000,
      sizeBytes: 0x2a0000,
      writeAuthority: "customer_image",
      authorityClass: "customer_image",
    }),
    region({
      name: "reserved",
      base: 0x80540000,
      sizeBytes: 0x10000,
      writeAuthority: "none",
      authorityClass: "reserved",
    }),
  ];
  const spans = [span({ label: "m55_he", base: 0x80010000, region: null })];
  const rows = buildRows(regions, spans, new Map(), null, null);
  const byTier = groupRowsByTier(rows);
  assert.deepEqual(
    byTier.yours.map((r) => r.name),
    ["he_slot0", "m55_he"],
  );
  assert.deepEqual(
    byTier.locked.map((r) => r.name),
    ["mcuboot"],
  );
  assert.deepEqual(
    byTier.unproven.map((r) => r.name),
    ["reserved"],
  );
});

test("ranges print the inclusive last byte, sizes print exactly, and one view pads to its widest address", async () => {
  const { buildRows } = await load();
  const {
    V2N_REGIONS,
    AEN_REGIONS,
  } = require("./helpers/memoryFixtureRegions");
  const aen = buildRows(AEN_REGIONS, [], new Map(), null, null);
  const he = aen.find((r) => r.name === "he_slot0");
  assert.equal(he.range, "0x80010000 – 0x802affff");
  assert.equal(he.size, "2.63 MiB (0x2a0000)");
  assert.equal(aen.find((r) => r.name === "mcuboot").size, "64 KiB");

  const v2n = buildRows(V2N_REGIONS, [], new Map(), null, null);
  const byName = Object.fromEntries(v2n.map((r) => [r.name, r]));
  // An 8-digit floor, never view-wide up-padding: 32-bit addresses keep
  // eight digits and ddr_main's last byte keeps its natural nine.
  assert.equal(byName.ddr_main.range, "0x48000000 – 0x147ffffff");
  assert.equal(byName.ddr_main.size, "4 GiB");
  assert.equal(byName.ocram_low.range, "0x00010000 – 0x0008ffff");
  assert.equal(byName.m33_tcm.range, "0x80000000 – 0x8001ffff");
});

test("no resolved region is outside the shared window (ddr_main and m33_tcm included)", async () => {
  const { buildRows } = await load();
  const { chartWindowOf } = await (
    await import("./webview/esbuildImport.mjs")
  ).importWebviewModule("features/build-plan/regionWindow.ts");
  const { V2N_REGIONS } = require("./helpers/memoryFixtureRegions");
  const win = chartWindowOf([], new Map(), V2N_REGIONS);
  const rows = buildRows(V2N_REGIONS, [], new Map(), win, null);
  assert.deepEqual(
    rows.filter((r) => r.outside).map((r) => r.name),
    [],
  );
});

test("a sizeless region whose base lies above the window is flagged outside", async () => {
  const { buildRows } = await load();
  const { chartWindowOf } = await (
    await import("./webview/esbuildImport.mjs")
  ).importWebviewModule("features/build-plan/regionWindow.ts");
  const { AEN_REGIONS, region } = require("./helpers/memoryFixtureRegions");
  // A base with no size never shapes the window, so 0x90000000 sits above
  // the AEN window's hi (0x80580000); a zero size counts as no size too.
  const sizeless = { ...region("far_flash", 0x90000000, null, "unstated") };
  const zero = { ...region("zero_size", 0x90100000, 0, "unstated") };
  const regions = [...AEN_REGIONS, sizeless, zero];
  const win = chartWindowOf([], new Map(), regions);
  assert.equal(win.hi, 0x80580000);
  const rows = buildRows(regions, [], new Map(), win, null);
  assert.deepEqual(
    rows.filter((r) => r.outside).map((r) => r.name),
    ["far_flash", "zero_size"],
  );
});

test("a partition's device offset prints exactly, in hex", async () => {
  const { buildRows } = await load();
  const rows = buildRows(
    [],
    [
      span({
        id: "partition:storage",
        kind: "partition",
        label: "storage",
        deviceOffset: 0x1847c,
        device: "ospi0",
      }),
    ],
    new Map(),
    null,
    null,
  );
  assert.equal(rows[0].range, "+0x1847c in ospi0");
});
