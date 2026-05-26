const test = require("node:test");
const assert = require("node:assert/strict");
const { buildProjectNodes } = require("../out/projectView/model.js");

test("not connected + no board: only the Setup node", () => {
  const nodes = buildProjectNodes(null, false);
  assert.deepEqual(nodes.map((n) => n.id), ["setup"]);
  assert.equal(nodes[0].children[0].id, "setup.connect");
  assert.equal(nodes[0].children[0].command, "alp.connectSdk");
});

test("connected + no board: empty (welcome view takes over)", () => {
  assert.deepEqual(buildProjectNodes(null, true), []);
});

test("connected + board: project/actions/debug, no setup node", () => {
  const nodes = buildProjectNodes({ sku: "E1M-AEN701", preset: "e1m-evk" }, true);
  assert.deepEqual(nodes.map((n) => n.id), ["project", "actions", "debug"]);
});

test("not connected + board: setup node prepended", () => {
  const nodes = buildProjectNodes({ sku: "E1M-AEN701", preset: "e1m-evk" }, false);
  assert.deepEqual(nodes.map((n) => n.id), ["setup", "project", "actions", "debug"]);
});
