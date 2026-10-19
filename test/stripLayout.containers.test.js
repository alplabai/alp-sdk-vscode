// SPDX-License-Identifier: Apache-2.0
//
// The strip over tan 0.7.0's real AEN801 memory list, where `mram_main` is a
// resolved container spanning every other region. Pure model assertions: a
// container leaves the cell lane for its own parent row, every cell has a
// visible identifier, no two visible labels overprint, and every segment
// edge keeps an axis label at a normal width.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AEN801_REGIONS,
  V2N_REGIONS,
} = require("./helpers/memoryFixtureRegions");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/stripLayout.ts",
  );

const view = (regions) => ({
  sku: "E1M-AEN801",
  spans: [],
  unresolved: [],
  apertures: [],
  conflicts: [],
  regions,
});

const WIDTHS = [360, 480, 640, 1000, 1400];

/** Boxes [x0, x1] that must not overlap, grouped by the row they sit on. */
function visibleLabelRows(model) {
  const rows = new Map();
  const add = (key, x0, x1) => {
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push([x0, x1]);
  };
  for (const r of model.regions) {
    if (r.label.mode === "callout")
      add(`callout:${r.label.row}`, r.label.x0, r.label.x1);
    else add(`cell:${r.id}`, r.label.x0, r.label.x1);
  }
  for (const t of model.ticks) {
    if (t.labelled) add(`axis:${t.row}`, t.x0, t.x1);
  }
  return rows;
}

test("a container leaves the cell lane and gets a parent row with its label", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  assert.ok(!model.regions.some((r) => r.name === "mram_main"));
  assert.equal(model.regions.length, 6);
  assert.equal(model.parents.length, 1);
  const [p] = model.parents;
  assert.equal(p.name, "mram_main");
  assert.equal(p.depth, 0);
  assert.equal(p.left, 0);
  assert.ok(Math.abs(p.width - 1000) < 1e-6);
  assert.equal(p.tier, "unproven");
  assert.equal(p.selectable, true);
  assert.equal(p.label, "mram_main · 5.50 MiB · composite");
});

test("containment is generic: V2N's ddr_main is a parent of m33_tcm; partial overlap stays a cell", async () => {
  const { buildStrip } = await load();
  const v2n = buildStrip(view(V2N_REGIONS), new Map(), 800);
  assert.deepEqual(
    v2n.parents.map((p) => p.name),
    ["ddr_main"],
  );
  assert.ok(v2n.regions.some((r) => r.name === "m33_tcm"));
  const { region } = require("./helpers/memoryFixtureRegions");
  const partial = buildStrip(
    view([
      region("a", 0x1000, 0x2000, "locked"),
      region("b", 0x2000, 0x2000, "locked"),
    ]),
    new Map(),
    800,
  );
  assert.equal(partial.parents.length, 0);
  assert.equal(partial.regions.length, 2);
});

test("nested containers stack by depth and do not crash", async () => {
  const { buildStrip } = await load();
  const { region } = require("./helpers/memoryFixtureRegions");
  const model = buildStrip(
    view([
      region("outer", 0x1000, 0x8000, "composite"),
      region("mid", 0x2000, 0x4000, "composite"),
      region("leaf", 0x2000, 0x1000, "locked"),
    ]),
    new Map(),
    800,
  );
  const depth = Object.fromEntries(model.parents.map((p) => [p.name, p.depth]));
  assert.deepEqual(depth, { outer: 0, mid: 1 });
  assert.deepEqual(
    model.regions.map((r) => r.name),
    ["leaf"],
  );
});

test("every cell has a visible identifier: atoc and mcuboot included, at every width", async () => {
  const { buildStrip } = await load();
  for (const w of WIDTHS) {
    const model = buildStrip(view(AEN801_REGIONS), new Map(), w);
    for (const r of model.regions) {
      assert.ok(
        ["full", "ellipsis", "callout"].includes(r.label.mode),
        `${r.name}@${w}`,
      );
      assert.ok(r.label.text.length > 0, `${r.name}@${w} has text`);
    }
    for (const name of ["atoc", "mcuboot"]) {
      const r = model.regions.find((x) => x.name === name);
      assert.ok(r.label.text.startsWith(name.slice(0, 3)), `${name}@${w}`);
    }
    // An ellipsized name is a prefix of the real one; a callout is the whole.
    for (const r of model.regions) {
      if (r.label.mode === "ellipsis")
        assert.ok(r.name.startsWith(r.label.text.slice(0, -1)));
      if (r.label.mode === "callout") assert.equal(r.label.text, r.name);
    }
  }
});

test("no two visible labels overprint — cells, callouts, axis rows — at any width", async () => {
  const { buildStrip } = await load();
  for (const w of WIDTHS) {
    const model = buildStrip(view(AEN801_REGIONS), new Map(), w);
    for (const [key, boxes] of visibleLabelRows(model)) {
      const sorted = [...boxes].sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(
          sorted[i][0] >= sorted[i - 1][1],
          `${key}@${w}: [${sorted[i - 1]}] overlaps [${sorted[i]}]`,
        );
      }
    }
    // An in-cell label stays inside its own cell.
    for (const r of model.regions) {
      if (r.label.mode === "callout") continue;
      assert.ok(r.label.x0 >= r.left - 1e-6, `${r.name}@${w} left`);
      assert.ok(r.label.x1 <= r.left + r.width + 1e-6, `${r.name}@${w} right`);
    }
  }
});

test("every segment edge has an axis label at a normal width; the end stays inclusive", async () => {
  const { buildStrip } = await load();
  for (const w of [1000, 1400]) {
    const model = buildStrip(view(AEN801_REGIONS), new Map(), w);
    const unlabelled = model.ticks.filter((t) => !t.labelled);
    assert.deepEqual(
      unlabelled.map((t) => t.label),
      [],
      `width ${w}`,
    );
    assert.ok(
      model.ticks.some((t) => t.row === 1),
      "two rows are used",
    );
  }
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  const end = model.ticks.find((t) => t.isEnd);
  assert.equal(end.label, "0x8057ffff");
  assert.equal(model.ticks.filter((t) => t.isEnd).length, 1);
});

test("a narrow strip drops only the axis labels that collide on both rows", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 360);
  const kept = model.ticks.filter((t) => t.labelled);
  assert.ok(kept.length >= 2 && kept.length < model.ticks.length);
  // The window's own two ends are kept first.
  assert.ok(model.ticks[0].labelled);
  assert.ok(model.ticks[model.ticks.length - 1].labelled);
});
