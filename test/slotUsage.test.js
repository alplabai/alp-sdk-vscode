// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for the slot-footprint arithmetic the rail's used fill and the
// table's Used column share (slotUsage.ts), and for `splitBytes`.

const test = require("node:test");
const assert = require("node:assert/strict");

const load = async (file) =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    `features/build-plan/${file}`,
  );

const slot = (overrides) => ({
  id: "slot_image:m55_he",
  kind: "slot_image",
  label: "m55_he",
  base: 0x80010000,
  deviceOffset: null,
  sizeBytes: null,
  region: null,
  device: null,
  cores: [],
  fs: null,
  ...overrides,
});

const budget = (total, used) => ({
  core_id: "m55_he",
  os: "zephyr",
  status: "ok",
  flash: { used, total, pct: null },
  ram: { used: null, total: null, pct: null },
});

test("a slot's room comes from tan size's budget and its footprint from flash.used", async () => {
  const { slotUsageOf, usedPercent } = await load("slotUsage.ts");
  const usage = slotUsageOf(slot({}), budget(0x2a0000, 97792));
  assert.equal(usage.slotEnd, 0x80010000 + 0x2a0000);
  assert.equal(usage.total, 0x2a0000);
  assert.equal(usage.used, 97792);
  assert.equal(usedPercent(usage), 3.6);
});

test("an unmeasured image keeps used null — never 0", async () => {
  const { slotUsageOf, usedPercent } = await load("slotUsage.ts");
  const usage = slotUsageOf(slot({}), budget(0x2a0000, null));
  assert.equal(usage.used, null);
  assert.equal(usedPercent(usage), null);
});

test("only a placed slot image has a footprint", async () => {
  const { slotUsageOf } = await load("slotUsage.ts");
  assert.equal(slotUsageOf(slot({ kind: "carve_out" }), undefined), null);
  assert.equal(slotUsageOf(slot({ base: null }), undefined), null);
});

test("used is clamped to the slot it sits in", async () => {
  const { slotUsageOf } = await load("slotUsage.ts");
  const usage = slotUsageOf(slot({ sizeBytes: 1000 }), budget(null, 5000));
  assert.equal(usage.used, 1000);
});

test("the used fill has a visible minimum and never overflows the slot", async () => {
  const { usedFillLength, MIN_USED_PX } = await load("slotUsage.ts");
  assert.equal(usedFillLength(0, 100, 80), 0);
  assert.equal(usedFillLength(1, 1_000_000, 80), MIN_USED_PX);
  assert.equal(usedFillLength(50, 100, 80), 40);
  assert.equal(usedFillLength(100, 100, 80), 80);
  assert.equal(usedFillLength(100, 100, 2), 2);
});

test("splitBytes keeps the rounded figure and the exact hex apart", async () => {
  const { splitBytes, formatBytes } = await load("format.ts");
  assert.deepEqual(splitBytes(0x2a0000), { text: "2.63 MiB", hex: "0x2a0000" });
  assert.deepEqual(splitBytes(65536), { text: "64 KiB", hex: null });
  assert.deepEqual(splitBytes(99), { text: "99 B", hex: null });
  // formatBytes is unchanged for every existing caller.
  assert.equal(formatBytes(0x2a0000), "2.63 MiB (0x2a0000)");
});
