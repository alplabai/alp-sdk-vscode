const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createLoaderPlan,
  getGenerationTargetSupport,
  listGenerationTargetSupport,
  resolveEmitModesForBoardYaml,
  summarizeLoaderBatch,
} = require("../packages/alp-core/dist/loader/service.js");

// The loader joins with the host path module (correct in production — these are
// real host paths). Normalize separators so the fixtures assert identically on
// POSIX and Windows.
const toPosix = (s) => s.split("\\").join("/");

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

  assert.equal(
    toPosix(plan.outputPath),
    "/workspace/app/build/generated/alp.conf",
  );
  assert.equal(
    toPosix(plan.scriptPath),
    "/workspace/sdk/scripts/alp_project.py",
  );
  assert.deepEqual(plan.args.map(toPosix), [
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

  assert.deepEqual(
    { written: summary.written.map(toPosix), failed: summary.failed },
    {
      written: ["build/generated/alp.conf"],
      failed: ["yocto-conf"],
    },
  );
});

test("listGenerationTargetSupport exposes all supported targets with preview metadata", () => {
  const targets = listGenerationTargetSupport();

  assert.deepEqual(
    targets.map((target) => target.emit),
    [
      "zephyr-conf",
      "dts-overlay",
      "native-sim-overlay",
      "cmake-args",
      "yocto-conf",
      "carrier-netlist",
    ],
  );
  assert.deepEqual(
    targets.map((target) => target.preview.languageId),
    ["properties", "dts", "dts", "plaintext", "properties", "json"],
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

// --- resolveEmitModesForBoardYaml ---

test("resolveEmitModesForBoardYaml: v1 zephyr board returns zephyr emit modes", () => {
  const yaml = "schema_version: 1\nboard_id: test\nos: zephyr\n";
  const modes = resolveEmitModesForBoardYaml(yaml);
  assert.deepEqual(modes.sort(), ["cmake-args", "dts-overlay", "zephyr-conf"]);
});

test("resolveEmitModesForBoardYaml: v1 yocto board returns only yocto-conf", () => {
  const yaml = "schema_version: 1\nboard_id: test\nos: yocto\n";
  const modes = resolveEmitModesForBoardYaml(yaml);
  assert.deepEqual(modes, ["yocto-conf"]);
});

test("resolveEmitModesForBoardYaml: v1 baremetal board returns only cmake-args", () => {
  const yaml = "schema_version: 1\nboard_id: test\nos: baremetal\n";
  const modes = resolveEmitModesForBoardYaml(yaml);
  assert.deepEqual(modes, ["cmake-args"]);
});

test("resolveEmitModesForBoardYaml: v2 zephyr-only board excludes yocto-conf", () => {
  const yaml = [
    "schema_version: 2",
    "board_id: test",
    "cores:",
    "  m33:",
    "    os: zephyr",
    "  m33_2:",
    "    os: zephyr",
  ].join("\n");
  const modes = resolveEmitModesForBoardYaml(yaml);
  assert.ok(
    !modes.includes("yocto-conf"),
    "yocto-conf should not be present for zephyr-only v2",
  );
  assert.ok(modes.includes("zephyr-conf"));
  assert.ok(modes.includes("dts-overlay"));
  assert.ok(modes.includes("cmake-args"));
});

test("resolveEmitModesForBoardYaml: v2 heterogeneous board includes both zephyr and yocto modes", () => {
  const yaml = [
    "schema_version: 2",
    "board_id: test",
    "cores:",
    "  a55:",
    "    os: yocto",
    "  m33:",
    "    os: zephyr",
  ].join("\n");
  const modes = resolveEmitModesForBoardYaml(yaml);
  assert.ok(modes.includes("zephyr-conf"));
  assert.ok(modes.includes("dts-overlay"));
  assert.ok(modes.includes("cmake-args"));
  assert.ok(modes.includes("yocto-conf"));
});

test("resolveEmitModesForBoardYaml: v2 board with off core excludes its OS", () => {
  const yaml = [
    "schema_version: 2",
    "board_id: test",
    "cores:",
    "  a55:",
    "    os: off",
    "  m33:",
    "    os: zephyr",
  ].join("\n");
  const modes = resolveEmitModesForBoardYaml(yaml);
  assert.ok(
    !modes.includes("yocto-conf"),
    "off core should not contribute any modes",
  );
  assert.ok(modes.includes("zephyr-conf"));
});
