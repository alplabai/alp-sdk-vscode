const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createLoaderPlan,
  getGenerationTargetSupport,
  listGenerationTargetSupport,
  summarizeLoaderBatch,
} = require("@alp-sdk/core/loader/service");

test("createLoaderPlan resolves output and command line", () => {
  const plan = createLoaderPlan(
    {
      workspaceRoot: "/workspace/app",
      sdkRoot: "/workspace/sdk",
      boardYamlPath: "/workspace/app/board.yaml",
      westCwd: "/workspace/app",
      pythonBinary: "python3",
    },
    "zephyr-conf",
  );

  assert.equal(plan.outputPath, "/workspace/app/build/generated/alp.conf");
  assert.equal(plan.scriptPath, "/workspace/sdk/scripts/alp_project.py");
  assert.deepEqual(plan.args, [
    "--input",
    "/workspace/app/board.yaml",
    "--emit",
    "zephyr-conf",
    "--output",
    "/workspace/app/build/generated/alp.conf",
  ]);
});

test("summarizeLoaderBatch separates written and failed outputs", () => {
  const summary = summarizeLoaderBatch("/workspace/app", [
    {
      emit: "zephyr-conf",
      outputPath: "/workspace/app/build/generated/alp.conf",
      exists: true,
      size: 10,
    },
    {
      emit: "yocto-conf",
      outputPath: "/workspace/app/build/generated/alp-yocto.conf",
      exists: false,
      size: 0,
    },
  ]);

  assert.deepEqual(summary, {
    written: ["build/generated/alp.conf"],
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
