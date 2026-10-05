// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/railScale.ts",
  );

test("an empty run between two extents compresses to exactly GAP_PX", async () => {
  const { layoutRail, GAP_PX } = await load();
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80120000 },
    [0x80000000, 0x80010000, 0x80110000, 0x80120000],
    0,
    300,
    [
      { lo: 0x80000000, hi: 0x80010000 },
      { lo: 0x80110000, hi: 0x80120000 },
    ],
  );
  const gaps = layout.segments.filter((s) => s.kind === "gap");
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].height, GAP_PX);
  assert.equal(gaps[0].lo, 0x80010000);
  assert.equal(gaps[0].hi, 0x80110000);
});

test("every extent segment clears the floor even when its share is tiny", async () => {
  const { layoutRail, MIN_EXTENT_PX } = await load();
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80580000 },
    [0x80000000, 0x80010000, 0x80580000],
    0,
    300,
  );
  for (const seg of layout.segments.filter((s) => s.kind === "extent")) {
    assert.ok(
      seg.height >= MIN_EXTENT_PX,
      `segment 0x${seg.lo.toString(16)} is ${seg.height}px, under the ${MIN_EXTENT_PX}px floor`,
    );
  }
});

test("segment heights sum to plot height exactly with gaps", async () => {
  const { layoutRail } = await load();
  // Test with gaps: 2 extents and 1 gap on a 300px plot
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80120000 },
    [0x80000000, 0x80010000, 0x80110000, 0x80120000],
    0,
    300,
    [
      { lo: 0x80000000, hi: 0x80010000 },
      { lo: 0x80110000, hi: 0x80120000 },
    ],
  );
  const total = layout.segments.reduce((n, s) => n + s.height, 0);
  assert.ok(Math.abs(total - 300) < 1e-9);
});

test("segment heights sum to plot height exactly (all-extent case)", async () => {
  const { layoutRail } = await load();
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80580000 },
    [0x80000000, 0x80010000, 0x802b0000, 0x80550000, 0x80580000],
    18,
    258,
  );
  const total = layout.segments.reduce((n, s) => n + s.height, 0);
  assert.ok(Math.abs(total - (258 - 18)) < 1e-9);
});

test("segment heights sum to plot height when fixed > plotHeight", async () => {
  const { layoutRail, MIN_EXTENT_PX } = await load();
  // Create a case where fixed > plotHeight: 31 extents at MIN_EXTENT_PX each
  // exceed a 240-pixel plot, so squeeze < 1.
  const boundaries = [0];
  for (let i = 1; i <= 31; i++) {
    boundaries.push(i * 0x1000000);
  }
  const layout = layoutRail({ lo: 0, hi: 31 * 0x1000000 }, boundaries, 18, 258);
  const total = layout.segments.reduce((n, s) => n + s.height, 0);
  assert.ok(Math.abs(total - (258 - 18)) < 1e-9);
  // Verify squeeze is active: all segments should be shorter than their unsqueezed minimum.
  for (const seg of layout.segments) {
    assert.ok(
      seg.height < MIN_EXTENT_PX,
      `segment ${seg.lo.toString(16)} is ${seg.height}px, should be under ${MIN_EXTENT_PX}px when squeezed`,
    );
  }
});

test("piecewise mapping: gap and extent with same size get different heights", async () => {
  const { layoutRail, GAP_PX, MIN_EXTENT_PX } = await load();
  // Build a rail with a 1 MiB extent, two adjacent 1 MiB gap segments (1-3 MiB),
  // and another 1 MiB extent, so gap and extent sizes are identical and can't be
  // confused by proportional distribution.
  const MiB = 0x100000;
  const layout = layoutRail(
    { lo: 0, hi: 4 * MiB },
    [0, MiB, 2 * MiB, 3 * MiB, 4 * MiB],
    0,
    300,
    [
      { lo: 0, hi: MiB },
      { lo: 3 * MiB, hi: 4 * MiB },
    ],
  );
  const gap = layout.segments.find((s) => s.kind === "gap" && s.lo === MiB);
  const extent1 = layout.segments.find(
    (s) => s.kind === "extent" && s.lo === 0,
  );
  const extent2 = layout.segments.find(
    (s) => s.kind === "extent" && s.lo === 3 * MiB,
  );

  assert.ok(gap, "gap 1MiB-2MiB must exist");
  assert.ok(extent1, "extent 0-1MiB must exist");
  assert.ok(extent2, "extent 3MiB-4MiB must exist");

  // Gap must be exactly GAP_PX (no proportional share)
  assert.equal(gap.height, GAP_PX);
  // Extents must get at least MIN_EXTENT_PX (they compete for the rest)
  assert.ok(extent1.height >= MIN_EXTENT_PX);
  assert.ok(extent2.height >= MIN_EXTENT_PX);
  // Gap and extents of the same byte size must have different heights:
  // gap is fixed GAP_PX, extents share the remainder by log2(size).
  assert.notEqual(
    gap.height,
    extent1.height,
    "gap and equal-size extent must differ",
  );

  // Verify the yOf mapping respects the piecewise structure: the gap
  // (occupying GAP_PX) and a same-sized extent must map to different y-spans.
  const gapSpan = Math.abs(layout.yOf(gap.hi) - layout.yOf(gap.lo));
  const extentSpan = Math.abs(layout.yOf(extent1.hi) - layout.yOf(extent1.lo));
  assert.notEqual(
    gapSpan,
    extentSpan,
    `gap yOf span ${gapSpan}px must differ from extent span ${extentSpan}px`,
  );
});

test("yOf is strictly monotonic across segment boundaries and round-trips through addressAt", async () => {
  const { layoutRail } = await load();
  // Use the gap-bearing fixture from test 1: 0-0x10000 (extent), 0x10000-0x110000 (gap), 0x110000-0x120000 (extent)
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80120000 },
    [0x80000000, 0x80010000, 0x80110000, 0x80120000],
    0,
    300,
    [
      { lo: 0x80000000, hi: 0x80010000 },
      { lo: 0x80110000, hi: 0x80120000 },
    ],
  );

  // Collect addresses to test: all boundaries plus interior points of each segment
  const addresses = [
    0x80000000, // boundary: start of extent 0
    0x80008000, // interior: middle of extent 0
    0x80010000, // boundary: end of extent 0 / start of gap
    0x80088000, // interior: middle of gap
    0x80110000, // boundary: end of gap / start of extent 1
    0x80118000, // interior: middle of extent 1
    0x80120000, // boundary: end of extent 1
  ];

  // Verify yOf is strictly decreasing (high addresses at top, low at bottom)
  const yValues = addresses.map((addr) => layout.yOf(addr));
  for (let i = 1; i < yValues.length; i++) {
    assert.ok(
      yValues[i] < yValues[i - 1],
      `yOf must be strictly decreasing: yOf(0x${addresses[i].toString(16)})=${yValues[i]} should be < yOf(0x${addresses[i - 1].toString(16)})=${yValues[i - 1]}`,
    );
  }

  // Verify round-trip: addressAt(yOf(a)) === a (within 1, accounting for rounding)
  for (const addr of addresses) {
    const y = layout.yOf(addr);
    const recovered = layout.addressAt(y);
    assert.ok(
      Math.abs(recovered - addr) <= 1,
      `addressAt(yOf(0x${addr.toString(16)})) must recover the address: got 0x${recovered.toString(16)}, expected 0x${addr.toString(16)}`,
    );
  }
});

test("occupied endpoint strictly inside a segment must be detected as extent", async () => {
  const { layoutRail } = await load();
  // This test deliberately violates the invariant stated in layoutRail's jsdoc: every
  // occupied endpoint must appear in boundaries. We do this to prove the overlap predicate
  // (o.lo < hi && o.hi > lo) correctly mislabels a gap as an extent when the invariant
  // is broken, which wastes space visibly rather than hiding data silently.
  //
  // Fixture: occupied interval [0x80000000, 0x80008000] where the endpoint 0x80008000
  // falls strictly inside the declared segment [0x80000000, 0x80080000].
  // - Overlap form would mark it extent (correct when invariant holds)
  // - Containment form would mark it gap (silent data loss when invariant breaks)
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80120000 },
    [0x80000000, 0x80080000, 0x80120000],
    0,
    300,
    [{ lo: 0x80000000, hi: 0x80008000 }],
  );
  const segment = layout.segments.find((s) => s.lo === 0x80000000);
  assert.ok(segment, "segment 0x80000000-0x80080000 must exist");
  assert.equal(
    segment.kind,
    "extent",
    "segment overlapping occupied interval must be classified as extent, not gap (even with invariant violation)",
  );
});

test("a window with no interior boundary is one extent segment, no gaps", async () => {
  const { layoutRail } = await load();
  const layout = layoutRail({ lo: 0, hi: 0x1000 }, [0, 0x1000], 0, 100);
  assert.equal(layout.segments.length, 1);
  assert.equal(layout.segments[0].kind, "extent");
  assert.equal(layout.segments[0].height, 100);
});

// ── log-of-SIZE heights, on the real fixture region tables ─────────────────

const { AEN_REGIONS, V2N_REGIONS } = require("./helpers/memoryFixtureRegions");

const loadAll = async () => {
  const imp = (await import("./webview/esbuildImport.mjs")).importWebviewModule;
  return {
    ...(await imp("features/build-plan/railScale.ts")),
    ...(await imp("features/build-plan/railGeometry.ts")),
    ...(await imp("features/build-plan/regionWindow.ts")),
  };
};

/** The rail the chart draws for a region table alone, on the chart's own
 *  240-unit plot. */
async function railFor(regions) {
  const m = await loadAll();
  const win = m.chartWindowOf([], new Map(), regions);
  const { boundaries, occupied } = m.railBoundaries(
    [],
    new Map(),
    m.resolvedRegions(regions),
  );
  return { m, win, layout: m.layoutRail(win, boundaries, 18, 258, occupied) };
}

for (const [name, regions] of [
  ["rpmsg-aen", AEN_REGIONS],
  ["rpmsg-v2n", V2N_REGIONS],
]) {
  test(`${name}: yOf is monotonic over every edge and inside every segment`, async () => {
    const { layout } = await railFor(regions);
    const probes = layout.segments.flatMap((s) => [
      s.lo,
      s.lo + Math.floor((s.hi - s.lo) / 2),
      s.hi,
    ]);
    const sorted = [...new Set(probes)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        layout.yOf(sorted[i]) < layout.yOf(sorted[i - 1]),
        `yOf(0x${sorted[i].toString(16)}) must sit above yOf(0x${sorted[i - 1].toString(16)})`,
      );
    }
  });

  test(`${name}: every declared segment clears MIN_EXTENT_PX; every gap is shorter than the smallest`, async () => {
    const { m, layout } = await railFor(regions);
    const extents = layout.segments.filter((s) => s.kind === "extent");
    const gaps = layout.segments.filter((s) => s.kind === "gap");
    const smallest = Math.min(...extents.map((s) => s.height));
    assert.ok(
      smallest >= m.MIN_EXTENT_PX,
      `smallest declared segment is ${smallest}px, under the ${m.MIN_EXTENT_PX}px floor`,
    );
    for (const g of gaps) {
      assert.ok(
        g.height < smallest,
        `gap 0x${g.lo.toString(16)} is ${g.height}px, not shorter than the smallest declared segment (${smallest}px)`,
      );
    }
  });
}

test("rpmsg-aen: the 32 KiB atoc band is at the floor or above, and a larger slot is taller", async () => {
  const { m, layout } = await railFor(AEN_REGIONS);
  const atoc = layout.segments.find((s) => s.lo === 0x80578000);
  const heSlot = layout.segments.find((s) => s.lo === 0x80010000);
  assert.equal(atoc.hi, 0x80580000);
  assert.ok(atoc.height >= m.MIN_EXTENT_PX);
  // Heights grow with log2(size): 2.63 MiB outranks 32 KiB.
  assert.ok(heSlot.height > atoc.height);
});

test("rpmsg-v2n: ddr_main (4 GiB) spans its sub-segments around m33_tcm, each at or above the floor", async () => {
  const { m, layout } = await railFor(V2N_REGIONS);
  // Edges are the union of all regions' edges: ddr_main is cut at
  // m33_tcm's base and end, and the run between ocram_low and ddr_main is
  // an undeclared gap.
  const ddrParts = layout.segments.filter(
    (s) => s.lo >= 0x48000000 && s.hi <= 0x148000000,
  );
  assert.deepEqual(
    ddrParts.map((s) => [s.lo, s.hi]),
    [
      [0x48000000, 0x80000000],
      [0x80000000, 0x80020000],
      [0x80020000, 0x148000000],
    ],
  );
  for (const s of ddrParts) {
    assert.equal(s.kind, "extent");
    assert.ok(s.height >= m.MIN_EXTENT_PX);
  }
  const gap = layout.segments.find((s) => s.kind === "gap");
  assert.deepEqual([gap.lo, gap.hi], [0x90000, 0x48000000]);
  // Log, not linear: the 128 KiB TCM is not a hairline beside 3.1 GiB.
  const tcm = ddrParts[1];
  const top = ddrParts[2];
  // ~25000x the bytes, a handful of times the height.
  assert.ok(top.height / tcm.height < 10);
});

test("isExactAt is false where one pixel stands for many addresses", async () => {
  const { layout } = await railFor(V2N_REGIONS);
  const ddrTop = layout.segments[layout.segments.length - 1];
  assert.equal(layout.isExactAt(ddrTop.top + ddrTop.height / 2), false);
  const { layoutRail } = await loadAll();
  const tiny = layoutRail({ lo: 0, hi: 16 }, [0, 16], 0, 100);
  assert.equal(tiny.isExactAt(50), true);
});

test("railHeightNeeded grows with the segment count so no floor is squeezed", async () => {
  const { railHeightNeeded, MIN_EXTENT_PX, GAP_PX } = await loadAll();
  const boundaries = [0];
  for (let i = 1; i <= 31; i++) boundaries.push(i * 0x1000000);
  assert.equal(
    railHeightNeeded({ lo: 0, hi: 31 * 0x1000000 }, boundaries),
    31 * MIN_EXTENT_PX,
  );
  assert.equal(
    railHeightNeeded(
      { lo: 0, hi: 0x30 },
      [0, 0x10, 0x20, 0x30],
      [
        { lo: 0, hi: 0x10 },
        { lo: 0x20, hi: 0x30 },
      ],
      5,
    ),
    2 * MIN_EXTENT_PX + GAP_PX + 5,
  );
});

test("the top pixel reads the window's last byte, never one past it", async () => {
  const { layout, win } = await railFor(AEN_REGIONS);
  assert.equal(layout.addressAt(18), win.hi - 1); // 0x8057ffff
  assert.equal(layout.addressAt(0), win.hi - 1); // clamped above the plot
});
