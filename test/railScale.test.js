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

test("segment heights sum to the plot height exactly", async () => {
  const { layoutRail } = await load();
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80580000 },
    [0x80000000, 0x80010000, 0x802b0000, 0x80550000, 0x80580000],
    18,
    258,
  );
  const total = layout.segments.reduce((n, s) => n + s.height, 0);
  assert.equal(Math.round(total), 258 - 18);
});

test("yOf is monotonic and inverts through addressAt", async () => {
  const { layoutRail } = await load();
  const layout = layoutRail(
    { lo: 0x80000000, hi: 0x80580000 },
    [0x80000000, 0x80010000, 0x802b0000, 0x80580000],
    18,
    258,
  );
  assert.ok(layout.yOf(0x80000000) > layout.yOf(0x80580000));
  for (const addr of [0x80000000, 0x80010000, 0x802b0000, 0x80580000]) {
    assert.ok(Math.abs(layout.addressAt(layout.yOf(addr)) - addr) <= 1);
  }
});

test("a window with no interior boundary is one extent segment, no gaps", async () => {
  const { layoutRail } = await load();
  const layout = layoutRail({ lo: 0, hi: 0x1000 }, [0, 0x1000], 0, 100);
  assert.equal(layout.segments.length, 1);
  assert.equal(layout.segments[0].kind, "extent");
  assert.equal(layout.segments[0].height, 100);
});
