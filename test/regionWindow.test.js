// SPDX-License-Identifier: Apache-2.0
//
// The memory view's ONE window computation (`chartWindowOf`): the union of
// every placed span, budget and resolved region — regions can CREATE the
// window, and no resolved region is dropped for sitting far from the spans.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AEN_REGIONS,
  V2N_REGIONS,
  region,
  span,
} = require("./helpers/memoryFixtureRegions");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/regionWindow.ts",
  );

test("regions alone create the window (no placed span at all)", async () => {
  const { chartWindowOf } = await load();
  const win = chartWindowOf([], new Map(), AEN_REGIONS);
  assert.deepEqual(win, { lo: 0x80000000, hi: 0x80580000 });
});

test("a single resolved region is enough for a window", async () => {
  const { chartWindowOf } = await load();
  const win = chartWindowOf([], new Map(), [
    region("mram_main", 0x80000000, 0x00100000, "unstated"),
  ]);
  assert.deepEqual(win, { lo: 0x80000000, hi: 0x80100000 });
});

test("a disjoint region (V2N ddr_main, 4 GiB) is inside the window, not dropped", async () => {
  const { chartWindowOf } = await load();
  // A span in ocram_low only: the old rule grew the window over regions
  // TOUCHING the spans and left ddr_main and m33_tcm "outside".
  const spans = [
    span({
      id: "carve_out:ipc",
      kind: "carve_out",
      label: "ipc",
      base: 0x00020000,
      sizeBytes: 0x1000,
    }),
  ];
  const win = chartWindowOf(spans, new Map(), V2N_REGIONS);
  assert.equal(win.lo, 0x00010000);
  assert.equal(win.hi, 0x148000000); // ddr_main's end: 0x48000000 + 4 GiB
});

test("unresolved or sizeless regions contribute no extent; one point is no window", async () => {
  const { chartWindowOf } = await load();
  const sizeless = { ...region("x", 0x80000000, null, "unstated") };
  const marker = span({ label: "m55_he", base: 0x80010000 });
  assert.equal(chartWindowOf([marker], new Map(), [sizeless]), null);
});

test("regionsLargestFirst draws a container before the region nested in it, whatever the listed order", async () => {
  const { regionsLargestFirst, resolvedRegions } = await load();
  // m33_tcm listed FIRST, its container ddr_main AFTER it.
  const listed = resolvedRegions([V2N_REGIONS[2], V2N_REGIONS[0]]);
  assert.deepEqual(
    listed.map((r) => r.region.name),
    ["m33_tcm", "ddr_main"],
  );
  const drawn = regionsLargestFirst(listed);
  // Later siblings paint on top: the nested TCM must come last.
  assert.deepEqual(
    drawn.map((r) => r.region.name),
    ["ddr_main", "m33_tcm"],
  );
  // A new array; the input order is untouched.
  assert.equal(listed[0].region.name, "m33_tcm");
});
