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
  // Create a case where fixed > plotHeight: 31 extents = 31 * 8 = 248 pixels
  // on a 240-pixel plot, so squeeze < 1.
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
  // Build a rail with a 1 MiB gap and a 1 MiB extent, so they can't be confused by size.
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
  // gap is fixed 12px, extents share the remaining proportionally.
  assert.notEqual(
    gap.height,
    extent1.height,
    "gap and equal-size extent must differ",
  );

  // Verify the yOf mapping respects the piecewise structure: a 1MiB gap
  // (occupying 12px) and a 1MiB extent must map to different y-spans.
  const gapSpan = Math.abs(layout.yOf(gap.hi) - layout.yOf(gap.lo));
  const extentSpan = Math.abs(layout.yOf(extent1.hi) - layout.yOf(extent1.lo));
  assert.notEqual(
    gapSpan,
    extentSpan,
    `gap yOf span ${gapSpan}px must differ from extent span ${extentSpan}px`,
  );
});

test("a window with no interior boundary is one extent segment, no gaps", async () => {
  const { layoutRail } = await load();
  const layout = layoutRail({ lo: 0, hi: 0x1000 }, [0, 0x1000], 0, 100);
  assert.equal(layout.segments.length, 1);
  assert.equal(layout.segments[0].kind, "extent");
  assert.equal(layout.segments[0].height, 100);
});
