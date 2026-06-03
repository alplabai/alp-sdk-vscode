const test = require("node:test");
const assert = require("node:assert/strict");

const {
  loadBoardSummaryWithDependencies,
} = require("../packages/alp-core/dist/boardSummary/adapterCore.js");

test("loadBoardSummaryWithDependencies returns null when file is missing", () => {
  const logs = [];
  const summary = loadBoardSummaryWithDependencies("/missing/board.yaml", {
    existsSync: () => false,
    readFileSync: () => {
      throw new Error("should not be called");
    },
    log: (line) => logs.push(line),
  });

  assert.equal(summary, null);
  assert.deepEqual(logs, []);
});

test("loadBoardSummaryWithDependencies parses board.yaml contents", () => {
  const summary = loadBoardSummaryWithDependencies("/workspace/board.yaml", {
    existsSync: () => true,
    readFileSync: () =>
      "som:\n  sku: E1M-AEN701\ncarrier:\n  name: E1M-EVK\nos: zephyr\n",
    log: () => {},
  });

  assert.deepEqual(summary, {
    sku: "E1M-AEN701",
    carrier: "E1M-EVK",
    os: "zephyr",
  });
});

test("loadBoardSummaryWithDependencies logs and returns null on parse failure", () => {
  const logs = [];
  const summary = loadBoardSummaryWithDependencies("/workspace/board.yaml", {
    existsSync: () => true,
    readFileSync: () => {
      throw new Error("bad yaml");
    },
    log: (line) => logs.push(line),
  });

  assert.equal(summary, null);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /failed to parse/);
});
