const test = require("node:test");
const assert = require("node:assert/strict");

const {
  analyzeValidationResult,
  createValidatorPlan,
  isBoardYamlPath,
} = require("@alp-sdk/core/validation/service");

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
      "FAIL schema_version: unsupported value\nHINT: set schema_version to 1\n",
  });

  assert.equal(result.outcome, "schema-violation");
  assert.deepEqual(result.issues, [
    { message: "FAIL schema_version: unsupported value", severity: "error" },
    { message: "HINT: set schema_version to 1", severity: "suggestion" },
  ]);
});
