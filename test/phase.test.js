const test = require("node:test");
const assert = require("node:assert");
const { derivePhase } = require("../out/ideHub/phase.js");

const base = {
  sdk: {
    readiness: "ready",
    activePath: null,
    version: null,
    localEntries: [],
  },
  setup: {
    pythonAvailable: true,
    westAvailable: true,
    lastBootstrapAt: null,
    toolVersions: { python: null, west: null, cmake: null, ninja: null },
  },
  workspace: {
    workspaceRoot: "/w",
    boardYamlExists: true,
    boardYamlValid: true,
    boardIssueCount: 0,
    westInitialized: true,
  },
};
const s = (over) => ({
  ...base,
  ...over,
  setup: { ...base.setup, ...(over.setup || {}) },
  sdk: { ...base.sdk, ...(over.sdk || {}) },
  workspace: { ...base.workspace, ...(over.workspace || {}) },
});

test("no-env when python missing", () => {
  assert.equal(derivePhase(s({ setup: { pythonAvailable: false } })), "no-env");
});
test("no-env when sdk not ready", () => {
  assert.equal(derivePhase(s({ sdk: { readiness: "missing" } })), "no-env");
});
test("no-project when env ready but no board.yaml", () => {
  assert.equal(
    derivePhase(s({ workspace: { boardYamlExists: false } })),
    "no-project",
  );
});
test("invalid-board when board present but not valid", () => {
  assert.equal(
    derivePhase(s({ workspace: { boardYamlValid: false } })),
    "invalid-board",
  );
});
test("ready when env + valid board", () => {
  assert.equal(derivePhase(base), "ready");
});
