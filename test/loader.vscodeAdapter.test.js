const test = require("node:test");
const assert = require("node:assert/strict");

const {
  boardYamlExistsWithDependencies,
  executeLoaderPlanWithSpawn,
  inspectGeneratedFileWithDependencies,
} = require("../packages/alp-core/dist/loader/adapterCore.js");

function createLoaderPlan(overrides = {}) {
  return {
    emit: "zephyr-conf",
    outputPath: "/workspace/app/build/generated/alp.conf",
    scriptPath: "/workspace/sdk/scripts/alp_project.py",
    args: [
      "--input",
      "/workspace/app/board.yaml",
      "--emit",
      "zephyr-conf",
      "--output",
      "/workspace/app/build/generated/alp.conf",
    ],
    commandLine:
      "python3 /workspace/sdk/scripts/alp_project.py --input /workspace/app/board.yaml --emit zephyr-conf --output /workspace/app/build/generated/alp.conf",
    ...overrides,
  };
}

test("boardYamlExistsWithDependencies returns false for an unset path", () => {
  assert.equal(
    boardYamlExistsWithDependencies(null, () => {
      throw new Error("should not be called");
    }),
    false,
  );
});

test("executeLoaderPlanWithSpawn forwards command and normalizes output", () => {
  const calls = [];
  const result = executeLoaderPlanWithSpawn(
    "python3",
    createLoaderPlan(),
    (command, args, options) => {
      calls.push({ command, args, options });
      return {
        status: 1,
        stdout: undefined,
        stderr: "generation failed",
      };
    },
  );

  assert.deepEqual(calls, [
    {
      command: "python3",
      args: [
        "/workspace/sdk/scripts/alp_project.py",
        "--input",
        "/workspace/app/board.yaml",
        "--emit",
        "zephyr-conf",
        "--output",
        "/workspace/app/build/generated/alp.conf",
      ],
      options: { encoding: "utf8" },
    },
  ]);
  assert.deepEqual(result, {
    status: 1,
    stdout: "",
    stderr: "generation failed",
  });
});

test("inspectGeneratedFileWithDependencies reports missing output", () => {
  const entry = inspectGeneratedFileWithDependencies(createLoaderPlan(), {
    existsSync: () => false,
    statSync: () => {
      throw new Error("should not be called");
    },
  });

  assert.deepEqual(entry, {
    emit: "zephyr-conf",
    outputPath: "/workspace/app/build/generated/alp.conf",
    exists: false,
    size: 0,
  });
});

test("inspectGeneratedFileWithDependencies reports output size", () => {
  const entry = inspectGeneratedFileWithDependencies(createLoaderPlan(), {
    existsSync: () => true,
    statSync: () => ({ size: 128 }),
  });

  assert.deepEqual(entry, {
    emit: "zephyr-conf",
    outputPath: "/workspace/app/build/generated/alp.conf",
    exists: true,
    size: 128,
  });
});
