// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert");
const { parsePinmuxTable } = require("@alp-sdk/core/pinmux/parse");

const SAMPLE = `
schemaVersion: pinmux-capability-v1
family: aen
display_name: "E1M-AEN (Alif Ensemble)"
pads:
  - { e1m_pad: "A3",  e1m_function: "PWM6",   owner: "alif", silicon_peripheral: "UT3_T1_C", silicon_pad: "P10_7" }
  - { e1m_pad: "AG2", e1m_function: "IO3",    owner: "alif", silicon_peripheral: "GPIO",     silicon_pad: "P3.2" }
  - { e1m_pad: "AG18", e1m_function: "IO6",   owner: "alif", silicon_peripheral: "",         silicon_pad: "P9.7" }
`;

test("parsePinmuxTable reads family, display name and pads", () => {
  const table = parsePinmuxTable(SAMPLE);
  assert.strictEqual(table.family, "aen");
  assert.strictEqual(table.displayName, "E1M-AEN (Alif Ensemble)");
  assert.strictEqual(table.pads.length, 3);
  assert.deepStrictEqual(table.pads[0], {
    e1mPad: "A3",
    e1mFunction: "PWM6",
    owner: "alif",
    siliconPeripheral: "UT3_T1_C",
    siliconPad: "P10_7",
  });
});

test("parsePinmuxTable keeps GPIO-only pads with empty silicon_peripheral", () => {
  const table = parsePinmuxTable(SAMPLE);
  assert.strictEqual(table.pads[2].siliconPeripheral, "");
});

test("parsePinmuxTable tolerates empty or malformed input", () => {
  assert.deepStrictEqual(parsePinmuxTable(""), { family: "", displayName: undefined, pads: [] });
  assert.deepStrictEqual(parsePinmuxTable("family: 3\npads: nope"), {
    family: "",
    displayName: undefined,
    pads: [],
  });
  const missingKeys = parsePinmuxTable("family: aen\npads:\n  - { e1m_pad: \"A3\" }");
  assert.strictEqual(missingKeys.pads.length, 0);
});
