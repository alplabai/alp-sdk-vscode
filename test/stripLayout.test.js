// SPDX-License-Identifier: Apache-2.0
//
// The memory strip's layout model (stripLayout.ts): the geometry a reader
// clicks on, asserted without a render. railScale.test.js covers the
// log-of-size scale itself; this file covers the one mirror that turns it
// horizontal, the ticks, the series, and the gaps' own sentences.

const test = require("node:test");
const assert = require("node:assert/strict");
const { AEN_REGIONS, V2N_REGIONS } = require("./helpers/memoryFixtureRegions");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/stripLayout.ts",
  );

const view = (overrides) => ({
  sku: "TEST",
  spans: [],
  unresolved: [],
  apertures: [],
  conflicts: [],
  ...overrides,
});

const slot = (label, base) => ({
  id: `slot_image:${label}`,
  kind: "slot_image",
  label,
  base,
  deviceOffset: null,
  sizeBytes: null,
  region: null,
  device: null,
  cores: [label],
  fs: null,
});

const budget = (core, used, total) => [
  core,
  {
    core_id: core,
    os: "zephyr",
    status: "ok",
    flash: { used, total, pct: null },
    ram: { used: null, total: null, pct: null },
  },
];

test("low addresses sit at the left, and the strip fills its width exactly", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view({ regions: AEN_REGIONS }), new Map(), 1000);
  const segs = [...model.segments].sort((a, b) => a.left - b.left);
  assert.equal(segs[0].lo, 0x80000000);
  assert.equal(segs[0].left, 0);
  const last = segs[segs.length - 1];
  assert.equal(last.hi, 0x80580000);
  assert.ok(Math.abs(last.left + last.width - 1000) < 1e-6);
  for (let i = 1; i < segs.length; i++) {
    assert.ok(segs[i].lo === segs[i - 1].hi, "segments tile without holes");
  }
});

test("rpmsg-v2n: the run between ocram_low and ddr_main is a marked gap with its exact size", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view({ regions: V2N_REGIONS }), new Map(), 800);
  const gaps = model.segments.filter((s) => s.kind === "gap");
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].lo, 0x90000);
  assert.equal(gaps[0].hi, 0x48000000);
  assert.match(gaps[0].gapLabel, /0x00090000 – 0x47ffffff/);
  assert.match(
    gaps[0].gapLabel,
    /1\.12 GiB \(0x47f70000\) empty, not to scale/,
  );
  // Nested m33_tcm is drawn after its container.
  const names = model.regions.map((r) => r.name);
  assert.ok(names.indexOf("ddr_main") < names.indexOf("m33_tcm"));
  assert.equal(model.tiered, false);
  assert.ok(model.regions.every((r) => r.tier === null));
});

test("rpmsg-aen: every band carries its tier, and the window's end tick is the inclusive last byte", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view({ regions: AEN_REGIONS }), new Map(), 1000);
  assert.equal(model.tiered, true);
  const tiers = Object.fromEntries(model.regions.map((r) => [r.name, r.tier]));
  assert.equal(tiers.he_slot0, "yours");
  assert.equal(tiers.mcuboot, "locked");
  assert.equal(tiers.reserved, "unproven");
  const last = model.ticks[model.ticks.length - 1];
  assert.equal(last.address, 0x80580000);
  assert.equal(last.label, "0x8057ffff");
  assert.equal(model.ticks[0].label, "0x80000000");
});

test("tick labels never sit closer than one label width; every edge keeps its line", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view({ regions: AEN_REGIONS }), new Map(), 400);
  assert.equal(model.ticks.length, 7, "seven declared edges, seven ticks");
  const labelled = model.ticks
    .filter((t) => t.labelled)
    .sort((a, b) => a.x - b.x);
  assert.ok(labelled.length >= 2 && labelled.length < model.ticks.length);
  for (let i = 1; i < labelled.length; i++) {
    assert.ok(labelled[i].x - labelled[i - 1].x >= 10 * 7.8);
  }
  // The clamped first and last labels stay inside the strip.
  assert.ok(labelled[0].x >= 0 && labelled[labelled.length - 1].x <= 400);
});

test("a slot image is a box to its tan-size budget with a used fill; a bare base is a marker", async () => {
  const { buildStrip } = await load();
  const budgets = new Map([budget("m55_hp", 0x1847c, 0x580000)]);
  const model = buildStrip(
    view({ spans: [slot("m55_he", 0x80010000), slot("m55_hp", 0x802b0000)] }),
    budgets,
    600,
  );
  const hp = model.spans.find((s) => s.name === "m55_hp");
  const he = model.spans.find((s) => s.name === "m55_he");
  assert.equal(hp.marker, false);
  assert.ok(hp.width > 0 && hp.usedPx > 0 && hp.usedPx < hp.width);
  assert.match(hp.title, /0x802b0000 – 0x8082ffff/);
  assert.equal(he.marker, true);
  assert.equal(he.width, 0);
  assert.equal(he.usedPx, null);
  assert.match(he.title, /size not pinned/);
  // The run between the marker and the slot is a gap.
  assert.equal(model.segments.filter((s) => s.kind === "gap").length, 1);
});

test("series follow address order and wrap after six; the core rows look them up by label", async () => {
  const { seriesByLabel, SERIES_COUNT } = await load();
  const spans = Array.from({ length: 8 }, (_, i) =>
    slot(`core${7 - i}`, 0x80000000 + (7 - i) * 0x10000),
  );
  const series = seriesByLabel(spans);
  assert.equal(SERIES_COUNT, 6);
  assert.equal(series.get("core0"), 1);
  assert.equal(series.get("core5"), 6);
  assert.equal(series.get("core6"), 1);
  assert.equal(series.get("core7"), 2);
  assert.equal(seriesByLabel([slot("late", null)]).size, 0);
});

test("fewer than two distinct addresses is no strip", async () => {
  const { buildStrip } = await load();
  assert.equal(
    buildStrip(view({ spans: [slot("one", 0x80000000)] }), new Map(), 500),
    null,
  );
  assert.equal(buildStrip(view({}), new Map(), 500), null);
});
