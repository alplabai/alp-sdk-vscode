const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEBUG_TARGET_CHOICES,
  buildDebugPreflightReport,
  buildDoctorReport,
  createDebugProfile,
  createGenerationTraceReport,
  createInspectReport,
  createLaunchPreview,
  createSupportBundlePayload,
  debugProfileToLaunchDraft,
  isNativeHostTarget,
  serializeGenerationTraceReport,
  serializeInspectReport,
  serializeSupportBundlePayload,
  serverChoicesForTarget,
  unresolvedRequiredFields,
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

test("createDebugProfile defines reusable profile metadata", () => {
  const zephyr = createDebugProfile("zephyr-mcu", "openocd");
  const baremetal = createDebugProfile("baremetal-mcu", "jlink");
  const yocto = createDebugProfile("yocto-userspace", "gdbserver");
  const host = createDebugProfile("native-host", "none");

  assert.equal(zephyr.adapter, "cortex-debug");
  assert.equal(zephyr.os, "zephyr");
  // The placeholder does still survive into the profile -- alp-sdk metadata
  // carries no OpenOCD board .cfg path, so a thin extension has nothing to
  // substitute. What the core layer guarantees is that it is CLASSIFIED as
  // unresolved rather than passed off as a usable path: the customer is told
  // which field to supply, and preflight fails it (see the preflight test
  // below), so the profile can never be launched carrying it. Asserting only
  // that the string survives is what let an unlaunchable profile look correct.
  assert.deepEqual(zephyr.openOcdConfigFiles, ["<resolved-openocd-board-cfg>"]);
  assert.deepEqual(unresolvedRequiredFields(zephyr), [
    "OpenOCD board config file",
  ]);

  assert.equal(baremetal.adapter, "cortex-debug");
  assert.equal(baremetal.os, "baremetal");
  assert.equal(baremetal.interface, "swd");

  assert.equal(yocto.adapter, "cppdbg");
  assert.equal(yocto.server, "gdbserver");
  assert.equal(yocto.miMode, "gdb");

  // `lldb`, not `codelldb`: vadimcn.vscode-lldb v1.12.2 registers
  // `contributes.debuggers` = [{ "type": "lldb" }]. "codelldb" is the
  // extension's NAME -- it has never been a debug type, and this field is
  // written verbatim into launch.json as `type`, where VS Code answers an
  // unregistered one with "configured debug type 'codelldb' is not supported".
  assert.equal(host.adapter, "lldb");
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

test("buildDebugPreflightReport fails the placeholder OpenOCD board config", () => {
  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    createDebugProfile("zephyr-mcu", "openocd"),
    createRuntime(),
    // Every path that could exist does, so the only thing left to object to is
    // the <resolved-openocd-board-cfg> placeholder itself. OpenOCD would take
    // it as a literal filename and fail to open it.
    { pathExists: () => true },
  );

  assert.equal(report.canLaunch, false);
  const openOcd = report.checks.find((check) => check.name === "openOcdConfig");
  assert.equal(openOcd.status, "fail");
  assert.match(openOcd.detail, /<resolved-openocd-board-cfg>/);
});

test("buildDebugPreflightReport rejects a <host>:<port> gdbserver address", () => {
  const profile = {
    ...createDebugProfile("yocto-userspace", "gdbserver"),
    // Resolve the gdb path so the address is the only field that can fail.
    miDebuggerPath: "/usr/bin/gdb",
  };
  // The classifier used to test `value.includes("<resolved")`, which
  // "<host>:<port>" does not contain -- so an unusable gdbserver address was
  // reported resolved and the profile claimed canLaunch: true. cppdbg would
  // then try to connect to a host literally named "<host>".
  assert.equal(profile.miDebuggerServerAddress, "<host>:<port>");

  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    profile,
    createRuntime(),
    { pathExists: () => true },
  );

  assert.equal(report.canLaunch, false);
  assert.ok(
    report.checks.some(
      (check) =>
        check.name === "miDebuggerServerAddress" && check.status === "fail",
    ),
  );
  assert.deepEqual(unresolvedRequiredFields(profile), [
    "gdbserver address (host:port)",
  ]);

  // Control: a real address clears it. The rule must reject the placeholder
  // token, not every address that happens to contain a colon.
  const resolved = { ...profile, miDebuggerServerAddress: "192.168.1.50:2345" };
  assert.deepEqual(unresolvedRequiredFields(resolved), []);
  const resolvedReport = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    resolved,
    createRuntime(),
    { pathExists: () => true },
  );
  assert.equal(resolvedReport.summary.fail, 0);
  assert.equal(resolvedReport.canLaunch, true);
});

test("an absent svdFile warns, never blocks, and is omitted from the config", () => {
  const profile = {
    ...createDebugProfile("baremetal-mcu", "jlink"),
    // A J-Link device name is the one project-specific field here; resolve it
    // so svdFile is the sole non-pass check left.
    device: "Cortex-M55",
  };
  assert.equal(profile.svdFile, undefined);

  const report = buildDebugPreflightReport(
    "2026-05-14T00:00:00.000Z",
    createDebugContext(),
    profile,
    createRuntime(),
    { pathExists: () => true },
  );

  // WARN, never fail. An SVD only populates the peripheral/register view; the
  // session starts and breakpoints hit without one. As a fail it landed in
  // summary.fail and drove canLaunch false, so a missing register view stopped
  // a customer setting a breakpoint.
  const svd = report.checks.find((check) => check.name === "svdFile");
  assert.equal(svd.status, "warn");
  assert.ok(report.summary.warn > 0);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.canLaunch, true);
  // Optional, so it is never named as something the customer must supply.
  assert.deepEqual(unresolvedRequiredFields(profile), []);
});

test("an svdFile is emitted only once it resolves to a real path", () => {
  // No profile sets svdFile today (alp-sdk publishes no .svd, alp-sdk#948), so
  // this injects one to pin the rule for when the SDK does. The two branches
  // must be told apart by RESOLVEDNESS, not truthiness: cortex-debug OPENS
  // svdFile, so "<resolved-svd>" is taken as a filename and kills a session
  // preflight had only warned about. Both cortex-debug targets read it.
  for (const targetKind of ["zephyr-mcu", "baremetal-mcu"]) {
    const profile = createDebugProfile(targetKind, "jlink");
    assert.equal(profile.svdFile, undefined);
    assert.equal("svdFile" in debugProfileToLaunchDraft(profile), false);

    const placeholder = { ...profile, svdFile: "<resolved-svd>" };
    assert.equal(
      "svdFile" in debugProfileToLaunchDraft(placeholder),
      false,
      `${targetKind} wrote a placeholder svdFile into launch.json`,
    );
    // Still never named to the customer: it is optional and warns, so telling
    // them to supply one before they can set a breakpoint would be wrong.
    assert.deepEqual(unresolvedRequiredFields(placeholder), [
      "J-Link device name",
    ]);

    const resolved = { ...profile, svdFile: "/sdk/svd/AE822F4M55.svd" };
    assert.equal(
      debugProfileToLaunchDraft(resolved).svdFile,
      "/sdk/svd/AE822F4M55.svd",
    );
  }
});

/** Our "nobody filled this in yet" marker. Not `${...}`, which is a VS Code
 *  variable substitution VS Code expands itself and which is therefore
 *  resolved as far as this repo is concerned. */
const UNRESOLVED_PLACEHOLDER = /<[^<>]*>/;

/**
 * Draft key -> the customer-facing label `unresolvedRequiredFields` must use
 * for it. Deliberately exhaustive: a placeholder written under a key that is
 * NOT in this table fails the matrix below, which is the point. `svdFile` is
 * absent because it is optional and must never be emitted unresolved at all;
 * so is any future key nobody remembered to name.
 */
const PLACEHOLDER_KEY_LABEL = {
  // cortex-debug reads `device` for J-Link, but baremetal-mcu emits it whatever
  // the servertype -- calling it a "J-Link device name" to a pyOCD user is a lie.
  device: (profile) =>
    profile.server === "jlink" ? "J-Link device name" : "probe device name",
  targetId: () => "pyOCD target id",
  miDebuggerServerAddress: () => "gdbserver address (host:port)",
  miDebuggerPath: () => "gdb executable path",
  configFiles: () => "OpenOCD board config file",
};

function hasPlaceholder(value) {
  if (typeof value === "string") return UNRESOLVED_PLACEHOLDER.test(value);
  if (Array.isArray(value)) return value.some(hasPlaceholder);
  if (value && typeof value === "object")
    return Object.values(value).some(hasPlaceholder);
  return false;
}

// The one invariant that covers every target/server pair at once: a placeholder
// may reach launch.json ONLY where the extension also tells the customer, by
// name, which field to go and fill in. Both directions are pinned -- an unnamed
// placeholder is a field the customer cannot fix, and a named field that is not
// in the file points them at a key they will never find.
//
// Driven off the real exported choice lists so a new target class or a new
// backend cannot be added without landing here. The narrow loop this replaces
// checked only zephyr-mcu/jlink, so a placeholder svdFile on the openocd or
// pyocd branch broke nothing.
test("every launch draft's placeholders are exactly the fields named to the customer", () => {
  for (const { targetKind } of DEBUG_TARGET_CHOICES) {
    for (const { server } of serverChoicesForTarget(targetKind)) {
      const where = `${targetKind}/${server}`;
      const profile = createDebugProfile(targetKind, server);
      const config = createLaunchPreview(
        "2026-05-14T00:00:00.000Z",
        targetKind,
        server,
      ).launch.configurations[0];

      const labels = Object.entries(config)
        .filter(([, value]) => hasPlaceholder(value))
        .map(([key]) => {
          const label = PLACEHOLDER_KEY_LABEL[key];
          assert.ok(
            label,
            `${where} writes an unresolved placeholder under "${key}" (${JSON.stringify(config[key])}), which unresolvedRequiredFields() never names`,
          );
          return label(profile);
        });

      assert.deepEqual(
        labels.slice().sort(),
        unresolvedRequiredFields(profile).slice().sort(),
        where,
      );
    }
  }
});

// The two combinations the QuickPick offers that used to name a field which is
// not in the emitted file at all: baremetal-mcu ignores `server` and always
// writes device+interface, so openocd named "OpenOCD board config file" and
// pyocd named "the pyOCD target id" while the `<resolved-device>` that IS in the
// file went unnamed. Spelled out rather than left to the matrix above, because
// the exact wording is what a customer reads.
test("baremetal-mcu names its device field whatever the backend is", () => {
  for (const server of ["openocd", "pyocd"]) {
    const profile = createDebugProfile("baremetal-mcu", server);
    const config = createLaunchPreview(
      "2026-05-14T00:00:00.000Z",
      "baremetal-mcu",
      server,
    ).launch.configurations[0];

    assert.equal(config.device, "<resolved-device>");
    assert.equal("targetId" in config, false);
    assert.equal("configFiles" in config, false);
    assert.deepEqual(unresolvedRequiredFields(profile), ["probe device name"]);
  }

  // jlink is the one backend for which "J-Link device name" is true.
  assert.deepEqual(
    unresolvedRequiredFields(createDebugProfile("baremetal-mcu", "jlink")),
    ["J-Link device name"],
  );
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
  // Emitted, but only as a marker of an unfilled field -- never as something
  // the draft claims is launchable. The pairing that must never happen is this
  // string plus canLaunch: true, which the preflight test below pins.
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
  // Goes into launch.json verbatim as `type`, so it must be a debug type an
  // installed extension registers: vadimcn.vscode-lldb v1.12.2 contributes only
  // "lldb". "codelldb" is the extension name, not a debug type, and VS Code
  // refuses such a session with "configured debug type 'codelldb' is not
  // supported" -- on native_sim, the first debug session a customer ever runs.
  // test/debug.adapterTypes.test.js holds the full per-target type table.
  assert.equal(config.type, "lldb");
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
