// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const {
  pinmuxFamilyForSku,
  loadPinmuxTable,
  clearPinmuxTableCache,
} = require("../out/pinmux/loader.js");

const SAMPLE =
  'family: aen\npads:\n  - { e1m_pad: "A3", e1m_function: "PWM6", owner: "alif", silicon_peripheral: "UT3_T1_C", silicon_pad: "P10_7" }\n';

test("pinmuxFamilyForSku maps known SKU prefixes", () => {
  assert.strictEqual(pinmuxFamilyForSku("E1M-AEN701"), "aen");
  assert.strictEqual(pinmuxFamilyForSku("E1M-NX9101"), "imx93");
  assert.strictEqual(pinmuxFamilyForSku("E1M-V2N101"), "v2n");
  assert.strictEqual(pinmuxFamilyForSku("E1M-V2M102"), "v2n-m1");
  assert.strictEqual(pinmuxFamilyForSku("UNKNOWN-1"), null);
});

test("loadPinmuxTable reads metadata/pinmux/<family>.yaml under the SDK root", () => {
  clearPinmuxTableCache();
  const seen = [];
  const table = loadPinmuxTable("/sdk", "E1M-AEN701", (filePath) => {
    seen.push(filePath);
    return SAMPLE;
  });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(
    seen[0],
    path.join("/sdk", "metadata", "pinmux", "aen.yaml"),
  );
  assert.strictEqual(table.family, "aen");
  assert.strictEqual(table.pads.length, 1);
});

test("loadPinmuxTable returns null when the table file is missing", () => {
  clearPinmuxTableCache();
  const table = loadPinmuxTable("/sdk", "E1M-V2N101", () => {
    throw new Error("ENOENT");
  });
  assert.strictEqual(table, null);
});

test("loadPinmuxTable returns null for unknown SKUs without touching the filesystem", () => {
  clearPinmuxTableCache();
  const table = loadPinmuxTable("/sdk", "BOGUS", () => {
    throw new Error("should not be called");
  });
  assert.strictEqual(table, null);
});

test("loadPinmuxTable returns null for a readable-but-corrupt/empty table (no pads)", () => {
  clearPinmuxTableCache();
  const table = loadPinmuxTable(
    "/sdk",
    "E1M-AEN701",
    () => "family: 3\npads: nope",
  );
  assert.strictEqual(table, null);
});

test("loadPinmuxTable caches per sdkRoot + family", () => {
  clearPinmuxTableCache();
  let reads = 0;
  const readFile = () => {
    reads += 1;
    return SAMPLE;
  };
  loadPinmuxTable("/sdk", "E1M-AEN701", readFile);
  loadPinmuxTable("/sdk", "E1M-AEN301", readFile); // same family -> cached
  assert.strictEqual(reads, 1);
});

const STUB_TBD =
  "family: v2n\npads:\n" +
  '  - { e1m_pad: "TBD", e1m_function: "PWM6", owner: "renesas", silicon_peripheral: "GPT", silicon_pad: "P100" }\n' +
  '  - { e1m_pad: "TBD", e1m_function: "IO3", owner: "renesas", silicon_peripheral: "GPIO", silicon_pad: "P101" }\n';

test("loadPinmuxTable treats an all-TBD stub table as absent (no resolved pads)", () => {
  clearPinmuxTableCache();
  const table = loadPinmuxTable("/sdk", "E1M-V2N101", () => STUB_TBD);
  assert.strictEqual(table, null);
});

test("loadPinmuxTable keeps a partially-resolved table and preserves its TBD pads", () => {
  clearPinmuxTableCache();
  const partial =
    "family: v2n\npads:\n" +
    '  - { e1m_pad: "TBD", e1m_function: "PWM6", owner: "renesas", silicon_peripheral: "GPT", silicon_pad: "P100" }\n' +
    '  - { e1m_pad: "C4", e1m_function: "IO3", owner: "renesas", silicon_peripheral: "GPIO", silicon_pad: "P101" }\n';
  const table = loadPinmuxTable("/sdk", "E1M-V2N101", () => partial);
  assert.notStrictEqual(table, null);
  assert.strictEqual(table.pads.length, 2); // kept intact; R2 skips the TBD row
});
