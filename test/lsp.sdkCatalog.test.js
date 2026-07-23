const test = require("node:test");
const assert = require("node:assert/strict");

const {
  catalogFromPresets,
  kconfigSymbolsFromEnvelope,
  fetchKconfigSymbolsForCore,
  clearKconfigSymbolCache,
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

test("kconfigSymbolsFromEnvelope maps the rich per-core SDK payload (alp-sdk #894)", () => {
  const symbols = kconfigSymbolsFromEnvelope({
    schemaVersion: 1,
    board: "e1m_v2n101_som",
    core: "m55_hp",
    symbols: [
      {
        name: "ALP_SDK_BLE",
        type: "bool",
        prompt: "Enable BLE",
        depends: ["ALP_SDK"],
        default: "n",
        help: "Real Bluetooth host stack via Zephyr bt for <alp/ble.h>.",
      },
      {
        name: "MAIN_STACK_SIZE",
        type: "int",
        prompt: "Main stack size",
        default: 2048,
      },
    ],
  });
  assert.deepEqual(symbols, [
    {
      name: "ALP_SDK_BLE",
      type: "bool",
      doc: "Real Bluetooth host stack via Zephyr bt for <alp/ble.h>.",
      valueHint: "n",
      source: "sdk-live",
    },
    {
      name: "MAIN_STACK_SIZE",
      type: "int",
      doc: "Main stack size",
      valueHint: "2048",
      source: "sdk-live",
    },
  ]);
});

test("kconfigSymbolsFromEnvelope falls back doc to prompt then empty; drops an empty default", () => {
  const symbols = kconfigSymbolsFromEnvelope({
    symbols: [
      {
        name: "PROMPT_ONLY",
        type: "bool",
        prompt: "Has a prompt only",
        default: "",
      },
      { name: "NO_PROMPT_NO_HELP", type: "bool" },
    ],
  });
  assert.equal(symbols[0].doc, "Has a prompt only");
  assert.equal(symbols[0].valueHint, undefined);
  assert.equal(symbols[1].doc, "");
});

test("kconfigSymbolsFromEnvelope tolerates missing/degenerate data + malformed entries (old CLI predating `--core`, or the old flat #298 payload)", () => {
  assert.deepEqual(kconfigSymbolsFromEnvelope(null), []);
  assert.deepEqual(kconfigSymbolsFromEnvelope(undefined), []);
  assert.deepEqual(kconfigSymbolsFromEnvelope({}), []);
  assert.deepEqual(kconfigSymbolsFromEnvelope({ symbols: "not-an-array" }), []);
  // The pre-#894 flat `{symbols: string[]}` shape has no object entries — it
  // collapses to empty here rather than throwing.
  assert.deepEqual(
    kconfigSymbolsFromEnvelope({ symbols: ["ALP_SDK", "ALP_HAS_BMI270"] }),
    [],
  );
  assert.deepEqual(
    kconfigSymbolsFromEnvelope({
      symbols: [
        { name: "OK", type: "bool", help: "fine" },
        { type: "bool", help: "missing name" },
        { name: "", type: "bool", help: "empty name" },
        { name: "BAD_TYPE", type: "not-a-type", help: "junk type dropped" },
        null,
        "not-an-object",
        42,
      ],
    }),
    [
      { name: "OK", type: "bool", doc: "fine", source: "sdk-live" },
      { name: "BAD_TYPE", doc: "junk type dropped", source: "sdk-live" },
    ],
  );
});

test("fetchKconfigSymbolsForCore caches per (sdkRoot, boardYamlPath, coreId) — a different core is a different entry", async () => {
  clearKconfigSymbolCache();
  const calls = [];
  const fetchEnvelope = async (coreId, cwd) => {
    calls.push({ coreId, cwd });
    return { symbols: [{ name: `SYM_${coreId}`, type: "bool", help: "x" }] };
  };

  const hp = await fetchKconfigSymbolsForCore(
    "/sdk",
    "/proj/board.yaml",
    "m55_hp",
    "/proj",
    fetchEnvelope,
  );
  const he = await fetchKconfigSymbolsForCore(
    "/sdk",
    "/proj/board.yaml",
    "m55_he",
    "/proj",
    fetchEnvelope,
  );
  assert.equal(calls.length, 2, "two distinct cores must both fetch");
  assert.deepEqual(
    hp.map((s) => s.name),
    ["SYM_m55_hp"],
  );
  assert.deepEqual(
    he.map((s) => s.name),
    ["SYM_m55_he"],
  );

  // Same (sdkRoot, boardYamlPath, coreId) again: served from cache.
  await fetchKconfigSymbolsForCore(
    "/sdk",
    "/proj/board.yaml",
    "m55_hp",
    "/proj",
    fetchEnvelope,
  );
  assert.equal(
    calls.length,
    2,
    "a repeat fetch for the same key must hit the cache",
  );
});

test("fetchKconfigSymbolsForCore never caches an empty/failed fetch — the offline fallback stays retryable", async () => {
  clearKconfigSymbolCache();
  let calls = 0;
  // Simulates `tan kconfig --core` not existing yet (pre tan-cli #35): the
  // envelope fetch resolves with no usable data.
  const emptyFetch = async () => {
    calls++;
    return undefined;
  };
  const first = await fetchKconfigSymbolsForCore(
    "/sdk",
    "/proj/board.yaml",
    "m55_hp",
    "/proj",
    emptyFetch,
  );
  const second = await fetchKconfigSymbolsForCore(
    "/sdk",
    "/proj/board.yaml",
    "m55_hp",
    "/proj",
    emptyFetch,
  );
  assert.deepEqual(first, []);
  assert.deepEqual(second, []);
  assert.equal(calls, 2, "an empty result must not stick — retried every call");
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
