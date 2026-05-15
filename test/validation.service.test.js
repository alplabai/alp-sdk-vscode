const test = require("node:test");
const assert = require("node:assert/strict");

const {
  analyzeValidationResult,
  createValidatorPlan,
  isBoardYamlPath,
  validateBoardYamlLocally,
} = require("../packages/alp-core/dist/validation/service.js");

test("isBoardYamlPath matches board.yaml case-insensitively", () => {
  assert.equal(isBoardYamlPath("/tmp/board.yaml"), true);
  assert.equal(isBoardYamlPath("/tmp/BOARD.YAML"), true);
  assert.equal(isBoardYamlPath("/tmp/not-board.yml"), false);
});

test("createValidatorPlan builds the expected validator command", () => {
  const plan = createValidatorPlan(
    {
      workspaceRoot: "/workspace/app",
      sdkRoot: "/workspace/sdk",
      boardYamlPath: "/workspace/app/board.yaml",
      westCwd: "/workspace/app",
      pythonBinary: "python3",
    },
    "/workspace/app/board.yaml",
  );

  assert.equal(
    plan.scriptPath,
    "/workspace/sdk/scripts/validate_board_yaml.py",
  );
  assert.deepEqual(plan.args, ["--input", "/workspace/app/board.yaml"]);
  assert.match(plan.commandLine, /python3 .*validate_board_yaml.py --input/);
});

test("analyzeValidationResult classifies missing-preset warnings", () => {
  const result = analyzeValidationResult({
    status: 2,
    stdout: "",
    stderr: "FAIL som preset: missing preset\nsummary: missing-preset\n",
  });

  assert.equal(result.outcome, "missing-preset");
  assert.deepEqual(result.issues, [
    { message: "FAIL som preset: missing preset", severity: "warning" },
  ]);
});

test("analyzeValidationResult classifies hardware-revision failures", () => {
  const result = analyzeValidationResult({
    status: 3,
    stdout: "",
    stderr: "FAIL hw_rev: unsupported revision\nsummary: hardware-revision\n",
  });

  assert.equal(result.outcome, "hardware-revision");
  assert.deepEqual(result.issues, [
    { message: "FAIL hw_rev: unsupported revision", severity: "error" },
  ]);
});

test("analyzeValidationResult classifies hint lines as suggestions", () => {
  const result = analyzeValidationResult({
    status: 1,
    stdout: "",
    stderr:
      "FAIL schema_version: unsupported value\nHINT: set schema_version to 2\n",
  });

  assert.equal(result.outcome, "schema-violation");
  assert.deepEqual(result.issues, [
    { message: "FAIL schema_version: unsupported value", severity: "error" },
    { message: "HINT: set schema_version to 2", severity: "suggestion" },
  ]);
});

// --- validateBoardYamlLocally v2 structural pre-checks ---

const V1_ZEPHYR_YAML = `\
schema_version: 1
board_id: test-board
os: zephyr
`;

const V2_CLEAN_YAML = `\
schema_version: 2
board_id: test-v2-board
cores:
  m33:
    os: zephyr
`;

const V2_TOP_LEVEL_OS_YAML = `\
schema_version: 2
board_id: test-v2-board
os: zephyr
cores:
  m33:
    os: zephyr
`;

const V2_MISSING_CORES_YAML = `\
schema_version: 2
board_id: test-v2-board
`;

test("validateBoardYamlLocally: v1 board passes without errors", () => {
  const result = validateBoardYamlLocally(V1_ZEPHYR_YAML);
  assert.equal(result.outcome, "clean");
  assert.deepEqual(result.issues, []);
});

test("validateBoardYamlLocally: v2 clean board passes without errors", () => {
  const result = validateBoardYamlLocally(V2_CLEAN_YAML);
  assert.equal(result.outcome, "clean");
  assert.deepEqual(result.issues, []);
});

test("validateBoardYamlLocally: v2 with top-level os: returns schema-violation", () => {
  const result = validateBoardYamlLocally(V2_TOP_LEVEL_OS_YAML);
  assert.equal(result.outcome, "schema-violation");
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].severity, "error");
  assert.match(result.issues[0].message, /top-level 'os:' is not valid/);
});

test("validateBoardYamlLocally: v2 with no cores block returns schema-violation", () => {
  const result = validateBoardYamlLocally(V2_MISSING_CORES_YAML);
  assert.equal(result.outcome, "schema-violation");
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].severity, "error");
  assert.match(result.issues[0].message, /'cores:' block is required/);
});
