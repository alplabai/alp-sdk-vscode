// SPDX-License-Identifier: Apache-2.0
// Smoke tests for the SoM module catalog. (Project scaffolding moved to the CLI
// `alp init`; the former PROJECT_TEMPLATES + stub generators were removed.)

const test = require("node:test");
const assert = require("node:assert/strict");

const { E1M_MODULES } = require("../out/ideHub/projectScaffold.js");

// ---------------------------------------------------------------------------
// E1M_MODULES catalog
// ---------------------------------------------------------------------------

test("E1M_MODULES contains all known silicon families", () => {
  const families = new Set(E1M_MODULES.map((m) => m.family));
  assert.ok(families.has("alif-ensemble"), "missing alif-ensemble family");
  assert.ok(families.has("renesas-rzv2n"), "missing renesas-rzv2n family");
  assert.ok(families.has("nxp-imx9"), "missing nxp-imx9 family");
});

test("E1M_MODULES every entry has id, displayName, family", () => {
  for (const m of E1M_MODULES) {
    assert.ok(
      m.id && typeof m.id === "string",
      `missing id: ${JSON.stringify(m)}`,
    );
    assert.ok(
      m.displayName && typeof m.displayName === "string",
      `missing displayName: ${m.id}`,
    );
    assert.ok(
      m.family && typeof m.family === "string",
      `missing family: ${m.id}`,
    );
  }
});

test("E1M_MODULES ids are unique", () => {
  const ids = E1M_MODULES.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate module ids found");
});

test("E1M_MODULES displayName starts with module id", () => {
  for (const m of E1M_MODULES) {
    assert.ok(
      m.displayName.startsWith(m.id),
      `displayName "${m.displayName}" does not start with id "${m.id}"`,
    );
  }
});

test("E1M_MODULES contains flagship E1M-AEN701", () => {
  const flagship = E1M_MODULES.find((m) => m.id === "E1M-AEN701");
  assert.ok(flagship, "E1M-AEN701 not found");
  assert.equal(flagship.family, "alif-ensemble");
});

test("E1M_MODULES contains E1M-NX9101 NXP entry", () => {
  const nxp = E1M_MODULES.find((m) => m.id === "E1M-NX9101");
  assert.ok(nxp, "E1M-NX9101 not found");
  assert.equal(nxp.family, "nxp-imx9");
});
