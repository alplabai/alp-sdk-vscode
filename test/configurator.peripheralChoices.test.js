const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The peripheral drift gate (alp-sdk#919).
//
// `PERIPHERAL_CHOICES` in ConfiguratorView.tsx is the list the Configurator's
// per-core "Add peripheral…" selector offers. It is a hand-written literal:
// the webview is a separate Vite bundle and cannot import the vendored schema
// the way src/lsp/service.ts does, so the two copies are kept in sync by hand
// (same convention as `librariesForCore` in the same file).
//
// Hand-sync without a gate is how the list silently went stale: users reported
// peripherals "missing" from the IDE, and the cause was the SDK-side enum
// growing while this literal did not. board.schema.vendored.test.js pins the
// vendored schema byte-for-byte, so it catches a re-vendor — but nothing tied
// that re-vendor to this literal. This test is that tie: re-vendor the schema
// with a new peripheral class and this fails until the selector offers it.
//
// The literal is read out of the .tsx source rather than imported: the webview
// bundle is IIFE-formatted for the webview's non-module script tag, so there is
// no requireable artefact to import it from.

const TSX = path.join(
  __dirname,
  "..",
  "packages",
  "alp-webview",
  "src",
  "features",
  "configurator",
  "ConfiguratorView.tsx",
);
const SCHEMA = path.join(__dirname, "..", "schemas", "board.schema.json");

/** Extract the string literals from `const PERIPHERAL_CHOICES = [ ... ];`. */
function readPeripheralChoices() {
  const src = fs.readFileSync(TSX, "utf-8");
  const block = /const PERIPHERAL_CHOICES\s*=\s*\[([\s\S]*?)\]/.exec(src);
  assert.ok(
    block,
    "ConfiguratorView.tsx must declare `const PERIPHERAL_CHOICES = [...]` — " +
      "if it was renamed or moved, update this gate to match",
  );
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("PERIPHERAL_CHOICES matches the vendored core_entry.peripherals enum", () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA, "utf-8"));
  const enumValues =
    schema.$defs?.core_entry?.properties?.peripherals?.items?.enum;
  assert.ok(
    Array.isArray(enumValues) && enumValues.length > 0,
    "vendored schema must define $defs.core_entry.properties.peripherals.items.enum",
  );

  const choices = readPeripheralChoices();
  const missing = enumValues.filter((v) => !choices.includes(v));
  const extra = choices.filter((v) => !enumValues.includes(v));

  assert.deepEqual(
    missing,
    [],
    `PERIPHERAL_CHOICES omits schema peripheral class(es) [${missing.join(", ")}] — ` +
      "the Configurator selector would not offer them, so the class reads as " +
      "'missing' in the IDE. Add them to ConfiguratorView.tsx.",
  );
  assert.deepEqual(
    extra,
    [],
    `PERIPHERAL_CHOICES offers [${extra.join(", ")}], which the vendored schema ` +
      "rejects — the Configurator would write a board.yaml that fails validation.",
  );
});

test("PERIPHERAL_CHOICES is sorted (stable selector order)", () => {
  const choices = readPeripheralChoices();
  assert.deepEqual(
    choices,
    [...choices].sort(),
    "keep PERIPHERAL_CHOICES alphabetically sorted so the selector order is " +
      "stable and a re-vendor diff stays reviewable",
  );
});
