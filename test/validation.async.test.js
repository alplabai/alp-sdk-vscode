// SPDX-License-Identifier: Apache-2.0

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  executeValidatorPlanAsync,
} = require("../packages/alp-core/dist/validation/adapterCore.js");

const CONTEXT = {
  pythonBinary: "/usr/bin/python3",
  boardYamlPath: "board.yaml",
  sdkRoot: "/sdk",
  westCwd: "/ws",
};
const PLAN = {
  scriptPath: "/sdk/scripts/validate_board_yaml.py",
  args: ["board.yaml", "--format", "json"],
  commandLine: "python validate_board_yaml.py board.yaml --format json",
};

test("executeValidatorPlanAsync forwards the python binary, script, and args", async () => {
  const calls = [];
  const spawnAsync = async (command, args) => {
    calls.push({ command, args });
    return { status: 0, stdout: "ok", stderr: "" };
  };

  const result = await executeValidatorPlanAsync(CONTEXT, PLAN, spawnAsync);

  assert.deepEqual(calls, [
    {
      command: "/usr/bin/python3",
      args: [
        "/sdk/scripts/validate_board_yaml.py",
        "board.yaml",
        "--format",
        "json",
      ],
    },
  ]);
  assert.deepEqual(result, { status: 0, stdout: "ok", stderr: "" });
});

test("executeValidatorPlanAsync normalizes null/absent stdout+stderr to empty strings", async () => {
  const spawnAsync = async () => ({ status: null });
  const result = await executeValidatorPlanAsync(CONTEXT, PLAN, spawnAsync);
  assert.deepEqual(result, { status: null, stdout: "", stderr: "" });
});

test("executeValidatorPlanAsync surfaces a nonzero validator status verbatim", async () => {
  const spawnAsync = async () => ({
    status: 2,
    stdout: "",
    stderr: "FAIL: som.sku is required",
  });
  const result = await executeValidatorPlanAsync(CONTEXT, PLAN, spawnAsync);
  assert.equal(result.status, 2);
  assert.equal(result.stderr, "FAIL: som.sku is required");
});
