// SPDX-License-Identifier: Apache-2.0
// Smoke tests for the project scaffold catalog and file generators.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  E1M_MODULES,
  PROJECT_TEMPLATES,
  generateBoardYaml,
  generateCMakeLists,
  generateMainC,
} = require("../out/ideHub/projectScaffold.js");

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

// ---------------------------------------------------------------------------
// PROJECT_TEMPLATES catalog
// ---------------------------------------------------------------------------

test("PROJECT_TEMPLATES contains a blank-app starter", () => {
  const blank = PROJECT_TEMPLATES.find((t) => t.id === "blank-app");
  assert.ok(blank, "blank-app template not found");
  assert.equal(blank.category, "starter");
  assert.equal(blank.sourceDir, undefined);
});

test("PROJECT_TEMPLATES every entry has required fields", () => {
  for (const t of PROJECT_TEMPLATES) {
    assert.ok(t.id, `missing id: ${JSON.stringify(t)}`);
    assert.ok(t.title, `missing title: ${t.id}`);
    assert.ok(t.description, `missing description: ${t.id}`);
    assert.ok(
      ["starter", "example", "library"].includes(t.category),
      `invalid category: ${t.id}`,
    );
    assert.ok(t.icon, `missing icon: ${t.id}`);
  }
});

test("PROJECT_TEMPLATES ids are unique", () => {
  const ids = PROJECT_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate template ids found");
});

test("PROJECT_TEMPLATES example entries have sourceDir", () => {
  const examples = PROJECT_TEMPLATES.filter((t) => t.category === "example");
  assert.ok(examples.length > 0, "no example templates found");
  for (const t of examples) {
    assert.ok(t.sourceDir, `example template "${t.id}" missing sourceDir`);
  }
});

test("PROJECT_TEMPLATES has at least one starter and one example", () => {
  const starters = PROJECT_TEMPLATES.filter((t) => t.category === "starter");
  const examples = PROJECT_TEMPLATES.filter((t) => t.category === "example");
  assert.ok(starters.length >= 1, "no starter templates");
  assert.ok(examples.length >= 1, "no example templates");
});

// ---------------------------------------------------------------------------
// generateBoardYaml
// ---------------------------------------------------------------------------

test("generateBoardYaml contains schema_version: 2", () => {
  const yaml = generateBoardYaml("E1M-AEN701", "my-app");
  assert.match(yaml, /schema_version:\s*2/);
});

test("generateBoardYaml embeds the module SKU", () => {
  const yaml = generateBoardYaml("E1M-V2N101", "sensor-app");
  assert.match(yaml, /sku:\s*E1M-V2N101/);
});

test("generateBoardYaml embeds the project name", () => {
  const yaml = generateBoardYaml("E1M-AEN701", "my-cool-project");
  assert.match(yaml, /name:\s*my-cool-project/);
});

test("generateBoardYaml sets version to 0.1.0", () => {
  const yaml = generateBoardYaml("E1M-AEN701", "test-proj");
  assert.match(yaml, /version:\s*"0\.1\.0"/);
});

test("generateBoardYaml output is non-empty string", () => {
  const yaml = generateBoardYaml("E1M-NX9101", "proj");
  assert.equal(typeof yaml, "string");
  assert.ok(yaml.length > 0);
});

// ---------------------------------------------------------------------------
// generateCMakeLists
// ---------------------------------------------------------------------------

test("generateCMakeLists contains cmake_minimum_required", () => {
  const cmake = generateCMakeLists("my-app");
  assert.match(cmake, /cmake_minimum_required/);
});

test("generateCMakeLists contains find_package(Zephyr)", () => {
  const cmake = generateCMakeLists("my-app");
  assert.match(cmake, /find_package\(Zephyr/);
});

test("generateCMakeLists embeds project name in project()", () => {
  const cmake = generateCMakeLists("sensor-demo");
  assert.match(cmake, /project\(sensor-demo\)/);
});

test("generateCMakeLists includes src/main.c source", () => {
  const cmake = generateCMakeLists("my-app");
  assert.match(cmake, /src\/main\.c/);
});

// ---------------------------------------------------------------------------
// generateMainC
// ---------------------------------------------------------------------------

test("generateMainC blank-app includes main function", () => {
  const src = generateMainC("blank-app");
  assert.match(src, /int main\(void\)/);
  assert.match(src, /#include <zephyr\/kernel\.h>/);
});

test("generateMainC blank-app does not have TODO comment", () => {
  const src = generateMainC("blank-app");
  assert.doesNotMatch(src, /TODO/);
});

test("generateMainC example template includes TODO stub comment", () => {
  const src = generateMainC("gpio-button-led");
  assert.match(src, /TODO/);
  assert.match(src, /gpio-button-led/);
});

test("generateMainC always includes zephyr kernel header", () => {
  for (const id of ["blank-app", "lvgl-widgets", "iot-dashboard"]) {
    const src = generateMainC(id);
    assert.match(
      src,
      /#include <zephyr\/kernel\.h>/,
      `missing header for template: ${id}`,
    );
  }
});

test("generateMainC always includes int main function", () => {
  for (const id of ["blank-app", "gpio-button-led", "audio-loopback"]) {
    const src = generateMainC(id);
    assert.match(src, /int main\(void\)/, `missing main() for template: ${id}`);
  }
});
