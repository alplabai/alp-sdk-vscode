const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createStatusBarPresentation,
  parseBoardSummary,
} = require("../packages/alp-core/dist/boardSummary/service.js");

test("parseBoardSummary extracts sku, carrier, and os", () => {
  const summary = parseBoardSummary(`
som:
  sku: E1M-AEN701
carrier:
  name: E1M-EVK
os: zephyr
`);

  assert.deepEqual(summary, {
    sku: "E1M-AEN701",
    carrier: "E1M-EVK",
    os: "zephyr",
  });
});

test("createStatusBarPresentation renders empty state", () => {
  const presentation = createStatusBarPresentation(null);

  assert.equal(presentation.text, "$(circuit-board) Alp: no board.yaml");
  assert.equal(presentation.command, "alp.openConfigurator");
});

test("createStatusBarPresentation renders populated summary", () => {
  const presentation = createStatusBarPresentation({
    sku: "E1M-AEN701",
    carrier: "E1M-EVK",
    os: "zephyr",
  });

  assert.equal(
    presentation.text,
    "$(circuit-board) E1M-AEN701 · E1M-EVK · zephyr",
  );
  assert.equal(presentation.command, "alp.openConfigurator");
});
