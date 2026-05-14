const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
