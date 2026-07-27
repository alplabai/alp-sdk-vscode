// SPDX-License-Identifier: Apache-2.0
// Smoke tests for the SoM module catalog. (Project scaffolding moved to the CLI
// `alp init`; the former PROJECT_TEMPLATES + stub generators were removed.)

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { E1M_MODULES } = require("../out/ideHub/projectScaffold.js");

// The SDK submodule is the source of truth for which SoM SKUs exist. Read it
// directly: the shape assertions below all stayed green while a released SKU
// (E1M-AEN701) was missing, which is a wrong-silicon scaffold on the first-run
// path (`tan presets` returns empty `soms`, so the wizard uses this catalog).
const MODULES_DIR = path.join(
  __dirname,
  "..",
  "alp-sdk-upstream",
  "metadata",
  "e1m_modules",
);

// Glob the manifests: the directory also holds README.md and per-family
// subdirectories, so match the filename pattern rather than taking every entry.
const sdkModules = fs
  .readdirSync(MODULES_DIR)
  .filter((f) => /^E1M-[A-Z0-9]+\.yaml$/.test(f))
  .map((f) => {
    const text = fs.readFileSync(path.join(MODULES_DIR, f), "utf8");
    // Column-0 anchored so commented-out (`#   sku: ...`) and nested
    // (`  silicon: ...`) lines can't be mistaken for the real keys.
    const sku = /^sku:[ \t]*(\S+)/m.exec(text);
    const family = /^family:[ \t]*(\S+)/m.exec(text);
    assert.ok(sku, `no top-level 'sku:' in ${f}`);
    assert.ok(family, `no top-level 'family:' in ${f}`);
    return { file: f, sku: sku[1], family: family[1] };
  });

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

test("E1M_MODULES contains flagship E1M-AEN801", () => {
  const flagship = E1M_MODULES.find((m) => m.id === "E1M-AEN801");
  assert.ok(flagship, "E1M-AEN801 not found");
  assert.equal(flagship.family, "alif-ensemble");
});

test("E1M_MODULES contains E1M-NX9101 NXP entry", () => {
  const nxp = E1M_MODULES.find((m) => m.id === "E1M-NX9101");
  assert.ok(nxp, "E1M-NX9101 not found");
  assert.equal(nxp.family, "nxp-imx9");
});

// ---------------------------------------------------------------------------
// Membership gate: catalog == the SDK submodule's manifests
// ---------------------------------------------------------------------------

test("E1M_MODULES ids match the SDK's e1m_modules manifests exactly", () => {
  assert.ok(sdkModules.length > 0, `no E1M-*.yaml found under ${MODULES_DIR}`);
  assert.deepEqual(
    E1M_MODULES.map((m) => m.id).sort(),
    sdkModules.map((m) => m.sku).sort(),
    "catalog SKUs drifted from alp-sdk-upstream/metadata/e1m_modules/*.yaml",
  );
});

test("E1M_MODULES family matches the SDK manifest per SKU", () => {
  const byId = new Map(E1M_MODULES.map((m) => [m.id, m]));
  for (const { file, sku, family } of sdkModules) {
    const entry = byId.get(sku);
    assert.ok(entry, `${sku} (${file}) missing from E1M_MODULES`);
    assert.equal(entry.family, family, `${sku}: family disagrees with ${file}`);
  }
});

// ---------------------------------------------------------------------------
// The shipped board.yaml snippet (contributes.snippets — customer-visible)
// ---------------------------------------------------------------------------

const snippets = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "snippets", "board-yaml.json"),
    "utf8",
  ),
);

/** Choices offered on the `sku:` line of a snippet body, e.g. `${1|A,B|}`. */
function skuChoices(name) {
  const line = snippets[name].body.find((l) =>
    l.trimStart().startsWith("sku:"),
  );
  assert.ok(line, `no 'sku:' line in snippet "${name}"`);
  const m = /\$\{\d+\|([^|]+)\|\}/.exec(line);
  assert.ok(m, `'sku:' line in snippet "${name}" has no choice list: ${line}`);
  return m[1].split(",");
}

test("board.yaml snippets offer each SKU once", () => {
  for (const name of Object.keys(snippets)) {
    if (!snippets[name].body.some((l) => l.trimStart().startsWith("sku:")))
      continue;
    const choices = skuChoices(name);
    assert.equal(
      new Set(choices).size,
      choices.length,
      `duplicate SKU in snippet "${name}": ${choices.join(",")}`,
    );
    for (const sku of choices) {
      assert.ok(
        sdkModules.some((m) => m.sku === sku),
        `snippet "${name}" offers unknown SKU ${sku}`,
      );
    }
  }
});

test("the minimum-viable snippet offers every SKU the SDK ships", () => {
  assert.deepEqual(
    skuChoices("Minimum-viable board.yaml (v2)").sort(),
    sdkModules.map((m) => m.sku).sort(),
  );
});
