const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDoctorReport,
  createInspectReport,
  createLaunchPreview,
  serverChoicesForTarget,
} = require("../out/debug/service.js");

function createDebugContext(overrides = {}) {
  return {
    generatedAt: "2026-05-14T00:00:00.000Z",
    workspaceRoot: "/workspace/app",
    sdkRoot: "/workspace/sdk",
    boardYamlPath: "/workspace/app/board.yaml",
    boardYamlExists: true,
    westCwd: "/workspace/app",
    pythonBinary: "python3",
    debuggerExtensions: {
      cortexDebug: true,
      cppTools: true,
      codeLLDB: true,
    },
    ...overrides,
  };
}

function createRuntime(overrides = {}) {
  return {
    pythonAvailable: true,
    jlinkExecutable: "/usr/bin/JLinkGDBServerCL",
    openOcdExecutable: "/usr/bin/openocd",
    pyocdExecutable: "/usr/bin/pyocd",
    gdbExecutable: "/usr/bin/gdb",
    lldbExecutable: "/usr/bin/lldb",
    ...overrides,
  };
}

test("serverChoicesForTarget returns expected backends", () => {
  assert.deepEqual(
    serverChoicesForTarget("zephyr-mcu").map((choice) => choice.server),
    ["jlink", "openocd", "pyocd"],
  );
  assert.deepEqual(
    serverChoicesForTarget("yocto-userspace").map((choice) => choice.server),
    ["gdbserver"],
  );
  assert.deepEqual(
    serverChoicesForTarget("native-host").map((choice) => choice.server),
    ["none"],
  );
});

test("createInspectReport returns a copy of the workspace context", () => {
  const context = createDebugContext();
  const report = createInspectReport(context);

  assert.deepEqual(report, context);
  assert.notEqual(report, context);
});

test("buildDoctorReport flags unsupported backends clearly", () => {
  const report = buildDoctorReport(
    createDebugContext(),
    { targetKind: "native-host", server: "jlink" },
    createRuntime(),
  );

  assert.equal(report.summary.fail, 1);
  assert.equal(report.checks.at(-1).name, "serverCompatibility");
  assert.match(report.checks.at(-1).detail, /not supported/);
  assert.deepEqual(report.nextSteps, [
    "Pick a supported backend for the selected target class.",
  ]);
});

test("buildDoctorReport summarizes zephyr doctor state", () => {
  const report = buildDoctorReport(
    createDebugContext({
      debuggerExtensions: {
        cortexDebug: false,
        cppTools: true,
        codeLLDB: true,
      },
    }),
    { targetKind: "zephyr-mcu", server: "openocd" },
    createRuntime({ pythonAvailable: false, openOcdExecutable: null }),
  );

  assert.equal(report.targetKind, "zephyr-mcu");
  assert.equal(report.server, "openocd");
  assert.equal(report.summary.pass, 3);
  assert.equal(report.summary.warn, 2);
  assert.equal(report.summary.fail, 1);
  assert.deepEqual(report.nextSteps, [
    "Install the configured Python interpreter or update alpSdk.pythonPath.",
    "Install marus25.cortex-debug.",
    "Install openocd and make sure it is on PATH.",
  ]);
});

test("createLaunchPreview generates a Zephyr J-Link draft", () => {
  const preview = createLaunchPreview(
    "2026-05-14T00:00:00.000Z",
    "zephyr-mcu",
    "jlink",
  );

  assert.equal(preview.launch.version, "0.2.0");
  assert.equal(preview.launch.configurations.length, 1);
  const config = preview.launch.configurations[0];
  assert.equal(config.type, "cortex-debug");
  assert.equal(config.servertype, "jlink");
  assert.equal(config.interface, "swd");
  assert.match(config.name, /Zephyr Debug/);
});

test("createLaunchPreview generates a native host draft", () => {
  const preview = createLaunchPreview(
    "2026-05-14T00:00:00.000Z",
    "native-host",
    "none",
  );

  const config = preview.launch.configurations[0];
  assert.equal(config.type, "codelldb");
  assert.equal(
    config.program,
    "${workspaceFolder}/build/native_sim/zephyr/zephyr.exe",
  );
});

test("createLaunchPreview rejects unsupported launch combinations", () => {
  assert.throws(
    () =>
      createLaunchPreview("2026-05-14T00:00:00.000Z", "native-host", "jlink"),
    /Unsupported debug backend/,
  );
});
