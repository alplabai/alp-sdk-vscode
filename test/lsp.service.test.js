const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
