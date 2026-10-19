// SPDX-License-Identifier: Apache-2.0
//
// Region cards: every resolved, non-container region gets a waffle card like
// a slot image's, in the placed lane under its own cell. Pure model
// assertions on `buildStrip`'s `cards` — colour is a CSS concern, but WHICH
// fill a card wears (locked / unmeasured / hatched) and that no two cards
// overprint is decided here.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AEN801_REGIONS,
  V2N_REGIONS,
  region,
  span,
} = require("./helpers/memoryFixtureRegions");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/stripLayout.ts",
  );

const view = (regions, spans = []) => ({
  sku: "E1M-AEN801",
  spans,
  unresolved: [],
  apertures: [],
  conflicts: [],
  regions,
});

const budget = (core, used) => [
  core,
  {
    core_id: core,
    os: "zephyr",
    status: "ok",
    flash: { used, total: 2752512, pct: null },
    ram: { used: null, total: null, pct: null },
  },
];

const slots = () => [
  span({ label: "m55_he", base: 0x80010000, cores: ["m55_he"] }),
  span({ label: "m55_hp", base: 0x802b0000, cores: ["m55_hp"] }),
];
const budgets = () =>
  new Map([budget("m55_he", 98304), budget("m55_hp", 1468006)]);

const WIDTHS = [360, 640, 1000];

test("every resolved non-container region has exactly one card; the container has none", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  const names = model.cards.map((c) => c.name).sort();
  assert.deepEqual(names, [
    "atoc",
    "he_slot0",
    "hp_slot0",
    "mcuboot",
    "reserved",
    "storage",
  ]);
});

test("a region a slot image fills exactly is carded by that slot image, not twice", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS, slots()), budgets(), 1000);
  assert.deepEqual(model.cards.map((c) => c.name).sort(), [
    "atoc",
    "mcuboot",
    "reserved",
    "storage",
  ]);
  assert.equal(model.spans.length, 2);
});

test("locked regions are fully amber with the padlock and say who owns them", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  for (const [name, owner] of [
    ["mcuboot", "vendor image"],
    ["atoc", "Secure Enclave"],
  ]) {
    const c = model.cards.find((x) => x.name === name);
    assert.equal(c.kind, "locked", name);
    assert.equal(c.filled, c.total, `${name} is all amber`);
    assert.ok(c.total > 0);
    assert.equal(c.padlock, true, `${name} carries the padlock`);
    assert.match(c.label, /^locked · /);
    assert.ok(c.label.includes(owner), `${name}: ${c.label}`);
  }
  assert.match(
    model.cards.find((x) => x.name === "mcuboot").label,
    /locked · 64 KiB/,
  );
});

test("a locked card always prints at least the word locked, even the narrowest, at any width or font size", async () => {
  const { buildStrip } = await load();
  for (const w of WIDTHS) {
    for (const fontPx of [13, 16]) {
      const model = buildStrip(view(AEN801_REGIONS), new Map(), w, fontPx);
      for (const name of ["mcuboot", "atoc"]) {
        const c = model.cards.find((x) => x.name === name);
        assert.ok(
          c.text.startsWith("locked"),
          `${name}@${w}/fs${fontPx}: "${c.text}"`,
        );
      }
      for (const c of model.cards)
        assert.ok(
          c.text === "" || c.label.includes(c.text.split(" ")[0]),
          c.name,
        );
    }
  }
});

test("storage has no usage data: zero filled squares, never a fake fill", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  const c = model.cards.find((x) => x.name === "storage");
  assert.equal(c.kind, "empty");
  assert.equal(c.filled, 0);
  assert.equal(c.label, "no usage data");
  assert.equal(c.padlock, false);
});

test("reserved and other unproven tiers are hatched", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  const c = model.cards.find((x) => x.name === "reserved");
  assert.equal(c.kind, "hatched");
  assert.equal(c.filled, 0);
  assert.match(c.label, /^reserved/);
});

test("a SoM that declares no authority gets neutral empty cards", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(V2N_REGIONS), new Map(), 800);
  assert.deepEqual(model.cards.map((c) => c.name).sort(), [
    "m33_tcm",
    "ocram_low",
  ]);
  assert.ok(model.cards.every((c) => c.kind === "empty" && c.filled === 0));
});

test("no card overlaps another card or a slot card, at any width or font size, and each holds >= 2 columns", async () => {
  const { buildStrip } = await load();
  for (const w of WIDTHS) {
    for (const fontPx of [13, 16]) {
      const model = buildStrip(
        view(AEN801_REGIONS, slots()),
        budgets(),
        w,
        fontPx,
      );
      const boxes = [
        ...model.cards.map((c) => ({
          n: c.name,
          row: c.row,
          x0: c.left,
          x1: c.left + c.width,
        })),
        ...model.spans.map((s) => ({
          n: s.name,
          row: 0,
          x0: s.left,
          x1: s.left + s.width,
        })),
      ];
      for (const a of boxes)
        for (const b of boxes)
          if (a !== b && a.row === b.row)
            assert.ok(
              a.x1 <= b.x0 + 1e-6 || b.x1 <= a.x0 + 1e-6,
              `${a.n}/${b.n} overlap in row ${a.row} @${w}/fs${fontPx}`,
            );
      for (const c of model.cards) {
        assert.ok(
          c.left >= -1e-6 && c.left + c.width <= w + 1e-6,
          `${c.name}@${w} inside`,
        );
        assert.ok(c.cols >= 2, `${c.name}@${w} cols ${c.cols}`);
        assert.equal(c.total, c.cols * 4);
      }
    }
  }
});

test("cards that cannot share a row move to the next; none is ever dropped", async () => {
  const { buildStrip } = await load();
  const many = Array.from({ length: 30 }, (_, i) =>
    region(`part_${i}`, 0x1000 + i * 0x1000, 0x1000, "locked"),
  );
  const model = buildStrip(view(many), new Map(), 640);
  assert.equal(model.cards.length, 30);
  assert.ok(Math.max(...model.cards.map((c) => c.row)) >= 1);
  for (const a of model.cards)
    for (const b of model.cards)
      if (a !== b && a.row === b.row)
        assert.ok(
          a.left + a.width <= b.left + 1e-6 ||
            b.left + b.width <= a.left + 1e-6,
        );
});

test("slot cards' used/free numbers are unchanged by region cards", async () => {
  const { buildStrip } = await load();
  // Snapshot taken on the commit before region cards existed.
  const want = {
    360: [
      {
        cols: 10,
        total: 40,
        filled: 1,
        fullCols: 0,
        partial: 1,
        bytesPerCell: 68813,
      },
      {
        cols: 10,
        total: 40,
        filled: 21,
        fullCols: 5,
        partial: 1,
        bytesPerCell: 68813,
      },
    ],
    640: [
      {
        cols: 22,
        total: 88,
        filled: 3,
        fullCols: 0,
        partial: 3,
        bytesPerCell: 31279,
      },
      {
        cols: 22,
        total: 88,
        filled: 47,
        fullCols: 11,
        partial: 3,
        bytesPerCell: 31279,
      },
    ],
    1000: [
      {
        cols: 37,
        total: 148,
        filled: 5,
        fullCols: 1,
        partial: 1,
        bytesPerCell: 18598,
      },
      {
        cols: 37,
        total: 148,
        filled: 79,
        fullCols: 19,
        partial: 3,
        bytesPerCell: 18598,
      },
    ],
  };
  for (const w of WIDTHS) {
    const model = buildStrip(view(AEN801_REGIONS, slots()), budgets(), w);
    assert.deepEqual(
      model.spans.map((s) => s.cells),
      want[w],
      `width ${w}`,
    );
  }
});
