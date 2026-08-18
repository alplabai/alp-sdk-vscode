const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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

/** A real, stat-able board.yaml path — the cache key folds in its mtime, so
 *  the caching tests need an actual file rather than a fake "/proj/board.yaml"
 *  string (which never stats and would always skip the cache). */
function tempBoardYaml() {
  const p = path.join(
    os.tmpdir(),
    `alp-sdk-vscode-test-board-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`,
  );
  fs.writeFileSync(p, "cores: {}\n");
  return p;
}

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

test("kconfigSymbolsFromEnvelope keeps a tristate type (kconfiglib's full TYPE_TO_STR set)", () => {
  const symbols = kconfigSymbolsFromEnvelope({
    symbols: [
      { name: "MMC_HOST", type: "tristate", help: "Enable MMC host driver" },
    ],
  });
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].type, "tristate");
});

test("kconfigSymbolsFromEnvelope only sets valueHint for a literal default, dropping a symbol-reference/expression", () => {
  const symbols = kconfigSymbolsFromEnvelope({
    symbols: [
      {
        name: "EXPR_DEFAULT",
        type: "bool",
        help: "x",
        default: "OTHER_SYMBOL",
      },
      { name: "BOOL_DEFAULT", type: "bool", help: "x", default: "y" },
      { name: "HEX_DEFAULT", type: "hex", help: "x", default: "0x1000" },
      { name: "INT_DEFAULT", type: "int", help: "x", default: "1024" },
      {
        name: "STRING_DEFAULT",
        type: "string",
        help: "x",
        default: '"a string"',
      },
    ],
  });
  const byName = Object.fromEntries(symbols.map((s) => [s.name, s]));
  assert.equal(
    byName.EXPR_DEFAULT.valueHint,
    undefined,
    "a bare symbol-name default is an expression, not an insertable literal",
  );
  assert.equal(byName.BOOL_DEFAULT.valueHint, "y");
  assert.equal(byName.HEX_DEFAULT.valueHint, "0x1000");
  assert.equal(byName.INT_DEFAULT.valueHint, "1024");
  assert.equal(byName.STRING_DEFAULT.valueHint, '"a string"');
});

test("fetchKconfigSymbolsForCore caches per (sdkRoot, boardYamlPath, coreId, mtime) — a different core is a different entry", async () => {
  clearKconfigSymbolCache();
  const boardYamlPath = tempBoardYaml();
  try {
    const calls = [];
    const fetchEnvelope = async (coreId, cwd) => {
      calls.push({ coreId, cwd });
      return { symbols: [{ name: `SYM_${coreId}`, type: "bool", help: "x" }] };
    };

    const hp = await fetchKconfigSymbolsForCore(
      "/sdk",
      boardYamlPath,
      "m55_hp",
      "/proj",
      fetchEnvelope,
    );
    const he = await fetchKconfigSymbolsForCore(
      "/sdk",
      boardYamlPath,
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

    // Same (sdkRoot, boardYamlPath, coreId, mtime) again: served from cache.
    await fetchKconfigSymbolsForCore(
      "/sdk",
      boardYamlPath,
      "m55_hp",
      "/proj",
      fetchEnvelope,
    );
    assert.equal(
      calls.length,
      2,
      "a repeat fetch for the same key must hit the cache",
    );
  } finally {
    fs.rmSync(boardYamlPath, { force: true });
  }
});

test("fetchKconfigSymbolsForCore invalidates when board.yaml's mtime changes (in-place edit self-invalidates)", async () => {
  clearKconfigSymbolCache();
  const boardYamlPath = tempBoardYaml();
  try {
    let calls = 0;
    const fetchEnvelope = async () => {
      calls++;
      return { symbols: [{ name: "SYM", type: "bool", help: "x" }] };
    };

    await fetchKconfigSymbolsForCore(
      "/sdk",
      boardYamlPath,
      "m55_hp",
      "/proj",
      fetchEnvelope,
    );
    await fetchKconfigSymbolsForCore(
      "/sdk",
      boardYamlPath,
      "m55_hp",
      "/proj",
      fetchEnvelope,
    );
    assert.equal(calls, 1, "an unchanged mtime must hit the cache");

    // Push mtime forward by a few seconds — some filesystems only have ~1-2s
    // mtime resolution, so a tiny bump could round away to the same value.
    const bumped = new Date(fs.statSync(boardYamlPath).mtime.getTime() + 5000);
    fs.utimesSync(boardYamlPath, bumped, bumped);

    await fetchKconfigSymbolsForCore(
      "/sdk",
      boardYamlPath,
      "m55_hp",
      "/proj",
      fetchEnvelope,
    );
    assert.equal(
      calls,
      2,
      "board.yaml's mtime changing must refetch, not hit the stale cache entry",
    );
  } finally {
    fs.rmSync(boardYamlPath, { force: true });
  }
});

test("fetchKconfigSymbolsForCore never caches when board.yaml can't be stat'd — always refetches rather than caching under an unkeyed entry", async () => {
  clearKconfigSymbolCache();
  const missingPath = path.join(
    os.tmpdir(),
    `alp-sdk-vscode-test-missing-${process.pid}-${Date.now()}.yaml`,
  );
  let calls = 0;
  const fetchEnvelope = async () => {
    calls++;
    return { symbols: [{ name: "SYM", type: "bool", help: "x" }] };
  };
  await fetchKconfigSymbolsForCore(
    "/sdk",
    missingPath,
    "m55_hp",
    "/proj",
    fetchEnvelope,
  );
  await fetchKconfigSymbolsForCore(
    "/sdk",
    missingPath,
    "m55_hp",
    "/proj",
    fetchEnvelope,
  );
  assert.equal(
    calls,
    2,
    "an unstattable board.yaml must skip caching, not stick under a bad key",
  );
});

test("fetchKconfigSymbolsForCore never caches an empty/failed fetch — the offline fallback stays retryable", async () => {
  clearKconfigSymbolCache();
  const boardYamlPath = tempBoardYaml();
  try {
    let calls = 0;
    // Simulates `tan kconfig --core` not existing yet (pre tan-cli #35): the
    // envelope fetch resolves with no usable data.
    const emptyFetch = async () => {
      calls++;
      return undefined;
    };
    const first = await fetchKconfigSymbolsForCore(
      "/sdk",
      boardYamlPath,
      "m55_hp",
      "/proj",
      emptyFetch,
    );
    const second = await fetchKconfigSymbolsForCore(
      "/sdk",
      boardYamlPath,
      "m55_hp",
      "/proj",
      emptyFetch,
    );
    assert.deepEqual(first, []);
    assert.deepEqual(second, []);
    assert.equal(
      calls,
      2,
      "an empty result must not stick — retried every call",
    );
  } finally {
    fs.rmSync(boardYamlPath, { force: true });
  }
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

test("som.sku value completion falls back to every shipped SoM without a catalog", () => {
  const doc = ["som:", "  sku: "].join("\n");
  const labels = createBoardYamlCompletionSuggestions(doc, 1, 7).map(
    (s) => s.label,
  );
  // No catalog = the first-run path, before any SDK resolves. This fallback is
  // then the only SKU list a customer editing board.yaml sees, so it has to
  // cover the whole shipped range: it used to hold one hardcoded SKU, which
  // left an E7 owner unable to pick their own module at all.
  assert.ok(
    labels.includes("E1M-AEN701"),
    "a released module must be offered before an SDK resolves",
  );
  assert.ok(
    labels.includes("E1M-AEN801"),
    "the previously-only SKU must still be offered",
  );
  // Literal count on purpose — deriving it from E1M_MODULES would compare that
  // list to itself and pass even if the list were wrong. What keeps the list
  // honest is test/ideHub.projectScaffold.test.js, which pins it against the
  // alp-sdk-upstream manifests; this only pins that the fallback offers ALL of
  // them. Bump it when the SDK ships a new SoM.
  assert.equal(
    labels.length,
    11,
    "the fallback must offer every SKU the SDK ships, not a subset",
  );
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
