const test = require("node:test");
const assert = require("node:assert/strict");

const { buildProjectNodes } = require("../out/projectView/model.js");

test("buildProjectNodes returns no roots when there is no board (welcome view shows)", () => {
  assert.deepEqual(buildProjectNodes(null), []);
  assert.deepEqual(buildProjectNodes({}), []);
});

test("buildProjectNodes returns Project / Actions / Debug sections for a board", () => {
  const roots = buildProjectNodes({
    sku: "E1M-AEN701",
    carrier: "E1M-EVK",
    os: "zephyr",
  });

  assert.deepEqual(
    roots.map((node) => node.label),
    ["Project", "Actions", "Debug"],
  );
  assert.ok(roots.every((node) => node.collapsible === true));
});

test("buildProjectNodes maps sku + preset to the Project section", () => {
  const [project] = buildProjectNodes({ sku: "E1M-AEN701", preset: "e1m-evk" });
  assert.deepEqual(
    project.children.map((child) => [child.label, child.description]),
    [
      ["SoM", "E1M-AEN701"],
      ["Preset", "e1m-evk"],
    ],
  );
});

test("buildProjectNodes renders an em dash for a missing preset", () => {
  const [project] = buildProjectNodes({ sku: "E1M-AEN701" });
  assert.deepEqual(
    project.children.map((child) => child.description),
    ["E1M-AEN701", "—"],
  );
});

test("buildProjectNodes wires actions to existing commands, Configure board first", () => {
  const roots = buildProjectNodes({ sku: "E1M-AEN701" });
  const actions = roots.find((node) => node.label === "Actions");
  const debug = roots.find((node) => node.label === "Debug");

  assert.deepEqual(
    actions.children.map((child) => [child.label, child.command]),
    [
      ["Configure board", "alp.openConfigurator"],
      ["Validate board.yaml", "alp.validateBoardYaml"],
      ["Generate all", "alp.generateAll"],
      ["West build", "alp.westBuild"],
      ["West flash", "alp.westFlash"],
    ],
  );
  assert.deepEqual(
    debug.children.map((child) => child.command),
    ["alp.debugDoctor", "alp.openDebugTroubleshootingPanel"],
  );
});
