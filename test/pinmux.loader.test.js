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
  assert.strictEqual(pinmuxFamilyForSku("E1M-AEN801"), "aen");
  assert.strictEqual(pinmuxFamilyForSku("E1M-NX9101"), "imx93");
  assert.strictEqual(pinmuxFamilyForSku("E1M-V2N101"), "v2n");
  assert.strictEqual(pinmuxFamilyForSku("E1M-V2M102"), "v2n");
  assert.strictEqual(pinmuxFamilyForSku("UNKNOWN-1"), null);
});

test("loadPinmuxTable reads metadata/pinmux/<family>.yaml under the SDK root", () => {
  clearPinmuxTableCache();
  const seen = [];
  const table = loadPinmuxTable("/sdk", "E1M-AEN801", (filePath) => {
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
    "E1M-AEN801",
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
  loadPinmuxTable("/sdk", "E1M-AEN801", readFile);
  loadPinmuxTable("/sdk", "E1M-AEN301", readFile); // same family -> cached
  assert.strictEqual(reads, 1);
});

test("loadPinmuxTable returns null for an all-TBD (sentinel) capability table", () => {
  clearPinmuxTableCache();
  const allTbd =
    'family: v2n\npads:\n  - { e1m_pad: "TBD", e1m_function: "TBD", owner: "renesas", silicon_peripheral: "uSD1_V_SEL", silicon_pad: "PA2" }\n';
  assert.strictEqual(
    loadPinmuxTable("/sdk", "E1M-V2N101", () => allTbd),
    null,
  );
});

test("loadPinmuxTable keeps only non-TBD rows for a partially-populated table", () => {
  clearPinmuxTableCache();
  const mixed =
    'family: v2n\npads:\n  - { e1m_pad: "TBD", e1m_function: "TBD", owner: "renesas", silicon_peripheral: "x", silicon_pad: "PA2" }\n  - { e1m_pad: "B7", e1m_function: "I2C0", owner: "renesas", silicon_peripheral: "RIIC0", silicon_pad: "P20" }\n';
  const table = loadPinmuxTable("/sdk", "E1M-V2N101", () => mixed);
  assert.strictEqual(table.pads.length, 1);
  assert.strictEqual(table.pads[0].e1mPad, "B7");
});

test("E1M-V2M SKUs resolve to the v2n pinmux family (same E1M edge)", () => {
  assert.strictEqual(pinmuxFamilyForSku("E1M-V2M101"), "v2n");
  assert.strictEqual(pinmuxFamilyForSku("E1M-V2M102"), "v2n");
});

test("loadPinmuxTable does not cache a null miss (retries once the SDK populates)", () => {
  clearPinmuxTableCache();
  const first = loadPinmuxTable("/sdk", "E1M-AEN801", () => {
    throw new Error("ENOENT"); // SDK submodule not populated yet
  });
  assert.strictEqual(first, null);

  // A later call must re-read rather than return a stuck null.
  let reads = 0;
  const second = loadPinmuxTable("/sdk", "E1M-AEN801", () => {
    reads += 1;
    return 'family: aen\npads:\n  - { e1m_pad: "B7", e1m_function: "I2C0", owner: "alif", silicon_peripheral: "I2C0", silicon_pad: "P1" }\n';
  });
  assert.strictEqual(reads, 1);
  assert.ok(second && second.pads.length === 1);
});
