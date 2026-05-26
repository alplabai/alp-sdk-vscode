const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  createLoaderPlan,
  getGenerationTargetSupport,
  listGenerationTargetSupport,
  summarizeLoaderBatch,
} = require("@alp-sdk/core/loader/service");

test("createLoaderPlan resolves output and command line", () => {
  const workspaceRoot = "/workspace/app";
  const sdkRoot = "/workspace/sdk";
  const boardYamlPath = "/workspace/app/board.yaml";

  const plan = createLoaderPlan(
    {
      workspaceRoot,
      sdkRoot,
      boardYamlPath,
      westCwd: workspaceRoot,
      pythonBinary: "python3",
    },
    "zephyr-conf",
  );

  const expectedOutputPath = path.join(workspaceRoot, "build/generated/alp.conf");
  const expectedScriptPath = path.join(sdkRoot, "scripts", "alp_project.py");

  assert.equal(plan.outputPath, expectedOutputPath);
  assert.equal(plan.scriptPath, expectedScriptPath);
  assert.deepEqual(plan.args, [
    "--input",
    boardYamlPath,
    "--emit",
    "zephyr-conf",
    "--output",
    expectedOutputPath,
  ]);
});

test("summarizeLoaderBatch separates written and failed outputs", () => {
  const workspaceRoot = "/workspace/app";
  const outputPath = path.join(workspaceRoot, "build/generated/alp.conf");
  const failedOutputPath = path.join(workspaceRoot, "build/generated/alp-yocto.conf");

  const summary = summarizeLoaderBatch(workspaceRoot, [
    {
      emit: "zephyr-conf",
      outputPath,
      exists: true,
      size: 10,
    },
    {
      emit: "yocto-conf",
      outputPath: failedOutputPath,
      exists: false,
      size: 0,
    },
  ]);

  assert.deepEqual(summary, {
    written: [path.relative(workspaceRoot, outputPath)],
    failed: ["yocto-conf"],
  });
});

test("listGenerationTargetSupport exposes all supported targets with preview metadata", () => {
  const targets = listGenerationTargetSupport();

  assert.deepEqual(
    targets.map((target) => target.emit),
    ["zephyr-conf", "dts-overlay", "cmake-args", "yocto-conf"],
  );
  assert.deepEqual(
    targets.map((target) => target.preview.languageId),
    ["properties", "dts", "plaintext", "properties"],
  );
});

test("createLoaderPlan rejects unsupported generation targets", () => {
  assert.throws(
    () =>
      createLoaderPlan(
        {
          workspaceRoot: "/workspace/app",
          sdkRoot: "/workspace/sdk",
          boardYamlPath: "/workspace/app/board.yaml",
          westCwd: "/workspace/app",
          pythonBinary: "python3",
        },
        "invalid-target",
      ),
    /unsupported generation target/,
  );

  assert.throws(
    () => getGenerationTargetSupport("invalid-target"),
    /unsupported generation target/,
  );
});
