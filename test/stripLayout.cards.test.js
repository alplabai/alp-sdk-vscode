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

test("a card titles itself with its region name, whole or ellipsized to >= 5 characters; a locked one always says locked", async () => {
  const { buildStrip } = await load();
  for (const w of WIDTHS) {
    for (const fontPx of [13, 16]) {
      const model = buildStrip(view(AEN801_REGIONS), new Map(), w, fontPx);
      for (const c of model.cards) {
        const tag = `${c.name}@${w}/fs${fontPx}: "${c.heading}" / "${c.subtitle}"`;
        if (c.shrunk) {
          // Squeezed to stay on its row: padlock and squares only.
          assert.equal(c.heading, "", tag);
          assert.equal(c.subtitle, "", tag);
          assert.ok(c.cols >= 4, tag);
          continue;
        }
        if (c.heading !== c.name) {
          assert.ok(c.heading.endsWith("…"), tag);
          const kept = c.heading.slice(0, -1);
          assert.ok(kept.length >= 5 && c.name.startsWith(kept), tag);
        }
        // The status word is chosen on its own: an ellipsized name keeps it.
        if (c.kind === "locked") {
          assert.equal(c.padlock, true, tag);
          assert.ok(c.subtitle.startsWith("locked"), tag);
        }
      }
    }
  }
});

test("a card's subtitle falls back from the full status to the short one, and the tooltip keeps the whole sentence", async () => {
  const { buildStrip } = await load();
  const wide = buildStrip(view(AEN801_REGIONS), new Map(), 1400);
  const big = buildStrip(
    view([
      {
        ...region("vendor_fw", 0x1000, 0x100000, "locked"),
        writeAuthority: "vendor_image",
      },
      region("store_big", 0x101000, 0x100000, "customer_runtime"),
      region("rsv_big", 0x201000, 0x100000, "reserved"),
    ]),
    new Map(),
    1000,
  );
  const fw = big.cards.find((x) => x.name === "vendor_fw");
  assert.equal(fw.heading, "vendor_fw");
  assert.equal(fw.subtitle, "locked · 1 MiB · vendor image");
  // One step narrower: the short status.
  const mcuboot = wide.cards.find((x) => x.name === "mcuboot");
  assert.equal(mcuboot.heading, "mcuboot");
  assert.equal(mcuboot.subtitle, "locked");
  const narrow = buildStrip(view(AEN801_REGIONS), new Map(), 360);
  for (const c of narrow.cards) {
    assert.ok(
      c.subtitle === "" ||
        c.subtitle === c.label ||
        ["locked", "no data", "no writer"].includes(c.subtitle),
      `${c.name}: "${c.subtitle}"`,
    );
    assert.ok(c.title.includes(c.name) && c.title.endsWith(c.label), c.name);
  }
  assert.equal(
    big.cards.find((x) => x.name === "store_big").subtitle,
    "no usage data · 1 MiB",
  );
  assert.equal(
    big.cards.find((x) => x.name === "rsv_big").subtitle,
    "no writer · 1 MiB",
  );
});

test("storage has no usage data: zero filled squares, never a fake fill", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  const c = model.cards.find((x) => x.name === "storage");
  assert.equal(c.kind, "empty");
  assert.equal(c.filled, 0);
  assert.equal(c.label, "no usage data · 96 KiB");
  assert.equal(c.padlock, false);
});

test("reserved and other unproven tiers are hatched", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  const c = model.cards.find((x) => x.name === "reserved");
  assert.equal(c.kind, "hatched");
  assert.equal(c.filled, 0);
  assert.match(c.label, /^no writer/);
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
    // The slot cards sit exactly under their regions' cells, and the region
    // cards are laid out AROUND them, never over.
    for (const [span, name] of [
      [model.spans[0], "he_slot0"],
      [model.spans[1], "hp_slot0"],
    ]) {
      const cell = model.regions.find((r) => r.name === name);
      assert.ok(Math.abs(span.left - cell.left) < 1e-6, `${name}@${w}`);
      assert.ok(Math.abs(span.width - cell.width) < 1e-6, `${name}@${w}`);
      for (const c of model.cards)
        if (c.row === 0)
          assert.ok(
            c.left + c.width <= span.left + 1e-6 ||
              span.left + span.width <= c.left + 1e-6,
            `${c.name} overlaps ${span.name}@${w}`,
          );
    }
  }
});

test("the card height grows with the font so two text lines clear the waffle", async () => {
  const { buildStrip } = await load();
  const h13 = buildStrip(view(AEN801_REGIONS), new Map(), 640, 13).cardHeight;
  const h16 = buildStrip(view(AEN801_REGIONS), new Map(), 640, 16).cardHeight;
  assert.equal(h13, 84, "the 13px card is the slot card's 84px");
  // name + status lines (1.25 x font each) + 4 waffle rows + insets.
  assert.ok(h16 >= 4 + 2 * 20 + 8 + 32 + 8, `fs16 card height ${h16}`);
});

const wideSlot = (label, base, size) =>
  span({ label, base, sizeBytes: size, cores: [label] });

test("a region that holds an image never also gets a 'no usage data' card: budget differs, no budget, one core, two slots in a region, one slot across regions, an IPC carve-out", async () => {
  const { buildStrip } = await load();
  const names = (model) => model.cards.map((c) => c.name).sort();
  const base = ["atoc", "mcuboot", "reserved", "storage"];
  // Budget differs from the region (2 MiB slot in a 2.63 MiB region).
  const small = new Map([budget("m55_he", 98304), budget("m55_hp", 1468006)]);
  small.get("m55_he").flash.total = 2097152;
  assert.deepEqual(
    names(buildStrip(view(AEN801_REGIONS, slots()), small, 1000)),
    base,
  );
  // No budgets at all: the slot is only a marker, the region is still taken.
  assert.deepEqual(
    names(buildStrip(view(AEN801_REGIONS, slots()), new Map(), 1000)),
    base,
  );
  // One core built.
  assert.deepEqual(
    names(
      buildStrip(
        view(AEN801_REGIONS, slots()),
        new Map([budget("m55_hp", 1468006)]),
        1000,
      ),
    ),
    base,
  );
  // Two slots inside one region (he_slot0 holds both halves).
  assert.deepEqual(
    names(
      buildStrip(
        view(AEN801_REGIONS, [
          wideSlot("m55_he", 0x80010000, 0x40000),
          wideSlot("m55_hp", 0x80080000, 0x40000),
          wideSlot("m55_x", 0x802b0000, 0x1000),
        ]),
        new Map(),
        1000,
      ),
    ),
    base,
  );
  // One slot straddling two regions (he_slot0 and hp_slot0).
  assert.deepEqual(
    names(
      buildStrip(
        view(AEN801_REGIONS, [wideSlot("m55_he", 0x80200000, 0x200000)]),
        new Map(),
        1000,
      ),
    ),
    ["atoc", "mcuboot", "reserved", "storage"],
  );
  // An IPC carve-out over a region.
  const ipc = {
    ...wideSlot("ipc", 0x80560000, 0x18000),
    kind: "carve_out",
    id: "carve_out:ipc",
  };
  assert.deepEqual(
    names(buildStrip(view(AEN801_REGIONS, [ipc]), new Map(), 1000)),
    ["atoc", "he_slot0", "hp_slot0", "mcuboot", "reserved"],
  );
});

test("AEN801 fits one card row at 1000 px, locked cards stay on it by shrinking, and nothing overlaps", async () => {
  const { buildStrip } = await load();
  for (const spans of [[], slots()]) {
    const model = buildStrip(
      view(AEN801_REGIONS, spans),
      spans.length ? budgets() : new Map(),
      1000,
    );
    assert.equal(Math.max(...model.cards.map((c) => c.row)), 0);
  }
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  const shrunk = model.cards.filter((c) => c.shrunk);
  assert.ok(shrunk.every((c) => c.padlock || c.kind !== "locked"));
});

test("a card that would overlap its neighbour shrinks to the floor on its own row rather than open a new one", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(view(AEN801_REGIONS), new Map(), 1000);
  const atoc = model.cards.find((c) => c.name === "atoc");
  assert.equal(atoc.row, 0);
  assert.ok(atoc.shrunk, "atoc (80 px) overlaps storage, so it squeezes");
  assert.equal(atoc.width, 48);
  assert.ok(atoc.padlock, "still carries the padlock");
  // Its cell's callout names it; the card never claims a heading it lacks room for.
  assert.equal(atoc.heading, "");
  // And it stayed under (or beside) its own cell: its centre is within
  // half a card of the cell's centre.
  const cell = model.regions.find((r) => r.name === "atoc");
  assert.ok(
    Math.abs(atoc.left + atoc.width / 2 - (cell.left + cell.width / 2)) <=
      24 + 1e-6,
  );
});

test("a hatched card whose word would only repeat the region's name shows its size instead", async () => {
  const { buildStrip } = await load();
  const model = buildStrip(
    view([
      region("composite", 0x1000, 0x100000, "composite"),
      region("other", 0x101000, 0x100000, "customer_runtime"),
    ]),
    new Map(),
    1000,
  );
  const c = model.cards.find((x) => x.name === "composite");
  assert.equal(c.label, "1 MiB");
});
