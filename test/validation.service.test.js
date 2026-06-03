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
    { message: "som preset: missing preset", severity: "warning" },
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
    { message: "hw_rev: unsupported revision", severity: "error" },
  ]);
});

test("analyzeValidationResult classifies hint lines as suggestions", () => {
  const result = analyzeValidationResult({
    status: 1,
    stdout: "",
    stderr:
      "FAIL schema_version: unsupported value\nhint: set schema_version to 2\n",
  });

  assert.equal(result.outcome, "schema-violation");
  assert.deepEqual(result.issues, [
    { message: "schema_version: unsupported value", severity: "error" },
    { message: "hint: set schema_version to 2", severity: "suggestion" },
  ]);
});

test("analyzeValidationResult combines FAIL continuation lines", () => {
  const result = analyzeValidationResult({
    status: 2,
    stdout: "",
    stderr:
      "FAIL board: `preset: my-board` does not resolve\n" +
      "     expected shared definition at metadata/boards/my-board.yaml\n",
  });

  assert.equal(result.outcome, "missing-preset");
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /preset: my-board.*does not resolve/);
  assert.match(result.issues[0].message, /expected shared definition/);
});

test("analyzeValidationResult parses ALP-B* rich error block", () => {
  const stderr = [
    "error[ALP-B005]: SoM SKU 'E1M-NX9999' does not resolve to a known module",
    "  --> board.yaml:3:8",
    "   |",
    " 3 | som: {sku: E1M-NX9999}",
    "   |          ^^^^^^^^^^^^",
    "   = hint: did you mean E1M-NX9?",
    "   = see: docs/diagnostics/ALP-B005.md",
    "",
  ].join("\n");

  const result = analyzeValidationResult({ status: 2, stdout: "", stderr });

  assert.equal(result.outcome, "missing-preset");
  assert.equal(result.issues.length, 1);
  const issue = result.issues[0];
  assert.equal(issue.code, "ALP-B005");
  assert.equal(issue.severity, "error");
  assert.equal(issue.line, 3);
  assert.equal(issue.col, 8);
  assert.match(issue.message, /SoM SKU.*E1M-NX9999/);
});

test("analyzeValidationResult parses ALP-B* warning block", () => {
  const stderr = [
    "warning[ALP-B010]: peripheral 'ethernet' not found in SoC capability table",
    "  --> board.yaml:10:5",
    "   |",
    "10 | peripherals: [ethernet]",
    "   |               ^^^^^^^^",
    "   = hint: check soc JSON or use board-side wiring",
    "",
  ].join("\n");

  const result = analyzeValidationResult({ status: 0, stdout: "", stderr });

  assert.equal(result.outcome, "clean");
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "ALP-B010");
  assert.equal(result.issues[0].severity, "warning");
  assert.equal(result.issues[0].line, 10);
});

test("analyzeValidationResult WARN lines become warnings", () => {
  const result = analyzeValidationResult({
    status: 0,
    stdout: "",
    stderr: "WARN hw_compat: minor version mismatch\n",
  });

  assert.equal(result.outcome, "clean");
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].severity, "warning");
  assert.equal(result.issues[0].message, "hw_compat: minor version mismatch");
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
