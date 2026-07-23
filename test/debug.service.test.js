const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDebugPreflightReport,
  buildDoctorReport,
  createDebugProfile,
  createGenerationTraceReport,
  createInspectReport,
  createLaunchPreview,
  createSupportBundlePayload,
  serializeGenerationTraceReport,
  serializeInspectReport,
  serializeSupportBundlePayload,
  serverChoicesForTarget,
} = require("../packages/alp-core/dist/debug/service.js");

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

test("createDebugProfile defines reusable profile metadata", () => {
  const zephyr = createDebugProfile("zephyr-mcu", "openocd");
  const baremetal = createDebugProfile("baremetal-mcu", "jlink");
  const yocto = createDebugProfile("yocto-userspace", "gdbserver");
  const host = createDebugProfile("native-host", "none");

  assert.equal(zephyr.adapter, "cortex-debug");
  assert.equal(zephyr.os, "zephyr");
  assert.deepEqual(zephyr.openOcdConfigFiles, ["<resolved-openocd-board-cfg>"]);

  assert.equal(baremetal.adapter, "cortex-debug");
  assert.equal(baremetal.os, "baremetal");
  assert.equal(baremetal.interface, "swd");

  assert.equal(yocto.adapter, "cppdbg");
  assert.equal(yocto.server, "gdbserver");
  assert.equal(yocto.miMode, "gdb");

  assert.equal(host.adapter, "codelldb");
  assert.equal(host.os, "host");
});

test("createDebugProfile derives the per-core path from a manifest slice", () => {
  // A heterogeneous Zephyr slice: build_dir set, not yet built.
  const slice = {
    core_id: "m55_hp",
    os: "zephyr",
    build_dir: "build/m55_hp-zephyr",
    status: "pending",
  };
  const profile = createDebugProfile("zephyr-mcu", "openocd", slice);
  assert.equal(
    profile.executablePath,
    "${workspaceFolder}/build/m55_hp-zephyr/zephyr/zephyr.elf",
  );

  // A built slice: prefer its actual output_artefact.
  const built = {
    ...slice,
    output_artefact: "build/m55_hp-zephyr/zephyr/zephyr.elf",
    status: "ok",
  };
  assert.equal(
    createDebugProfile("zephyr-mcu", "jlink", built).executablePath,
    "${workspaceFolder}/build/m55_hp-zephyr/zephyr/zephyr.elf",
  );

  // No slice → the generic single-core default is unchanged.
  assert.equal(
    createDebugProfile("zephyr-mcu", "openocd").executablePath,
    "${workspaceFolder}/build/app/zephyr/zephyr.elf",
  );

  // A slice with no build_dir/output_artefact also falls back.
  assert.equal(
    createDebugProfile("baremetal-mcu", "jlink", {
      core_id: "m33",
      os: "baremetal",
      status: "pending",
    }).executablePath,
    "${workspaceFolder}/build/baremetal/app.elf",
  );
});

test("createInspectReport returns a copy of the workspace context", () => {
  const context = createDebugContext();
  const report = createInspectReport(context);

  assert.equal(report.schemaVersion, "1");
  assert.equal(report.generatedAt, context.generatedAt);
  assert.deepEqual(report.context, context);
  assert.notEqual(report.context, context);
  assert.ok(
    report.resolvedValues.some(
      (value) => value.key === "workspaceRoot" && value.source === "workspace",
    ),
  );
});

test("inspect and trace reports serialize as stable JSON payloads", () => {
  const inspect = createInspectReport(createDebugContext());
  const trace = createGenerationTraceReport(
    "2026-05-14T00:00:00.000Z",
    "loader.generateAll",
    [
      {
        key: "zephyr-conf",
        outputPath: "/workspace/app/build/generated/alp.conf",
        outcome: "written",
        detail: "Generated artifact exists with non-zero size.",
      },
      {
        key: "yocto-conf",
        outputPath: "/workspace/app/build/generated/alp-yocto.conf",
        outcome: "failed",
        detail: "Generated artifact missing or empty.",
      },
    ],
  );

  const inspectSerialized = JSON.parse(serializeInspectReport(inspect));
  const traceSerialized = JSON.parse(serializeGenerationTraceReport(trace));

  assert.equal(inspectSerialized.schemaVersion, "1");
  assert.equal(inspectSerialized.context.pythonBinary, "python3");
  assert.equal(traceSerialized.schemaVersion, "1");
  assert.equal(traceSerialized.workflow, "loader.generateAll");
  assert.equal(traceSerialized.decisions.length, 2);
  assert.equal(traceSerialized.decisions[1].outcome, "failed");
});

test("createSupportBundlePayload composes inspect and trace reports", () => {
  const inspect = createInspectReport(createDebugContext());
  const trace = createGenerationTraceReport(
    "2026-05-14T00:00:00.000Z",
    "loader.generateAll",
    [],
  );

  const bundle = createSupportBundlePayload({
    generatedAt: "2026-05-14T00:00:00.000Z",
    inspect,
    trace,
    notes: ["sample-note"],
  });

  assert.equal(bundle.schemaVersion, "1");
  assert.equal(bundle.inspect.schemaVersion, "1");
  assert.equal(bundle.trace?.workflow, "loader.generateAll");
  assert.deepEqual(bundle.notes, ["sample-note"]);
});

test("buildDebugPreflightReport fails for unresolved profile placeholders", () => {
  const profile = createDebugProfile("zephyr-mcu", "jlink");
  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    profile,
    createRuntime(),
    {
      pathExists: () => false,
    },
  );

  assert.equal(report.canLaunch, false);
  assert.ok(report.summary.fail > 0);
  assert.ok(
    report.checks.some(
      (check) => check.name === "buildArtifact" && check.status === "fail",
    ),
  );
  assert.ok(
    report.checks.some(
      (check) => check.name === "device" && check.status === "fail",
    ),
  );
});

test("buildDebugPreflightReport can pass for resolved native-host profile", () => {
  const profile = {
    ...createDebugProfile("native-host", "none"),
    executablePath: "${workspaceFolder}/build/native_sim/zephyr/zephyr.exe",
  };
  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    profile,
    createRuntime(),
    {
      // filePath is toPosix'd at the source (resolveWorkspacePath in
      // debug/service.ts), so this asserts a POSIX suffix directly.
      pathExists: (filePath) =>
        filePath.endsWith("build/native_sim/zephyr/zephyr.exe"),
    },
  );

  assert.equal(report.canLaunch, true);
  assert.equal(report.summary.fail, 0);
});

test("serializeSupportBundlePayload returns stable JSON", () => {
  const inspect = createInspectReport(createDebugContext());
  const preflight = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    createDebugProfile("native-host", "none"),
    createRuntime(),
    {
      pathExists: () => false,
    },
  );
  const bundle = createSupportBundlePayload({
    generatedAt: "2026-05-14T00:00:00.000Z",
    inspect,
    preflight,
    notes: ["preflight"],
  });

  const serialized = JSON.parse(serializeSupportBundlePayload(bundle));
  assert.equal(serialized.schemaVersion, "1");
  assert.equal(serialized.preflight.targetKind, "native-host");
  assert.deepEqual(serialized.notes, ["preflight"]);
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

test("createLaunchPreview generates a Zephyr OpenOCD draft", () => {
  const preview = createLaunchPreview(
    "2026-05-14T00:00:00.000Z",
    "zephyr-mcu",
    "openocd",
  );

  const config = preview.launch.configurations[0];
  assert.equal(config.type, "cortex-debug");
  assert.equal(config.servertype, "openocd");
  assert.deepEqual(config.configFiles, ["<resolved-openocd-board-cfg>"]);
});

test("createLaunchPreview generates a baremetal draft", () => {
  const preview = createLaunchPreview(
    "2026-05-14T00:00:00.000Z",
    "baremetal-mcu",
    "jlink",
  );

  const config = preview.launch.configurations[0];
  assert.equal(config.type, "cortex-debug");
  assert.equal(config.servertype, "jlink");
  assert.equal(config.executable, "${workspaceFolder}/build/baremetal/app.elf");
});

test("createLaunchPreview generates a Yocto gdbserver draft", () => {
  const preview = createLaunchPreview(
    "2026-05-14T00:00:00.000Z",
    "yocto-userspace",
    "gdbserver",
  );

  const config = preview.launch.configurations[0];
  assert.equal(config.type, "cppdbg");
  assert.equal(config.MIMode, "gdb");
  assert.equal(config.miDebuggerServerAddress, "<host>:<port>");
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
