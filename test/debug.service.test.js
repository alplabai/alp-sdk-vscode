const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEBUG_TARGET_CHOICES,
  buildDebugPreflightReport,
  buildDoctorReport,
  createDebugProfile,
  createGenerationTraceReport,
  createInspectReport,
  createSupportBundlePayload,
  foldLaunchConfigPlaceholders,
  isNativeHostTarget,
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

test("isNativeHostTarget: true for native-host, false for on-target profiles", () => {
  assert.equal(isNativeHostTarget("native-host"), true);
  assert.equal(isNativeHostTarget("zephyr-mcu"), false);
  assert.equal(isNativeHostTarget("baremetal-mcu"), false);
  assert.equal(isNativeHostTarget("yocto-userspace"), false);
});

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

// Every preflight check that graded a configuration value. None of them may
// come back: those values are tan's to resolve from runners.yaml and the
// fold's to grade, and a check here would be a second derivation of the same
// value. Five are named after the launch.json key itself; `openOcdConfig` is
// not — the key tan writes is `configFiles`, and the check was named after the
// server. Either name reappearing means the draft is back.
const CONFIGURATION_KEY_CHECKS = [
  "device",
  "targetId",
  "openOcdConfig",
  "svdFile",
  "miDebuggerPath",
  "miDebuggerServerAddress",
];

// #339. The report grades HOST readiness only. It used to also grade a
// `createDebugProfile` draft whose `device` was the hardcoded literal
// "<resolved-device>" -- so a zephyr-mcu/jlink preflight failed on `device` for
// every project on earth, including one whose launch.json tan had fully
// resolved from the build's runners.yaml. `buildArtifact` still fails here,
// because whether the ELF exists is a host fact and genuinely the extension's.
test("buildDebugPreflightReport grades host readiness, never a drafted configuration", () => {
  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    createDebugProfile("zephyr-mcu", "jlink"),
    createRuntime(),
    {
      pathExists: () => false,
    },
  );

  assert.equal(report.canLaunch, false);
  assert.ok(
    report.checks.some(
      (check) => check.name === "buildArtifact" && check.status === "fail",
    ),
  );
  for (const name of CONFIGURATION_KEY_CHECKS) {
    assert.equal(
      report.checks.some((check) => check.name === name),
      false,
      `preflight still grades the drafted ${name}`,
    );
  }
  // And the profile must not carry the value either -- if it did, someone would
  // grade it again.
  assert.equal(createDebugProfile("zephyr-mcu", "jlink").device, undefined);
  assert.equal(createDebugProfile("zephyr-mcu", "pyocd").targetId, undefined);
  assert.equal(
    createDebugProfile("zephyr-mcu", "openocd").openOcdConfigFiles,
    undefined,
  );
  assert.equal(createDebugProfile("baremetal-mcu", "jlink").svdFile, undefined);
  assert.equal(
    createDebugProfile("yocto-userspace", "gdbserver").miDebuggerPath,
    undefined,
  );
  // `cwd`, `name` and `os` were the ones the sweep missed: launch.json keys (or,
  // for `os`, a fifth spelling of `targetKind`), constant per target, and read
  // by nothing. `name` mattered most -- it said "Alp: Zephyr Debug (J-Link)"
  // while the pinned tan 0.4.0 writes "ALP: Zephyr Debug (J-Link)", so it was
  // already drifted from tan's merge key. The spellings live in
  // src/debug/service.ts's ALP_PREFIX, read off the customer's own file; a
  // second copy here is what the orphan rescue exists to repair.
  const profile = createDebugProfile("zephyr-mcu", "jlink");
  assert.equal(profile.cwd, undefined);
  assert.equal(profile.name, undefined);
  assert.equal(profile.os, undefined);
  assert.deepEqual(Object.keys(profile).sort(), [
    "adapter",
    "executablePath",
    "id",
    "server",
    "targetKind",
  ]);
});

// #339 residual, stated where it is consumed. This report never reads the
// written launch.json, so `canLaunch: true` here means "the host is ready" and
// not "this file launches". The support bundle is why that matters: a customer
// exports one AFTER a session has failed, and a bundle asserting the profile is
// launchable sends its reader away from the placeholder that killed it. The
// flag is what tells the two apart -- false out of the builder, true only once
// the fold has read a configuration.
test("a preflight report says whether it read the configuration", () => {
  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    createDebugProfile("zephyr-mcu", "jlink"),
    createRuntime(),
    { pathExists: () => true },
  );

  // The dangerous combination, and the one the bundle used to print bare.
  assert.equal(report.canLaunch, true);
  assert.equal(report.configurationGraded, false);

  // A fully resolved configuration: no new check, but it WAS read.
  const clean = foldLaunchConfigPlaceholders(report, []);
  assert.equal(clean.configurationGraded, true);
  assert.deepEqual(clean.checks, report.checks);
  assert.equal(clean.canLaunch, true);

  // An unresolved one: read, and failing.
  const folded = foldLaunchConfigPlaceholders(report, [
    { key: "device", value: "<resolved-device>" },
  ]);
  assert.equal(folded.configurationGraded, true);
  assert.equal(folded.canLaunch, false);
});

// The defect of #339 in one assertion. With the host ready and the ELF built,
// every zephyr-mcu backend must report launchable, because `tan debug-config`
// resolves device / configFiles / targetId / gdbPath out of the build's own
// runners.yaml. Before this, all three failed on the draft -- jlink on
// `device`, openocd on `openOcdConfig`, pyocd on `targetId` -- and F5 sat
// behind a "Start Anyway" click on a launch.json that ran as-is.
//
// `warn` is pinned to 0 for a FORWARD-looking reason, not a past one. The old
// constant `svdFile` warn never opened the output channel by itself: `Alp:
// Debug preflight` opens it on `!report.canLaunch || report.summary.warn > 0`
// and the left half was already true on every cortex-debug target -- which is
// the only adapter the check was ever added for. Now that a resolved preflight
// reports canLaunch true, a surviving constant warn WOULD be the sole reason
// the channel is forced open, on every run, so 0 is the assertion that keeps
// it out.
test("a host-ready zephyr-mcu preflight can launch on every backend", () => {
  for (const { server } of serverChoicesForTarget("zephyr-mcu")) {
    const report = buildDebugPreflightReport(
      "2026-05-14T00:00:00.000Z",
      createDebugContext(),
      createDebugProfile("zephyr-mcu", server),
      createRuntime(),
      { pathExists: () => true },
    );
    assert.equal(report.canLaunch, true, server);
    assert.equal(report.summary.fail, 0, server);
    assert.equal(report.summary.warn, 0, server);
    assert.deepEqual(report.nextSteps, [], server);
  }
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

// The stock machine, not the CI container: vadimcn.vscode-lldb v1.12.2 SHIPS
// its own LLDB (lldb/bin/lldb.exe, liblldb.dll, lldb-server.exe inside the
// extension) and never consults PATH, so a Windows or macOS box normally has no
// `lldb` and no `lldb-dap` -- and does not need one. Probing for it put F5 on
// "Alp: Native Sim Debug" behind a Start Anyway click, on native_sim: the one
// target needing neither probe nor board, and so the first debug session a
// customer ever runs.
//
// createRuntime() hardcodes lldbExecutable, which is exactly why the suite hid
// this. Overriding it is the whole test.
test("native-host launches with no lldb on PATH", () => {
  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    createDebugProfile("native-host", "none"),
    createRuntime({ lldbExecutable: null }),
    { pathExists: () => true },
  );

  assert.equal(report.canLaunch, true);
  assert.equal(report.summary.fail, 0);
  assert.deepEqual(report.nextSteps, []);

  const serverTool = report.checks.find((check) => check.name === "serverTool");
  assert.equal(serverTool.status, "pass");
  assert.equal(serverTool.fix, undefined);

  // Doctor has to agree with preflight on the same fact, or the customer is
  // told to install something preflight just said was unnecessary.
  const doctor = buildDoctorReport(
    createDebugContext(),
    { targetKind: "native-host", server: "none" },
    createRuntime({ lldbExecutable: null }),
  );
  assert.deepEqual(doctor.nextSteps, []);
  assert.equal(doctor.summary.fail, 0);
  assert.equal(doctor.summary.warn, 0);

  // "none" is the native-host "there is no debug server" marker, not a tool
  // name. Interpolated as one it rendered "No none executable was found on
  // PATH." and "Install none and make sure it is on PATH." straight into the
  // customer toast. Nothing customer-facing here may contain the word at all --
  // if some future wording needs it, reword the wording.
  const emitted = [
    ...report.checks.flatMap((check) => [check.detail, check.fix]),
    ...report.nextSteps,
  ].filter(Boolean);
  for (const text of emitted) {
    assert.ok(
      !/\bnone\b/i.test(text),
      `preflight rendered "none" as a tool name: ${text}`,
    );
  }
});

// native_sim is a POSIX-architecture board -- Zephyr's board docs say it builds
// "a normal Linux executable" -- and the profile launches it with CodeLLDB in
// THIS extension host. On Windows that cannot work at any step: the Zephyr build
// emits no Windows binary, and one built under WSL is a Linux ELF a Windows-side
// CodeLLDB cannot launch. Before this check, "Native host" was offered
// unconditionally, wrote a launch config, and F5 died with nothing explaining
// why -- on the one target that needs neither probe nor board, i.e. the first
// debug session a customer ever runs.
const NATIVE_HOST_WIN32_DETAIL =
  "native_sim builds a Linux executable, so it cannot run on this Windows host.";
const NATIVE_HOST_WIN32_FIX =
  "Reopen the folder in WSL, or build and debug native_sim on a Linux or macOS host.";

test("native-host preflight blocks on a win32 host and names the WSL way out", () => {
  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    createDebugProfile("native-host", "none"),
    createRuntime({ hostPlatform: "win32" }),
    // Everything else healthy, so the host OS is the only thing left to fail.
    { pathExists: () => true },
  );

  const check = report.checks.find((entry) => entry.name === "hostPlatform");
  assert.ok(check, "no hostPlatform check on a win32 native-host preflight");
  // Blocking, not advisory: nothing the customer installs on Windows clears it,
  // so a warn would leave canLaunch true and F5 still reaching the dead end.
  assert.equal(check.status, "fail");
  assert.equal(check.detail, NATIVE_HOST_WIN32_DETAIL);
  assert.equal(check.fix, NATIVE_HOST_WIN32_FIX);
  assert.equal(report.canLaunch, false);
  assert.ok(report.summary.fail > 0);
  // nextSteps is what the surface interpolates, so the remedy has to arrive
  // there and not just sit in the per-check detail.
  assert.ok(report.nextSteps.includes(NATIVE_HOST_WIN32_FIX));

  // The message contract in src/notify/models.ts: no errno, no absolute path,
  // no internal check id in anything a customer reads.
  for (const text of [check.detail, check.fix]) {
    assert.ok(!/[\\/]/.test(text), `leaks a path: ${text}`);
    assert.ok(!/\bE[A-Z]{3,}\b/.test(text), `leaks an errno: ${text}`);
    assert.ok(!/hostPlatform/.test(text), `leaks the check id: ${text}`);
  }
});

test("native-host doctor blocks on a win32 host with the same sentence", () => {
  const report = buildDoctorReport(
    createDebugContext(),
    { targetKind: "native-host", server: "none" },
    createRuntime({ hostPlatform: "win32" }),
  );

  const check = report.checks.find((entry) => entry.name === "hostPlatform");
  assert.ok(check, "no hostPlatform check on a win32 native-host doctor run");
  assert.equal(check.status, "fail");
  assert.equal(check.detail, NATIVE_HOST_WIN32_DETAIL);
  assert.equal(check.fix, NATIVE_HOST_WIN32_FIX);
  assert.equal(report.summary.fail, 1);
  assert.ok(report.nextSteps.includes(NATIVE_HOST_WIN32_FIX));
});

test("native-host is unaffected on linux, darwin and an unreported host", () => {
  for (const hostPlatform of ["linux", "darwin", undefined]) {
    const where = `hostPlatform=${hostPlatform}`;
    const preflight = buildDebugPreflightReport(
      "2026-05-14T00:00:00.000Z",
      createDebugContext(),
      createDebugProfile("native-host", "none"),
      createRuntime({ hostPlatform }),
      { pathExists: () => true },
    );
    assert.equal(
      preflight.checks.some((entry) => entry.name === "hostPlatform"),
      false,
      where,
    );
    assert.equal(preflight.canLaunch, true, where);
    assert.deepEqual(preflight.nextSteps, [], where);

    const doctor = buildDoctorReport(
      createDebugContext(),
      { targetKind: "native-host", server: "none" },
      createRuntime({ hostPlatform }),
    );
    assert.equal(
      doctor.checks.some((entry) => entry.name === "hostPlatform"),
      false,
      where,
    );
    assert.equal(doctor.summary.fail, 0, where);
  }
});

// The gate is native_sim's POSIX architecture, not "Windows is bad at
// debugging": every other target class debugs over a probe or a remote
// gdbserver and is perfectly launchable from Windows. A check that fired on
// them would break real on-target debugging for the primary customer.
test("no other debug target gains a host-OS check on win32", () => {
  for (const { targetKind } of DEBUG_TARGET_CHOICES) {
    if (targetKind === "native-host") continue;
    for (const { server } of serverChoicesForTarget(targetKind)) {
      const where = `${targetKind}/${server}`;
      const preflight = buildDebugPreflightReport(
        "2026-05-14T00:00:00.000Z",
        createDebugContext(),
        createDebugProfile(targetKind, server),
        createRuntime({ hostPlatform: "win32" }),
        { pathExists: () => true },
      );
      assert.equal(
        preflight.checks.some((entry) => entry.name === "hostPlatform"),
        false,
        where,
      );

      const doctor = buildDoctorReport(
        createDebugContext(),
        { targetKind, server },
        createRuntime({ hostPlatform: "win32" }),
      );
      assert.equal(
        doctor.checks.some((entry) => entry.name === "hostPlatform"),
        false,
        where,
      );
      assert.equal(
        doctor.nextSteps.includes(NATIVE_HOST_WIN32_FIX),
        false,
        where,
      );
    }
  }
});

// The OpenOCD board cfg still blocks a launch when it is unresolved -- OpenOCD
// takes "<resolved-openocd-board-cfg>" as a literal filename and fails to open
// it. What moved is WHERE that is decided: off the extension's own draft, which
// could only ever hold the placeholder, and onto the configuration tan wrote.
test("an unresolved OpenOCD board cfg in the WRITTEN configuration blocks the launch", () => {
  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    createDebugProfile("zephyr-mcu", "openocd"),
    createRuntime(),
    { pathExists: () => true },
  );
  assert.equal(report.canLaunch, true);

  const folded = foldLaunchConfigPlaceholders(report, [
    { key: "configFiles[0]", value: "<resolved-openocd-board-cfg>" },
  ]);
  assert.equal(folded.canLaunch, false);
  const openOcd = folded.checks.find(
    (check) => check.name === "configFiles[0]",
  );
  assert.equal(openOcd.status, "fail");
  assert.match(openOcd.detail, /<resolved-openocd-board-cfg>/);
});

test("foldLaunchConfigPlaceholders adds no check when there are no placeholders", () => {
  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    {
      ...createDebugProfile("native-host", "none"),
      executablePath: "${workspaceFolder}/build/native_sim/zephyr/zephyr.exe",
    },
    createRuntime(),
    {
      pathExists: (filePath) =>
        filePath.endsWith("build/native_sim/zephyr/zephyr.exe"),
    },
  );

  const folded = foldLaunchConfigPlaceholders(report, []);
  // Everything a surface renders is identical -- a fully resolved configuration
  // must not gain a check, or the first-blink path is back behind a Start
  // Anyway click. Only `configurationGraded` moves, and it says the
  // configuration was READ, not that it was faulty.
  assert.deepEqual(
    { ...folded, configurationGraded: report.configurationGraded },
    report,
  );
  assert.equal(report.configurationGraded, false);
  assert.equal(folded.configurationGraded, true);
});

test("foldLaunchConfigPlaceholders folds a failing launchConfig check into the report", () => {
  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    {
      ...createDebugProfile("native-host", "none"),
      executablePath: "${workspaceFolder}/build/native_sim/zephyr/zephyr.exe",
    },
    createRuntime(),
    {
      pathExists: (filePath) =>
        filePath.endsWith("build/native_sim/zephyr/zephyr.exe"),
    },
  );
  assert.equal(report.canLaunch, true);
  const failBefore = report.summary.fail;

  const folded = foldLaunchConfigPlaceholders(report, [
    { key: "device", value: "<resolved-device>" },
  ]);

  assert.equal(folded.canLaunch, false);
  assert.equal(folded.summary.fail, failBefore + 1);
  // Named after the launch.json KEY, not after the check. `logUnlaunchableDetail`
  // builds the toast from failing check names, so this is the difference between
  // telling a customer to "resolve: device" -- a field in their own file -- and
  // "resolve: launchConfig", which is in nothing they own.
  const launchConfigChecks = folded.checks.filter(
    (check) => check.name === "device",
  );
  assert.equal(launchConfigChecks.length, 1);
  assert.equal(launchConfigChecks[0].status, "fail");
  assert.equal(launchConfigChecks[0].detail, "<resolved-device>");
  assert.match(launchConfigChecks[0].fix, /"device"/);
});

// A bare string has no surrounding key to be named after, and the fold must
// still produce a usable check rather than one called "".
test("foldLaunchConfigPlaceholders falls back to launchConfig for an unkeyed placeholder", () => {
  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    createDebugProfile("native-host", "none"),
    createRuntime(),
    { pathExists: () => true },
  );

  const folded = foldLaunchConfigPlaceholders(report, [
    { key: "", value: "<host>:<port>" },
  ]);
  assert.equal(folded.canLaunch, false);
  const check = folded.checks.find((entry) => entry.name === "launchConfig");
  assert.equal(check.status, "fail");
  assert.equal(check.detail, "<host>:<port>");
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
