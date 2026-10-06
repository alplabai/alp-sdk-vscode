// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the memory strip's pure row-building logic (#484), the same
// way authorityTier.test.js and railScale.test.js cover their own modules. A
// row is what the strip's selected-item detail prints in full; these tests
// assert its figures and its tier off the pure function directly, so a
// misfiled row fails regardless of how faithfully the strip paints whatever
// it was given.

const test = require("node:test");
const assert = require("node:assert/strict");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/memoryRows.ts",
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

const byName = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));

test("a placed image takes the tier of the region whose extent contains its base — not a name match", async () => {
  const { buildRows } = await load();
  // he_slot0 covers 0x80010000 - 0x802b0000. m55_he's slot image lands at
  // 0x80010000 and, like every slot image, carries no `region` name at all
  // — a name join once put it in "unproven" beside a "yours" he_slot0.
  const regions = [
    region({
      name: "he_slot0",
      base: 0x80010000,
      sizeBytes: 0x2a0000,
      writeAuthority: "customer_image",
      authorityClass: "customer_image",
    }),
  ];
  const spans = [span({ label: "m55_he", base: 0x80010000 })];
  const rows = byName(buildRows(regions, spans, new Map(), null));
  assert.equal(rows.m55_he.tier, "yours");
  assert.equal(rows.he_slot0.tier, "yours");
  assert.equal(rows.m55_he.authorityText, "customer · written at flash time");
  assert.ok(rows.m55_he.accessibleName.includes("customer_image"));
});

test("containment fails closed to unproven when nothing, or more than one region, contains the address", async () => {
  const { buildRows } = await load();
  const none = buildRows(
    [
      region({
        name: "r",
        base: 0x1000,
        sizeBytes: 0x1000,
        authorityClass: "customer_image",
      }),
    ],
    [span({ label: "m55_he", base: 0x80010000 })],
    new Map(),
    null,
  );
  assert.equal(byName(none).m55_he.tier, "unproven");
  assert.ok(
    byName(none).m55_he.accessibleName.includes("authority not joined"),
  );
  const two = buildRows(
    [
      region({
        name: "a",
        base: 0x80000000,
        sizeBytes: 0x100000,
        authorityClass: "customer_image",
      }),
      region({
        name: "b",
        base: 0x80010000,
        sizeBytes: 0x1000,
        authorityClass: "customer_image",
      }),
    ],
    [span({ label: "m55_he", base: 0x80010000 })],
    new Map(),
    null,
  );
  assert.equal(byName(two).m55_he.tier, "unproven");
  const noBase = buildRows([], [span({ label: "late" })], new Map(), null);
  assert.equal(noBase[0].tier, "unproven");
  assert.equal(noBase[0].range, "—");
});

test("the DECLARED name join (span.region) is a separate question from containment", async () => {
  const { buildRows } = await load();
  const regions = [
    region({ name: "mram_main", base: 0x80000000, sizeBytes: 0x580000 }),
  ];
  const rows = buildRows(
    regions,
    [
      span({
        id: "carve_out:alp_shmem0",
        kind: "carve_out",
        label: "alp_shmem0",
        base: 0x80540000,
        sizeBytes: 0x40000,
        region: "mram_main",
      }),
      span({
        id: "carve_out:orphan",
        kind: "carve_out",
        label: "orphan",
        base: 0x80540000,
        sizeBytes: 0x1000,
        region: "nowhere",
      }),
    ],
    new Map(),
    null,
  );
  const r = byName(rows);
  assert.equal(r.alp_shmem0.note, "extent from region mram_main");
  assert.equal(
    r.orphan.note,
    'names region "nowhere", which this manifest does not resolve',
  );
  assert.equal(r.mram_main.note, "used by alp_shmem0");
});

test("ranges print the inclusive last byte, sizes print exactly, and a wide address keeps its width", async () => {
  const { buildRows } = await load();
  const { V2N_REGIONS } = require("./helpers/memoryFixtureRegions");
  const rows = byName(buildRows(V2N_REGIONS, [], new Map(), null));
  assert.equal(rows.ddr_main.range, "0x48000000 – 0x147ffffff");
  assert.equal(rows.ddr_main.sizeText, "4 GiB");
  assert.equal(rows.ddr_main.sizeHex, "0x100000000");
  assert.equal(rows.m33_tcm.range, "0x80000000 – 0x8001ffff");
  assert.equal(rows.ocram_low.sizeText, "512 KiB");
});

test("a region with a base and no size says so, and one with neither says its address is unresolved", async () => {
  const { buildRows } = await load();
  const rows = byName(
    buildRows(
      [
        region({ name: "sizeless", base: 0x90000000 }),
        region({ name: "lost", status: "unresolved", sizeBytes: 0x1000 }),
      ],
      [],
      new Map(),
      null,
    ),
  );
  assert.equal(rows.sizeless.range, "0x90000000 – size unresolved");
  assert.equal(rows.sizeless.sizeText, "size not pinned by this manifest");
  assert.equal(rows.lost.range, "address unresolved");
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
  );
  assert.equal(rows[0].range, "+0x1847c in ospi0");
  assert.equal(rows[0].kindText, "partition");
});

test("authority is declared only when some region says so — never by the fail-closed default", async () => {
  const { authorityDeclared } = await load();
  assert.equal(authorityDeclared([]), false);
  assert.equal(authorityDeclared([region({ name: "r" })]), false);
  assert.equal(
    authorityDeclared([
      region({ name: "r" }),
      region({
        name: "res",
        writeAuthority: "none",
        authorityClass: "reserved",
      }),
    ]),
    true,
  );
});

test("a slot image row carries range, size + hex, and used in both spellings with its source", async () => {
  const { buildRows } = await load();
  const spans = [span({ label: "m55_he", base: 0x80010000 })];
  const budgets = new Map([
    [
      "m55_he",
      {
        core_id: "m55_he",
        os: "zephyr",
        status: "ok",
        flash: { used: 97792, total: 0x2a0000, pct: null },
        ram: { used: null, total: null, pct: null },
      },
    ],
  ]);
  const [row] = buildRows([], spans, budgets, null);
  assert.equal(row.range, "0x80010000 – 0x802affff");
  assert.equal(row.sizeText, "2.63 MiB");
  assert.equal(row.sizeHex, "0x2a0000");
  assert.equal(row.sizeNote, "from tan size");
  assert.equal(row.usedText, "95.5 KiB · 3.6%");
  assert.equal(row.usedHex, "0x17e00");
  assert.equal(row.usedNote, "from tan size");
});

test("an image larger than its pinned slot prints the bytes tan size measured", async () => {
  const { buildRows } = await load();
  // The manifest pins a 64 KiB slot; tan size measured a 96 KiB image.
  const spans = [
    span({ label: "m55_he", base: 0x80010000, sizeBytes: 0x10000 }),
  ];
  const budgets = new Map([
    [
      "m55_he",
      {
        core_id: "m55_he",
        os: "zephyr",
        status: "over",
        flash: { used: 0x18000, total: 0x2a0000, pct: null },
        ram: { used: null, total: null, pct: null },
      },
    ],
  ]);
  const [row] = buildRows([], spans, budgets, null);
  assert.equal(row.usedHex, "0x18000");
  assert.equal(row.usedText, "96 KiB · 150%");
  assert.equal(row.usedNote, "exceeds the slot · from tan size");
});

test("an unmeasured slot image says 'size unknown'; a region has no used figure", async () => {
  const { buildRows } = await load();
  const rows = byName(
    buildRows(
      [region({ name: "r", base: 0x1000, sizeBytes: 0x1000 })],
      [span({ label: "m55_he", base: 0x80010000, sizeBytes: 0x1000 })],
      new Map(),
      null,
    ),
  );
  assert.equal(rows.m55_he.usedText, "size unknown");
  assert.equal(rows.m55_he.usedHex, null);
  assert.equal(rows.r.usedText, null);
});

test("a duplicated region name is inert, never selected, and says why", async () => {
  const { buildRows } = await load();
  const dupes = [
    region({ name: "dup", base: 0x80600000, sizeBytes: 0x1000 }),
    region({ name: "dup", base: 0x80610000, sizeBytes: 0x1000 }),
  ];
  const rows = buildRows(dupes, [], new Map(), "memory:dup");
  assert.deepEqual(
    rows.map((r) => [r.inert, r.selected, r.note]),
    [
      [true, false, "name shared by 2 rows, not joined"],
      [true, false, "name shared by 2 rows, not joined"],
    ],
  );
  assert.notEqual(rows[0].key, rows[1].key);
});

test("an unplaced entry keeps its verbatim reason and its status word; a region that resolves no extent becomes a ghost too", async () => {
  const { buildUnplacedRows, unresolvedRegionRows } = await load();
  const reason =
    "memory_map.base is TBD for region 'mram_main' in SoM E1M-AEN801; this SoM hasn't been HW-mapped yet.";
  const [ghost] = buildUnplacedRows([
    {
      id: "carve_out:alp_default_rpmsg",
      kind: "carve_out",
      label: "alp_default_rpmsg",
      cores: ["m55_hp", "a32_cluster"],
      status: "blocked",
      reason,
    },
  ]);
  assert.equal(ghost.statusText, "Blocked");
  assert.equal(ghost.reason, reason);
  assert.equal(ghost.kindText, "carve-out");
  assert.ok(ghost.accessibleName.includes(reason));

  const { AEN_REGIONS } = require("./helpers/memoryFixtureRegions");
  const unresolved = region({
    name: "mram_main",
    status: "unresolved",
    sizeBytes: 0x580000,
    authorityClass: "composite",
    reason: "Region 'mram_main' declares `base: TBD`.",
  });
  const ghosts = unresolvedRegionRows([...AEN_REGIONS, unresolved]);
  assert.deepEqual(
    ghosts.map((g) => [g.name, g.statusText, g.sizeText]),
    [["mram_main", "Unresolved", "5.50 MiB"]], // 5.5 MiB is exact, so no hex
  );
  assert.equal(ghosts[0].reason, unresolved.reason);
});
