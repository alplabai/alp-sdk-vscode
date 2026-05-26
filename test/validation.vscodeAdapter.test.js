const test = require("node:test");
const assert = require("node:assert/strict");

const {
  executeValidatorPlanWithSpawn,
} = require("@alp-sdk/core/validation/adapterCore");

test("executeValidatorPlanWithSpawn forwards command and normalizes output", () => {
  const calls = [];
  const result = executeValidatorPlanWithSpawn(
    {
      workspaceRoot: "/workspace/app",
      sdkRoot: "/workspace/sdk",
      boardYamlPath: "/workspace/app/board.yaml",
      westCwd: "/workspace/app",
      pythonBinary: "python3",
    },
    {
      inputPath: "/workspace/app/board.yaml",
      scriptPath: "/workspace/sdk/scripts/validate_board_yaml.py",
      args: ["--input", "/workspace/app/board.yaml"],
      commandLine: "python3 validate",
    },
    (command, args, options) => {
      calls.push({ command, args, options });
      return {
        status: 2,
        stdout: undefined,
        stderr: "warning text",
      };
    },
  );

  assert.deepEqual(calls, [
    {
      command: "python3",
      args: [
        "/workspace/sdk/scripts/validate_board_yaml.py",
        "--input",
        "/workspace/app/board.yaml",
      ],
      options: { encoding: "utf8" },
    },
  ]);
  assert.deepEqual(result, {
    status: 2,
    stdout: "",
    stderr: "warning text",
  });
});
