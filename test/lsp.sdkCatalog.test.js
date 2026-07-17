const test = require("node:test");
const assert = require("node:assert/strict");

const {
  catalogFromPresets,
  EMPTY_SDK_CATALOG,
} = require("../out/lsp/sdkCatalog.js");
const {
  createBoardYamlCompletionSuggestions,
  createBoardYamlHoverInfo,
} = require("../out/lsp/service.js");

test("catalogFromPresets maps alp-presets data to SKUs + boardLibraries", () => {
  const catalog = catalogFromPresets({
    soms: [{ sku: "E1M-AEN401" }, { sku: "E1M-V2N101" }],
    boardLibraries: ["aws-iot", "lvgl"],
    // Unrelated fields (the built-in per-core `libraries`) are ignored.
    libraries: ["etl", "fmt"],
  });
  assert.deepEqual(catalog.skus, ["E1M-AEN401", "E1M-V2N101"]);
  assert.deepEqual(catalog.libraries, ["aws-iot", "lvgl"]);
});

test("catalogFromPresets tolerates a missing / degenerate payload", () => {
  assert.deepEqual(catalogFromPresets(null), EMPTY_SDK_CATALOG);
  assert.deepEqual(catalogFromPresets(undefined), EMPTY_SDK_CATALOG);
  assert.deepEqual(catalogFromPresets({}), EMPTY_SDK_CATALOG);
  // An old CLI without boardLibraries, and non-string / empty entries dropped.
  const catalog = catalogFromPresets({
    soms: [{ sku: "E1M-AEN801" }, {}, { sku: "" }, { sku: 42 }],
  });
  assert.deepEqual(catalog.skus, ["E1M-AEN801"]);
  assert.deepEqual(catalog.libraries, []);
});

test("som.sku value completion uses the pushed SDK catalog when present", () => {
  const doc = ["som:", "  sku: "].join("\n");
  const catalog = { skus: ["E1M-AEN401", "E1M-V2N101"], libraries: [] };
  const labels = createBoardYamlCompletionSuggestions(doc, 1, 7, catalog).map(
    (s) => s.label,
  );
  assert.ok(
    labels.includes("E1M-V2N101"),
    "catalog SKU (not in the built-in list) must be offered",
  );
  assert.ok(labels.includes("E1M-AEN401"));
});

test("som.sku value completion falls back to the built-in list without a catalog", () => {
  const doc = ["som:", "  sku: "].join("\n");
  const labels = createBoardYamlCompletionSuggestions(doc, 1, 7).map(
    (s) => s.label,
  );
  assert.deepEqual(labels, ["E1M-AEN801"]);
});

test("libraries[] value completion uses the pushed SDK catalog when present", () => {
  const doc = ["libraries:", "  - "].join("\n");
  const catalog = { skus: [], libraries: ["aws-iot", "lvgl"] };
  const labels = createBoardYamlCompletionSuggestions(doc, 1, 4, catalog).map(
    (s) => s.label,
  );
  assert.ok(labels.includes("aws-iot"));
  assert.ok(labels.includes("lvgl"));
});

test("som.sku hover surfaces the pushed catalog's allowed values", () => {
  const doc = ["som:", "  sku: E1M-AEN801"].join("\n");
  const catalog = { skus: ["E1M-AEN401", "E1M-V2N101"], libraries: [] };
  const hover = createBoardYamlHoverInfo(doc, 1, 5, catalog);
  assert.ok(hover, "hover info expected on som.sku");
  assert.deepEqual(hover.allowedValues, ["E1M-AEN401", "E1M-V2N101"]);
});
