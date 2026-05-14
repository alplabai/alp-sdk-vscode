const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createBoardYamlCompletionSuggestions,
  createBoardYamlDocumentSymbols,
  createBoardYamlHoverInfo,
  createBoardYamlQuickFixes,
  createIssueRange,
  createLineZeroRange,
  normalizeProjectSettings,
} = require("../out/lsp/service.js");

test("normalizeProjectSettings returns defaults for non-object input", () => {
  assert.deepEqual(normalizeProjectSettings(null), {
    sdkPath: "",
    pythonPath: "",
    boardYamlPath: "board.yaml",
    westCwd: "",
  });
});

test("normalizeProjectSettings maps supported alpSdk fields", () => {
  assert.deepEqual(
    normalizeProjectSettings({
      path: "/workspace/sdk",
      pythonPath: "/usr/bin/python3",
      boardYamlPath: "configs/board.yaml",
      westCwd: "/workspace/project",
    }),
    {
      sdkPath: "/workspace/sdk",
      pythonPath: "/usr/bin/python3",
      boardYamlPath: "configs/board.yaml",
      westCwd: "/workspace/project",
    },
  );
});

test("createLineZeroRange clamps invalid lengths", () => {
  assert.deepEqual(createLineZeroRange(-4), {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  });
  assert.deepEqual(createLineZeroRange(7.8), {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 7 },
  });
});

test("createIssueRange maps som-related validator messages to som line", () => {
  const documentText = [
    "project:",
    "  som: E1M-NX1234",
    "  carrier: C1",
    "  hw_rev: r1",
  ].join("\n");

  const range = createIssueRange(
    documentText,
    "FAIL som preset: missing preset",
  );

  assert.deepEqual(range, {
    start: { line: 1, character: 0 },
    end: { line: 1, character: "  som: E1M-NX1234".length },
  });
});

test("createIssueRange maps explicit hw_rev field failures", () => {
  const documentText = [
    "project:",
    "  som: E1M-NX1234",
    "  carrier: C1",
    "  hw_rev: r1",
  ].join("\n");

  const range = createIssueRange(
    documentText,
    "FAIL hw_rev: unsupported revision",
  );

  assert.deepEqual(range, {
    start: { line: 3, character: 0 },
    end: { line: 3, character: "  hw_rev: r1".length },
  });
});

test("createIssueRange falls back to line zero when key is unknown", () => {
  const documentText = ["project:", "  som: E1M-NX1234"].join("\n");
  const range = createIssueRange(
    documentText,
    "FAIL unsupported section: mismatch",
  );

  assert.deepEqual(range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: "project:".length },
  });
});

test("createBoardYamlCompletionSuggestions suggests top-level keys", () => {
  const suggestions = createBoardYamlCompletionSuggestions("", 0, 0);
  const labels = suggestions.map((item) => item.label);

  assert(labels.includes("som"));
  assert(labels.includes("os"));
  assert(labels.includes("diagnostics"));
});

test("createBoardYamlCompletionSuggestions suggests enum values for os", () => {
  const suggestions = createBoardYamlCompletionSuggestions("os: ", 0, 4);
  const labels = suggestions.map((item) => item.label);

  assert.deepEqual(labels, ["zephyr", "yocto", "baremetal"]);
});

test("createBoardYamlCompletionSuggestions suggests nested keys", () => {
  const documentText = ["inference:", "  "].join("\n");
  const suggestions = createBoardYamlCompletionSuggestions(documentText, 1, 2);
  const labels = suggestions.map((item) => item.label);

  assert(labels.includes("backend"));
  assert(labels.includes("default_arena_kib"));
});

test("createBoardYamlHoverInfo returns docs for core fields", () => {
  const hover = createBoardYamlHoverInfo("os: zephyr", 0, 1);

  assert.equal(hover?.title, "os");
  assert.match(hover?.description ?? "", /operating system/i);
  assert.deepEqual(hover?.allowedValues, ["zephyr", "yocto", "baremetal"]);
});

test("createBoardYamlHoverInfo returns docs for nested fields", () => {
  const documentText = ["diagnostics:", "  log_level: info"].join("\n");
  const hover = createBoardYamlHoverInfo(documentText, 1, 5);

  assert.equal(hover?.title, "diagnostics.log_level");
  assert.match(hover?.description ?? "", /log verbosity/i);
});

test("createBoardYamlDocumentSymbols builds nested symbol tree", () => {
  const documentText = [
    "schema_version: 1",
    "som:",
    "  sku: E1M-AEN701",
    "inference:",
    "  backend: auto",
    "  default_arena_kib: 512",
  ].join("\n");

  const symbols = createBoardYamlDocumentSymbols(documentText);
  assert.deepEqual(
    symbols.map((item) => item.name),
    ["schema_version", "som", "inference"],
  );

  assert.deepEqual(
    symbols[1].children.map((item) => item.name),
    ["sku"],
  );
  assert.deepEqual(
    symbols[2].children.map((item) => item.name),
    ["backend", "default_arena_kib"],
  );
});

test("createBoardYamlQuickFixes suggests adding missing som block", () => {
  const fixes = createBoardYamlQuickFixes(
    "os: zephyr\n",
    "FAIL som preset: missing preset",
  );

  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].title, "Add missing som.sku block");
  assert.match(fixes[0].newText, /^som:\n\s+sku:/);
});

test("createBoardYamlQuickFixes does not suggest som block when present", () => {
  const fixes = createBoardYamlQuickFixes(
    ["som:", "  sku: E1M-AEN701", "os: zephyr"].join("\n"),
    "FAIL som preset: missing preset",
  );

  assert.deepEqual(fixes, []);
});

test("createBoardYamlQuickFixes can suggest multiple missing fields", () => {
  const fixes = createBoardYamlQuickFixes(
    "schema_version: 1\n",
    "FAIL som carrier os mismatch",
  );

  const titles = fixes.map((item) => item.title);
  assert(titles.includes("Add missing som.sku block"));
  assert(titles.includes("Add missing carrier.name block"));
  assert(titles.includes("Add missing os field"));
});
