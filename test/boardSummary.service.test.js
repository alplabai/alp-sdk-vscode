const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseBoardSummary,
  createStatusBarPresentation,
} = require("../packages/alp-core/dist/boardSummary/service.js");

test("parseBoardSummary reads sku + preset from a v0.6 board.yaml", () => {
  const s = parseBoardSummary("som:\n  sku: E1M-AEN701\npreset: e1m-evk\ncores:\n  m55_hp: { app: ./src }\n");
  assert.deepEqual(s, { sku: "E1M-AEN701", preset: "e1m-evk" });
});

test("parseBoardSummary omits preset in inline mode", () => {
  const s = parseBoardSummary("som:\n  sku: E1M-V2N101\npopulated:\n  lsm6dso: true\ncores:\n  m33_sm: {}\n");
  assert.deepEqual(s, { sku: "E1M-V2N101", preset: undefined });
});

test("parseBoardSummary returns null for non-object yaml", () => {
  assert.equal(parseBoardSummary("42"), null);
});

test("createStatusBarPresentation renders empty state", () => {
  const p = createStatusBarPresentation(null);
  assert.equal(p.text, "$(circuit-board) Alp: no board.yaml");
  assert.equal(p.command, "alp.openConfigurator");
});

test("createStatusBarPresentation renders sku + preset", () => {
  const p = createStatusBarPresentation({ sku: "E1M-AEN701", preset: "e1m-evk" });
  assert.equal(p.text, "$(circuit-board) E1M-AEN701 · e1m-evk");
  assert.equal(p.command, "alp.openConfigurator");
});

test("createStatusBarPresentation renders sku alone when no preset", () => {
  const p = createStatusBarPresentation({ sku: "E1M-V2N101" });
  assert.equal(p.text, "$(circuit-board) E1M-V2N101");
});
