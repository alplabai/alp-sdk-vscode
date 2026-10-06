// SPDX-License-Identifier: Apache-2.0
//
// The Build Plan panel's number formatting. These are firmware facts: a
// rounded size or a dropped digit is a wrong flash, so every case below
// pins an exact string.

const test = require("node:test");
const assert = require("node:assert/strict");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/format.ts",
  );

test("formatRange prints the INCLUSIVE last byte of a half-open extent", async () => {
  const { formatRange } = await load();
  // he_slot0 (rpmsg-aen): base 0x80010000, size 0x2a0000.
  assert.equal(
    formatRange(0x80010000, 0x80010000 + 0x2a0000),
    "0x80010000 – 0x802affff",
  );
  // atoc: 0x80578000, 32 KiB.
  assert.equal(formatRange(0x80578000, 0x80580000), "0x80578000 – 0x8057ffff");
});

test("formatRange of a point or one byte is a single address", async () => {
  const { formatRange } = await load();
  assert.equal(formatRange(0x80010000, 0x80010000), "0x80010000");
  assert.equal(formatRange(0x80010000, 0x80010001), "0x80010000");
});

test("formatBytes: exact unit multiples print clean, without .0", async () => {
  const { formatBytes } = await load();
  assert.equal(formatBytes(65536), "64 KiB"); // mcuboot
  assert.equal(formatBytes(524288), "512 KiB"); // ocram_low
  assert.equal(formatBytes(4294967296), "4 GiB"); // ddr_main
  assert.equal(formatBytes(0x100000), "1 MiB");
  assert.equal(formatBytes(99), "99 B");
  assert.equal(formatBytes(0), "0 B");
});

test("formatBytes: a non-multiple prints rounded AND exact hex", async () => {
  const { formatBytes } = await load();
  // he_slot0 / hp_slot0: 2752512 B = 0x2a0000.
  assert.equal(formatBytes(2752512), "2.63 MiB (0x2a0000)");
  assert.equal(formatBytes(99452), "97.1 KiB (0x1847c)");
  // The unit is chosen AFTER rounding: one byte short of 1 MiB is never
  // "1024.0 KiB".
  assert.equal(formatBytes(1048575), "1.00 MiB (0xfffff)");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(0x180000000), "6 GiB");
  assert.equal(formatBytes(0x140000000), "5 GiB");
  assert.equal(formatBytes(0x148000000), "5.13 GiB (0x148000000)");
});

test("formatBytes: a rounded figure that is exact prints without hex", async () => {
  const { formatBytes } = await load();
  assert.equal(formatBytes(0x580000), "5.50 MiB"); // 5.5 MiB exactly
  assert.equal(formatBytes(1536), "1.5 KiB");
});

test("formatAddress pads to an 8-digit floor, never up to a view's widest", async () => {
  const { formatAddress } = await load();
  assert.equal(formatAddress(0x10000), "0x00010000");
  assert.equal(formatAddress(0x80000000), "0x80000000");
  assert.equal(formatAddress(0x48000000), "0x48000000");
  // Past 2^32 an address keeps its natural width — never truncated.
  assert.equal(formatAddress(0x147ffffff), "0x147ffffff");
});

test("formatOffsetRange prints exact hex offsets with an inclusive end", async () => {
  const { formatOffsetRange } = await load();
  assert.equal(formatOffsetRange(0x10000, 0x20000), "+0x10000 – +0x1ffff");
  assert.equal(formatOffsetRange(0, 0), "+0x0");
});
