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

const DROPPED_AT_360 = ["0x80578000"];

const WIDTHS = [320, 360, 480, 640, 1000, 1400];

/** Boxes [x0, x1] that must not overlap, grouped by where they are drawn:
 *  ALL in-cell labels share one group, so a label printing through a
 *  neighbour's is caught across cells, not only within one. */
function visibleLabelRows(model) {
  const rows = new Map();
  const add = (key, x0, x1) => {
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push([x0, x1]);
  };
  for (const r of model.regions) {
    if (r.label.mode === "callout")
      add(`callout:${r.label.row}`, r.label.x0, r.label.x1);
    else if (r.label.mode !== "overflow") add("cells", r.label.x0, r.label.x1);
  }
  for (const t of model.ticks) {
    if (t.labelled) add(`axis:${t.row}`, t.x0, t.x1);
  }
  return rows;
}

function assertNoOverprint(model, tag) {
  for (const [key, boxes] of visibleLabelRows(model)) {
    const sorted = [...boxes].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i][0] >= sorted[i - 1][1],
        `${key}@${tag}: [${sorted[i - 1]}] overlaps [${sorted[i]}]`,
      );
    }
    for (const [x0, x1] of sorted) {
      assert.ok(
        x0 >= -1e-6 && x1 <= model.width + 1e-6,
        `${key}@${tag} inside strip`,
      );
    }
  }
  // No cell may contain another: that is a container, and it belongs in the
  // parent row, not the cell lane.
  for (const a of model.regions)
    for (const b of model.regions)
      if (
        a !== b &&
        a.left <= b.left &&
        b.left + b.width <= a.left + a.width &&
        a.width > b.width + 1e-6
      )
        assert.fail(`${a.name} contains ${b.name} in the cell lane @${tag}`);
}

test("a container leaves the cell lane and gets a parent row with its label", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  assert.ok(!model.regions.some((r) => r.name === "mram_main"));
  assert.equal(model.regions.length, 6);
  assert.equal(model.parents.length, 1);
  const [p] = model.parents;
  assert.equal(p.name, "mram_main");
  assert.equal(p.row, 0);
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
  const depth = Object.fromEntries(model.parents.map((p) => [p.name, p.row]));
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

test("no two visible labels overprint — cells, callouts, axis rows — at any width or font size", async () => {
  const { buildStrip } = await load();
  for (const w of WIDTHS) {
    for (const fontPx of [13, 16]) {
      const model = buildStrip(view(AEN801_REGIONS), new Map(), w, fontPx);
      assertNoOverprint(model, `${w}/fs${fontPx}`);
      for (const r of model.regions) {
        if (r.label.mode === "callout" || r.label.mode === "overflow") continue;
        assert.ok(r.label.x0 >= r.left - 1e-6, `${r.name}@${w} left`);
        assert.ok(
          r.label.x1 <= r.left + r.width + 1e-6,
          `${r.name}@${w} right`,
        );
      }
    }
  }
});

test("equal-extent and partially overlapping cells do not print through each other", async () => {
  const { buildStrip } = await load();
  const { region } = require("./helpers/memoryFixtureRegions");
  const model = buildStrip(
    view([
      region("one_name", 0x1000, 0x1000, "locked"),
      region("two_name", 0x1000, 0x1000, "locked"),
      region("lap_a", 0x4000, 0x2000, "locked"),
      region("lap_b", 0x5000, 0x2000, "locked"),
    ]),
    new Map(),
    800,
  );
  assertNoOverprint(model, "equal");
  for (const r of model.regions) assert.ok(r.label.text.length > 0, r.name);
  const modes = Object.fromEntries(
    model.regions.map((r) => [r.name, r.label.mode]),
  );
  assert.ok(
    modes.one_name === "callout" || modes.two_name === "callout",
    "one of the equal-extent pair is a callout",
  );
});

test("equal-extent containers and overlapping same-depth containers get separate rows", async () => {
  const { buildStrip } = await load();
  const { region } = require("./helpers/memoryFixtureRegions");
  const model = buildStrip(
    view([
      region("twin_a", 0x1000, 0x8000, "composite"),
      region("twin_b", 0x1000, 0x8000, "composite"),
      region("lap_x", 0x20000, 0x4000, "composite"),
      region("lap_y", 0x22000, 0x4000, "composite"),
      region("kid_1", 0x1000, 0x1000, "locked"),
      region("kid_2", 0x20000, 0x1000, "locked"),
      region("kid_3", 0x22000, 0x1000, "locked"),
    ]),
    new Map(),
    800,
  );
  const byName = Object.fromEntries(model.parents.map((p) => [p.name, p]));
  assert.notEqual(byName.twin_a.row, byName.twin_b.row);
  assert.notEqual(byName.lap_x.row, byName.lap_y.row);
  for (const a of model.parents)
    for (const b of model.parents)
      if (a !== b && a.row === b.row)
        assert.ok(
          a.left + a.width <= b.left + 1e-6 ||
            b.left + b.width <= a.left + 1e-6,
          `${a.name} and ${b.name} overlap in row ${a.row}`,
        );
});

test("a container carries its own lock verdict", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(V2N_REGIONS), new Map(), 800);
  assert.equal(typeof model.parents[0].locked, "boolean");
});

test("an ellipsis keeps at least 5 characters and 70% of the name, else the full name is a callout", async () => {
  const { buildStrip } = await load();
  for (const w of WIDTHS) {
    const model = buildStrip(view(AEN801_REGIONS), new Map(), w);
    for (const r of model.regions) {
      if (r.label.mode !== "ellipsis") continue;
      const kept = r.label.text.length - 1;
      assert.ok(
        kept >= 5 && kept >= 0.7 * r.name.length,
        `${r.name}@${w}: ${r.label.text}`,
      );
    }
  }
});

test("callout rows are capped; regions past the cap stay reachable through one overflow marker", async () => {
  const { buildStrip } = await load();
  const { region } = require("./helpers/memoryFixtureRegions");
  const many = Array.from({ length: 30 }, (_, i) =>
    region(`part_${i}`, 0x1000 + i * 0x1000, 0x1000, "locked"),
  );
  const model = buildStrip(view(many), new Map(), 640);
  const callouts = model.regions.filter((r) => r.label.mode === "callout");
  assert.ok(callouts.every((r) => r.label.row < 3));
  const overflow = model.regions.filter((r) => r.label.mode === "overflow");
  assert.ok(overflow.length > 0, "the fixture overflows the cap");
  assert.ok(model.overflow !== null);
  assert.deepEqual(model.overflow.ids.sort(), overflow.map((r) => r.id).sort());
  assert.ok(model.overflow.label.startsWith("+"));
  assertNoOverprint(model, "many");
});

test("every segment edge has an axis label at 640 and wider; the end stays inclusive", async () => {
  const { buildStrip } = await load();
  for (const w of [640, 720, 1000, 1400]) {
    const model = buildStrip(view(AEN801_REGIONS), new Map(), w);
    assert.deepEqual(
      model.ticks.filter((t) => !t.labelled).map((t) => t.label),
      [],
      `width ${w}`,
    );
  }
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  const end = model.ticks.find((t) => t.isEnd);
  assert.equal(end.label, "0x8057ffff");
  assert.equal(model.ticks.filter((t) => t.isEnd).length, 1);
  assert.ok(
    model.ticks.some((t) => t.row >= 1),
    "staggered rows are used",
  );
  const narrow = buildStrip(view(AEN801_REGIONS), new Map(), 640);
  assert.ok(
    narrow.ticks.some((t) => t.row === 2),
    "640 px needs a third row",
  );
});

test("at 360 px the window ends are kept and exactly the listed labels are dropped", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 360);
  assert.ok(model.ticks[0].labelled);
  assert.ok(model.ticks[model.ticks.length - 1].labelled);
  assert.deepEqual(
    model.ticks.filter((t) => !t.labelled).map((t) => t.label),
    DROPPED_AT_360,
  );
});

test("the first label starts at its tick and the last ends at its tick", async () => {
  const { buildStrip } = await load();
  for (const w of [360, 640, 1000]) {
    const model = buildStrip(view(AEN801_REGIONS), new Map(), w);
    const first = model.ticks[0];
    const last = model.ticks[model.ticks.length - 1];
    assert.ok(Math.abs(first.x0 - first.lineX) < 1e-6, `first@${w}`);
    assert.ok(Math.abs(last.x1 - last.lineX) < 1e-6, `last@${w}`);
  }
});
