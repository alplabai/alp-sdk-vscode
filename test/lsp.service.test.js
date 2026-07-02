const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createBoardYamlCompletionSuggestions,
  createBoardYamlDocumentSymbols,
  createBoardYamlHoverInfo,
  createBoardYamlQuickFixes,
  createDiagnosticMessageWithContext,
  createEffectiveConfigPreviewPayload,
  createIssueRange,
  createLineZeroRange,
  detectV2StructuralIssues,
  findTokenRange,
  normalizeProjectSettings,
  V2_LEGACY_OS_FIELD_MSG,
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

test("createEffectiveConfigPreviewPayload returns normalized config with context", () => {
  const payload = createEffectiveConfigPreviewPayload(
    [
      "schema_version: 1",
      "som:",
      "  sku: E1M-AEN701",
      "os: zephyr",
      "iot:",
      "  wifi: false",
      "  mqtt: false",
      "  ble: false",
      "  tls: false",
    ].join("\n"),
    "/workspace/app/board.yaml",
    {
      workspaceRoot: "/workspace/app",
      sdkRoot: "/workspace/sdk",
      boardYamlPath: "/workspace/app/board.yaml",
      westCwd: "/workspace/app",
      pythonBinary: "python3",
    },
  );

  assert.equal(payload.schemaVersion, "1");
  assert.equal(payload.boardYamlPath, "/workspace/app/board.yaml");
  assert.equal(payload.projectContext.sdkRoot, "/workspace/sdk");
  assert.equal(payload.effectiveConfig.os, "zephyr");
  assert.equal(payload.effectiveConfig.iot, undefined);
});

test("createDiagnosticMessageWithContext enriches issue with effective context", () => {
  const message = createDiagnosticMessageWithContext(
    "FAIL som preset: missing preset",
    [
      "som:",
      "  sku: E1M-AEN701",
      "carrier:",
      "  name: E1M-EVK",
      "os: zephyr",
    ].join("\n"),
  );

  assert.match(message, /^FAIL som preset: missing preset/m);
  assert.match(message, /Context: .*som\.sku=E1M-AEN701/);
  assert.match(message, /Preset origin: .*som\.sku=board\.yaml inline/);
});

// --- detectV2StructuralIssues ---

test("detectV2StructuralIssues returns empty for v1 document with top-level os", () => {
  const issues = detectV2StructuralIssues(
    ["schema_version: 1", "som:", "  sku: E1M-AEN701", "os: zephyr"].join("\n"),
  );
  assert.deepEqual(issues, []);
});

test("detectV2StructuralIssues returns error for v2 document with top-level os", () => {
  const issues = detectV2StructuralIssues(
    ["schema_version: 2", "som:", "  sku: E1M-AEN701", "os: zephyr"].join("\n"),
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "error");
  assert.equal(issues[0].message, V2_LEGACY_OS_FIELD_MSG);
});

test("detectV2StructuralIssues returns empty for clean v2 document", () => {
  const issues = detectV2StructuralIssues(
    [
      "schema_version: 2",
      "som:",
      "  sku: E1M-AEN701",
      "cores:",
      "  a32_cluster:",
      "    os: yocto",
      "  m55_hp:",
      "    os: zephyr",
    ].join("\n"),
  );
  assert.deepEqual(issues, []);
});

// --- createBoardYamlQuickFixes v2 migration ---

test("createBoardYamlQuickFixes offers migration fix for v2 legacy os field", () => {
  const doc = [
    "schema_version: 2",
    "som:",
    "  sku: E1M-AEN701",
    "os: zephyr",
  ].join("\n");
  const fixes = createBoardYamlQuickFixes(doc, V2_LEGACY_OS_FIELD_MSG);
  assert.equal(fixes.length, 1);
  assert.match(fixes[0].title, /Migrate 'os: zephyr' to cores: block/);
  // Should replace the os: line
  assert.equal(fixes[0].endLine, fixes[0].line);
  assert.match(fixes[0].newText, /^cores:\n\s+m55_hp:/);
});

test("createBoardYamlQuickFixes migration uses a55_cluster for yocto on V2N SoM", () => {
  const doc = [
    "schema_version: 2",
    "som:",
    "  sku: E1M-V2N101",
    "os: yocto",
  ].join("\n");
  const fixes = createBoardYamlQuickFixes(doc, V2_LEGACY_OS_FIELD_MSG);
  assert.equal(fixes.length, 1);
  assert.match(fixes[0].newText, /^cores:\n\s+a55_cluster:/);
});

test("createBoardYamlQuickFixes does not offer add-os fix for v2 documents", () => {
  const doc = ["schema_version: 2", "som:", "  sku: E1M-AEN701"].join("\n");
  const fixes = createBoardYamlQuickFixes(doc, "FAIL os missing or invalid");
  const titles = fixes.map((f) => f.title);
  assert(
    !titles.includes("Add missing os field"),
    "Should not offer os fix for v2",
  );
});

test("createBoardYamlQuickFixes still offers add-os fix for v1 documents", () => {
  const doc = ["schema_version: 1", "som:", "  sku: E1M-AEN701"].join("\n");
  const fixes = createBoardYamlQuickFixes(doc, "FAIL os missing");
  const titles = fixes.map((f) => f.title);
  assert(titles.includes("Add missing os field"), "Should offer os fix for v1");
});

test("findTokenRange locates the first occurrence of a token", () => {
  const doc =
    "som:\n  sku: E1M-AEN701\ne1m_routes:\n  pwm:\n    - e1m: E1M_PWM9\n";
  const range = findTokenRange(doc, "E1M_PWM9");
  assert.deepEqual(range, {
    start: { line: 4, character: 11 },
    end: { line: 4, character: 19 },
  });
});

test("findTokenRange falls back to document start when the token is absent", () => {
  const fallback = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };
  assert.deepEqual(findTokenRange("som:\n", "E1M_PWM9"), fallback);
  assert.deepEqual(findTokenRange("anything", ""), fallback);
});
