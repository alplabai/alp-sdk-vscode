const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createBoardYamlCompletionSuggestions,
} = require("../out/lsp/service.js");

// Drift gate for #72: top-level board.yaml completion must exactly match the
// vendored schema's top-level property set (schemas/board.schema.json is
// additionalProperties:false — there is exactly one schema, no v1/v2 split).
test("top-level completion keys equal the vendored schema's top-level properties", () => {
  const schemaPath = path.join(__dirname, "..", "schemas", "board.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  const schemaKeys = Object.keys(schema.properties ?? {}).sort();

  const suggestions = createBoardYamlCompletionSuggestions("", 0, 0);
  const completionKeys = suggestions.map((item) => item.label).sort();

  assert.deepEqual(
    completionKeys,
    schemaKeys,
    "top-level completion keys drifted from schemas/board.schema.json properties",
  );
});

test("top-level completion never offers schema-invalid keys", () => {
  const suggestions = createBoardYamlCompletionSuggestions("", 0, 0);
  const labels = suggestions.map((item) => item.label);

  for (const invalid of ["schema_version", "os", "inference", "iot"]) {
    assert(
      !labels.includes(invalid),
      `top-level completion must not offer '${invalid}' — rejected by schema.additionalProperties:false`,
    );
  }
});
