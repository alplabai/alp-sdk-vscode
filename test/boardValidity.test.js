const test = require("node:test");
const assert = require("node:assert");
const { deriveBoardValidity } = require("../out/ideHub/boardValidity.js");

test("valid v2 board (has cores:) is clean", () => {
  const yaml = `
schema_version: 2
cores:
  main:
    os: zephyr
`;
  assert.deepEqual(deriveBoardValidity(yaml), {
    boardYamlValid: true,
    boardIssueCount: 0,
  });
});

test("invalid v2 board (no cores:) reports issues", () => {
  const yaml = `
schema_version: 2
os: zephyr
`;
  const result = deriveBoardValidity(yaml);
  assert.equal(result.boardYamlValid, false);
  assert.ok(result.boardIssueCount >= 1);
});

test("malformed YAML does not throw", () => {
  const yaml = "cores: [this is not: valid: yaml: at: all";
  assert.doesNotThrow(() => deriveBoardValidity(yaml));
  const result = deriveBoardValidity(yaml);
  assert.equal(result.boardYamlValid, false);
});
