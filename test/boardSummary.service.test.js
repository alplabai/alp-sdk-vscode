const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createStatusBarPresentation,
  parseBoardSummary,
} = require("../packages/alp-core/dist/boardSummary/service.js");

test("parseBoardSummary extracts sku, carrier, and os", () => {
  const summary = parseBoardSummary(`
som:
  sku: E1M-AEN801
carrier:
  name: E1M-EVK
os: zephyr
`);

  assert.deepEqual(summary, {
    sku: "E1M-AEN801",
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
    sku: "E1M-AEN801",
    carrier: "E1M-EVK",
    os: "zephyr",
  });

  assert.equal(
    presentation.text,
    "$(circuit-board) E1M-AEN801 · E1M-EVK · zephyr",
  );
  assert.equal(presentation.command, "alp.openConfigurator");
});

test("parseBoardSummary extracts first active os from cores: in v2 documents", () => {
  const summary = parseBoardSummary(`
schema_version: 2
som:
  sku: E1M-V2N101
carrier:
  name: E1M-EVK
cores:
  a55_cluster:
    os: yocto
    image: alp-image-edge
  m33_sm:
    os: zephyr
    app: apps/zephyr-peer
`);

  assert.deepEqual(summary, {
    sku: "E1M-V2N101",
    carrier: "E1M-EVK",
    os: "yocto",
    coreIds: ["a55_cluster", "m33_sm"],
  });
});

test("parseBoardSummary returns undefined os when all cores are off", () => {
  const summary = parseBoardSummary(`
schema_version: 2
som:
  sku: E1M-V2N101
cores:
  m33_sm:
    os: off
`);

  assert.equal(summary?.os, undefined);
  assert.deepEqual(summary?.coreIds, ["m33_sm"]);
});

test("createStatusBarPresentation shows core count for multi-core v2 boards", () => {
  const presentation = createStatusBarPresentation({
    sku: "E1M-V2N101",
    carrier: "E1M-EVK",
    os: "yocto",
    coreIds: ["a55_cluster", "m33_sm"],
  });

  assert.equal(
    presentation.text,
    "$(circuit-board) E1M-V2N101 · E1M-EVK · 2 cores",
  );
});
