const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveSdkCatalog,
  scanSdkCompletionCatalog,
  EMPTY_SDK_CATALOG,
} = require("../out/lsp/sdkCatalog.js");
const {
  createBoardYamlCompletionSuggestions,
  createBoardYamlHoverInfo,
} = require("../out/lsp/service.js");

test("deriveSdkCatalog maps metadata filenames to SKU/library stems", () => {
  const catalog = deriveSdkCatalog(
    ["E1M-AEN701.yaml", "E1M-AEN401.yaml", "E1M-V2N101.yaml"],
    ["lvgl.yaml", "cmsis-dsp.yaml"],
  );
  assert.deepEqual(catalog.skus, ["E1M-AEN401", "E1M-AEN701", "E1M-V2N101"]);
  assert.deepEqual(catalog.libraries, ["cmsis-dsp", "lvgl"]);
});

test("deriveSdkCatalog drops README + non-yaml entries and de-dups", () => {
  const catalog = deriveSdkCatalog(
    [
      "README.md",
      "E1M-AEN701.yaml",
      "E1M-AEN701.yaml",
      "notes.txt",
      ".gitkeep",
    ],
    ["README.md"],
  );
  assert.deepEqual(catalog.skus, ["E1M-AEN701"]);
  assert.deepEqual(catalog.libraries, []);
});

test("scanSdkCompletionCatalog degrades to empty without throwing", () => {
  assert.deepEqual(scanSdkCompletionCatalog(null), EMPTY_SDK_CATALOG);
  assert.deepEqual(scanSdkCompletionCatalog(undefined), EMPTY_SDK_CATALOG);
  // A path with no metadata/ dirs must not throw.
  const missing = scanSdkCompletionCatalog("/no/such/sdk/root");
  assert.deepEqual(missing.skus, []);
  assert.deepEqual(missing.libraries, []);
});

test("som.sku value completion uses the scanned SDK catalog when present", () => {
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
  assert.deepEqual(labels, ["E1M-AEN701"]);
});

test("libraries[] value completion uses the scanned SDK catalog when present", () => {
  const doc = ["libraries:", "  - "].join("\n");
  const catalog = { skus: [], libraries: ["aws-iot", "lvgl"] };
  const labels = createBoardYamlCompletionSuggestions(doc, 1, 4, catalog).map(
    (s) => s.label,
  );
  assert.ok(labels.includes("aws-iot"));
  assert.ok(labels.includes("lvgl"));
});

test("som.sku hover surfaces the scanned catalog's allowed values", () => {
  const doc = ["som:", "  sku: E1M-AEN701"].join("\n");
  const catalog = { skus: ["E1M-AEN401", "E1M-V2N101"], libraries: [] };
  const hover = createBoardYamlHoverInfo(doc, 1, 5, catalog);
  assert.ok(hover, "hover info expected on som.sku");
  assert.deepEqual(hover.allowedValues, ["E1M-AEN401", "E1M-V2N101"]);
});
