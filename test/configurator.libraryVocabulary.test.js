// SPDX-License-Identifier: Apache-2.0
//
// The library picker must offer the vocabulary the board schema accepts.
//
// `board.schema.json` says exactly what a top-level `libraries[]` entry is:
// items match `^[a-z][a-z0-9-]*$` and the description is verbatim "Canonical
// manifest name (metadata/libraries/<name>.yaml)". So the legal value set is
// the basenames under `metadata/libraries/`, hyphenated. Since ADR 0018 removed
// the per-core `cores.<id>.libraries` field, that top-level list is the ONLY
// library field a board.yaml has — there is no second vocabulary to confuse it
// with.
//
// The Configurator was offering something else: `loadSdkCatalogue` listed the
// *directories* under `metadata/library-profiles/`, a different concept (the
// per-core build profiles) whose names are UNDERSCORED. Against the SDK shipped
// as v0.16.0-rc1 that meant:
//
//   * two of the seven offered names — `cmsis_dsp` and `nlohmann_json` — do not
//     match the schema pattern at all, so picking either writes a board.yaml
//     that the SDK's own validator rejects;
//   * 29 of the 36 legal names (`arm-2d`, `littlefs`, `tflite-micro`, …) were
//     never offered, so the picker hid four fifths of the catalogue.
//
// Nothing about that is visible in the UI: seven plausible library names appear
// in a list, and only a later validation run tells the user the file is wrong.
//
// It is also a disagreement inside this extension. The LSP completion for the
// same field already reads `tan presets` -> `data.boardLibraries`
// (`src/lsp/sdkCatalog.ts:catalogFromPresets`), which IS the hyphenated
// manifest-name set. Two surfaces, one board.yaml field, two vocabularies.
//
// The pattern is read out of the vendored schema rather than copied here, so
// that a schema re-vendor moves the gate with it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadSdkCatalogue } = require("../out/sdkCatalogue/vscodeAdapter.js");

/** The `^[a-z][a-z0-9-]*$` the vendored board schema puts on a library name. */
function schemaLibraryNamePattern() {
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "schemas", "board.schema.json"),
      "utf8",
    ),
  );
  const items = schema.properties.libraries.items;
  const shorthand = items.oneOf.find((entry) => entry.type === "string");
  assert.ok(
    shorthand && typeof shorthand.pattern === "string",
    "board.schema.json no longer declares a string form for libraries[] — this gate needs rewriting against the new shape",
  );
  return new RegExp(shorthand.pattern);
}

/**
 * An SDK metadata tree carrying BOTH concepts, spelled the way the real SDK
 * spells them: hyphenated canonical manifests under `libraries/`, underscored
 * build profiles under `library-profiles/`.
 */
function writeSdkTree(root) {
  const meta = path.join(root, "metadata");
  for (const profile of ["cmsis_dsp", "nlohmann_json", "etl"]) {
    fs.mkdirSync(path.join(meta, "library-profiles", profile), {
      recursive: true,
    });
  }
  fs.writeFileSync(
    path.join(meta, "library-profiles", "README.md"),
    "# profiles, not a library\n",
  );

  fs.mkdirSync(path.join(meta, "libraries"), { recursive: true });
  for (const manifest of ["cmsis-dsp", "nlohmann-json", "etl", "littlefs"]) {
    fs.writeFileSync(
      path.join(meta, "libraries", `${manifest}.yaml`),
      `name: ${manifest}\n`,
    );
  }
}

function withSdkTree(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alp-library-vocab-"));
  try {
    writeSdkTree(root);
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("every offered library name is one the board schema accepts", () => {
  const pattern = schemaLibraryNamePattern();
  withSdkTree((root) => {
    const offered = loadSdkCatalogue(root).libraries.map((l) => l.id);
    const illegal = offered.filter((id) => !pattern.test(id));
    assert.deepEqual(
      illegal,
      [],
      `the picker offers ${illegal.length} name(s) that board.schema.json rejects (${pattern}): ${illegal.join(", ")} — picking one writes an invalid board.yaml`,
    );
  });
});

test("the offered names are the canonical manifests under metadata/libraries", () => {
  withSdkTree((root) => {
    const offered = loadSdkCatalogue(root).libraries.map((l) => l.id);
    assert.deepEqual(
      [...offered].sort(),
      ["cmsis-dsp", "etl", "littlefs", "nlohmann-json"],
      "libraries[] takes canonical manifest names (metadata/libraries/<name>.yaml), not metadata/library-profiles/ directory names",
    );
  });
});

test("a library manifest with no matching build profile is still offered", () => {
  withSdkTree((root) => {
    const offered = loadSdkCatalogue(root).libraries.map((l) => l.id);
    assert.ok(
      offered.includes("littlefs"),
      "`littlefs` ships a library manifest but no library-profiles/ directory; scanning profiles drops it from the picker entirely",
    );
  });
});
