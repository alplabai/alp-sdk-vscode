const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { executeCli, parseCliArgs } = require("../out/cli/service.js");

function createSpawnWith(status, stderr = "") {
  return () => ({
    status,
    stdout: "",
    stderr,
  });
}

function createGenerateSpawn(failingEmit = null) {
  return (_command, args) => {
    const emitIndex = args.indexOf("--emit");
    const emit = emitIndex >= 0 ? args[emitIndex + 1] : "";
    const shouldFail = failingEmit && emit === failingEmit;
    return {
      status: shouldFail ? 1 : 0,
      stdout: "",
      stderr: shouldFail ? `emit failed for ${emit}` : "",
    };
  };
}

test("parseCliArgs resolves command and shared flags", () => {
  const parsed = parseCliArgs([
    "validate",
    "--project",
    "/workspace/app",
    "--board-yaml",
    "configs/board.yaml",
    "--sdk-root",
    "/workspace/alp-sdk",
    "--format",
    "json",
    "--ci",
  ]);

  assert.equal(parsed.command, "validate");
  assert.deepEqual(parsed.commandArgs, []);
  assert.equal(parsed.flags.projectPath, "/workspace/app");
  assert.equal(parsed.flags.boardYamlPath, "configs/board.yaml");
  assert.equal(parsed.flags.sdkRoot, "/workspace/alp-sdk");
  assert.equal(parsed.flags.format, "json");
  assert.equal(parsed.flags.ci, true);
  assert.equal(parsed.flags.nonInteractive, true);
  assert.deepEqual(parsed.errors, []);
});

test("parseCliArgs reports unknown flags", () => {
  const parsed = parseCliArgs(["validate", "--wat"]);

  assert.equal(parsed.command, "validate");
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /Unknown flag/);
});

test("parseCliArgs rejects --all with --target", () => {
  const parsed = parseCliArgs(["generate", "--all", "--target", "zephyr-conf"]);

  assert.equal(parsed.command, "generate");
  assert.equal(parsed.flags.all, true);
  assert.equal(parsed.flags.target, "zephyr-conf");
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /cannot be used together/);
});

test("parseCliArgs parses doctor target-kind and server flags", () => {
  const parsed = parseCliArgs([
    "doctor",
    "--target-kind",
    "zephyr-mcu",
    "--server",
    "openocd",
  ]);

  assert.equal(parsed.command, "doctor");
  assert.equal(parsed.flags.targetKind, "zephyr-mcu");
  assert.equal(parsed.flags.server, "openocd");
  assert.deepEqual(parsed.errors, []);
});

test("parseCliArgs parses init template and destination flags", () => {
  const parsed = parseCliArgs([
    "init",
    "--template",
    "iot-starter",
    "--name",
    "demo-app",
    "--destination",
    "/workspace/out",
    "--preview",
    "--force",
  ]);

  assert.equal(parsed.command, "init");
  assert.equal(parsed.flags.template, "iot-starter");
  assert.equal(parsed.flags.name, "demo-app");
  assert.equal(parsed.flags.destination, "/workspace/out");
  assert.equal(parsed.flags.preview, true);
  assert.equal(parsed.flags.force, true);
});

test("parseCliArgs parses scaffold template and module flags", () => {
  const parsed = parseCliArgs([
    "scaffold",
    "--template",
    "diagnostics-check",
    "--name",
    "board health",
    "--destination",
    "/workspace/out",
    "--preview",
    "--force",
  ]);

  assert.equal(parsed.command, "scaffold");
  assert.equal(parsed.flags.template, "diagnostics-check");
  assert.equal(parsed.flags.name, "board health");
  assert.equal(parsed.flags.destination, "/workspace/out");
  assert.equal(parsed.flags.preview, true);
  assert.equal(parsed.flags.force, true);
});

test("executeCli returns clean validate result with json envelope", () => {
  const result = executeCli({
    argv: [
      "validate",
      "--project",
      "/workspace/app",
      "--sdk-root",
      "/workspace/sdk",
      "--format",
      "json",
    ],
    cwd: "/workspace/app",
    platform: "linux",
    pathExists: (candidatePath) =>
      candidatePath === "/workspace/app/board.yaml" ||
      candidatePath === "/workspace/sdk/scripts/alp_project.py",
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.format, "json");
  assert.deepEqual(result.textLines, []);
  assert.equal(result.envelope.command, "validate");
  assert.equal(result.envelope.ok, true);
  assert.equal(result.envelope.exitCode, 0);
  assert.equal(result.envelope.data.outcome, "clean");
  assert.equal(result.envelope.issues.length, 0);
});

test("executeCli maps schema validation failures to exit code 2", () => {
  const result = executeCli({
    argv: ["validate", "--project=/workspace/app", "--sdk-root=/workspace/sdk"],
    cwd: "/workspace/app",
    platform: "linux",
    pathExists: (candidatePath) =>
      candidatePath === "/workspace/app/board.yaml" ||
      candidatePath === "/workspace/sdk/scripts/alp_project.py",
    spawnSync: createSpawnWith(1, "schema: invalid iot block"),
  });

  assert.equal(result.exitCode, 2);
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.data.outcome, "schema-violation");
  assert.equal(result.envelope.issues.length >= 1, true);
  assert.match(result.envelope.issues[0].message, /schema/);
});

test("executeCli fails with validation exit code when board.yaml is missing", () => {
  const result = executeCli({
    argv: [
      "validate",
      "--project",
      "/workspace/app",
      "--sdk-root",
      "/workspace/sdk",
    ],
    cwd: "/workspace/app",
    platform: "linux",
    pathExists: (candidatePath) =>
      candidatePath === "/workspace/sdk/scripts/alp_project.py",
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 2);
  assert.equal(result.envelope.ok, false);
  assert.match(result.envelope.issues[0].message, /board\.yaml/);
});

test("executeCli runs generate for all targets in json mode", () => {
  const result = executeCli({
    argv: [
      "generate",
      "--project",
      "/workspace/app",
      "--sdk-root",
      "/workspace/sdk",
      "--format",
      "json",
      "--all",
    ],
    cwd: "/workspace/app",
    platform: "linux",
    pathExists: (candidatePath) =>
      candidatePath === "/workspace/app/board.yaml" ||
      candidatePath === "/workspace/sdk/scripts/alp_project.py",
    spawnSync: createGenerateSpawn(),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.format, "json");
  assert.equal(result.envelope.command, "generate");
  assert.equal(result.envelope.ok, true);
  assert.deepEqual(result.envelope.data.targets, [
    "zephyr-conf",
    "dts-overlay",
    "cmake-args",
    "yocto-conf",
  ]);
  assert.equal(result.envelope.data.written.length, 4);
  assert.deepEqual(result.envelope.data.failed, []);
});

test("executeCli maps generate target failures to exit code 3", () => {
  const result = executeCli({
    argv: [
      "generate",
      "--project",
      "/workspace/app",
      "--sdk-root",
      "/workspace/sdk",
      "--target",
      "dts-overlay",
    ],
    cwd: "/workspace/app",
    platform: "linux",
    pathExists: (candidatePath) =>
      candidatePath === "/workspace/app/board.yaml" ||
      candidatePath === "/workspace/sdk/scripts/alp_project.py",
    spawnSync: createGenerateSpawn("dts-overlay"),
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.envelope.command, "generate");
  assert.deepEqual(result.envelope.data.targets, ["dts-overlay"]);
  assert.deepEqual(result.envelope.data.failed, ["dts-overlay"]);
  assert.equal(result.envelope.issues.length, 1);
  assert.match(result.envelope.issues[0].message, /emit failed/);
});

test("executeCli returns presets from sdk metadata in json mode", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alp-cli-presets-json-"));
  const sdkRoot = path.join(root, "alp-sdk");
  const modulesDir = path.join(sdkRoot, "metadata/e1m_modules/E1M-AEN701");
  const carriersDir = path.join(sdkRoot, "metadata/carriers/E1M-EVK");
  fs.mkdirSync(path.join(sdkRoot, "scripts"), { recursive: true });
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.mkdirSync(carriersDir, { recursive: true });
  fs.writeFileSync(path.join(sdkRoot, "scripts/alp_project.py"), "# stub\n");
  fs.writeFileSync(path.join(modulesDir, "som.yaml"), "sku: E1M-AEN701\n");
  fs.writeFileSync(
    path.join(carriersDir, "board.yaml"),
    [
      "schema_version: 1",
      "som:",
      "  sku: E1M-AEN701",
      "carrier:",
      "  name: E1M-EVK",
      "  populated:",
      "    wifi: true",
      "os: zephyr",
      "",
    ].join("\n"),
  );

  const result = executeCli({
    argv: [
      "presets",
      "--project",
      root,
      "--sdk-root",
      sdkRoot,
      "--format",
      "json",
    ],
    cwd: root,
    platform: "linux",
    pathExists: (candidatePath) => fs.existsSync(candidatePath),
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.envelope.command, "presets");
  assert.deepEqual(result.envelope.data.skus, ["E1M-AEN701"]);
  assert.equal(result.envelope.data.carriers.length, 1);
  assert.equal(result.envelope.data.carriers[0].name, "E1M-EVK");
  assert.equal(result.envelope.issues.length, 0);
});

test("executeCli presets returns warning when sdk-root is unresolved", () => {
  const result = executeCli({
    argv: ["presets", "--format", "json"],
    cwd: "/workspace/app",
    platform: "linux",
    pathExists: () => false,
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.envelope.command, "presets");
  assert.equal(result.envelope.data.sdkRoot, null);
  assert.equal(result.envelope.issues.length, 1);
  assert.equal(result.envelope.issues[0].code, "presets.sdk-root-unresolved");
});

test("executeCli returns doctor failure when target/server are incompatible", () => {
  const result = executeCli({
    argv: ["doctor", "--target-kind", "native-host", "--server", "openocd"],
    cwd: "/workspace/app",
    platform: "linux",
    pathExists: () => true,
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 4);
  assert.equal(result.envelope.command, "doctor");
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.issues[0].code, "doctor.server-compatibility");
});

test("executeCli returns doctor report in json mode", () => {
  const result = executeCli({
    argv: [
      "doctor",
      "--project",
      "/workspace/app",
      "--sdk-root",
      "/workspace/sdk",
      "--format",
      "json",
      "--target-kind",
      "native-host",
      "--server",
      "none",
    ],
    cwd: "/workspace/app",
    platform: "linux",
    pathExists: (candidatePath) =>
      candidatePath === "/workspace/app/board.yaml" ||
      candidatePath === "/workspace/sdk/scripts/alp_project.py",
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.format, "json");
  assert.equal(result.envelope.command, "doctor");
  assert.equal(result.envelope.ok, true);
  assert.equal(result.envelope.data.targetKind, "native-host");
  assert.equal(result.envelope.data.server, "none");
});

test("executeCli init preview reports planned files without writing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alp-cli-init-preview-"));

  const result = executeCli({
    argv: [
      "init",
      "--destination",
      root,
      "--name",
      "preview-app",
      "--template",
      "minimal-app",
      "--preview",
      "--format",
      "json",
    ],
    cwd: root,
    platform: "linux",
    pathExists: (candidatePath) => fs.existsSync(candidatePath),
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.envelope.command, "init");
  assert.equal(result.envelope.data.preview, true);
  assert.equal(result.envelope.data.fileChanges.length > 0, true);
  assert.equal(result.envelope.data.written.length, 0);

  const boardPath = path.join(root, "preview-app", "board.yaml");
  assert.equal(fs.existsSync(boardPath), false);
});

test("executeCli init writes files when preview is disabled", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alp-cli-init-write-"));

  const result = executeCli({
    argv: [
      "init",
      "--destination",
      root,
      "--name",
      "write-app",
      "--template",
      "sensor-starter",
      "--format",
      "json",
    ],
    cwd: root,
    platform: "linux",
    pathExists: (candidatePath) => fs.existsSync(candidatePath),
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.envelope.data.preview, false);
  assert.equal(result.envelope.data.written.length > 0, true);

  const boardPath = path.join(root, "write-app", "board.yaml");
  assert.equal(fs.existsSync(boardPath), true);
});

test("executeCli init blocks overwriting without force", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "alp-cli-init-overwrite-"),
  );
  const appRoot = path.join(root, "existing-app");
  fs.mkdirSync(appRoot, { recursive: true });
  fs.writeFileSync(path.join(appRoot, "board.yaml"), "schema_version: 999\n");

  const result = executeCli({
    argv: [
      "init",
      "--destination",
      root,
      "--name",
      "existing-app",
      "--format",
      "json",
    ],
    cwd: root,
    platform: "linux",
    pathExists: (candidatePath) => fs.existsSync(candidatePath),
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.envelope.command, "init");
  assert.equal(result.envelope.issues[0].code, "init.overwrite-blocked");
});

test("executeCli scaffold preview reports planned files without writing", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "alp-cli-scaffold-preview-"),
  );

  const result = executeCli({
    argv: [
      "scaffold",
      "--destination",
      root,
      "--name",
      "board health",
      "--template",
      "diagnostics-check",
      "--preview",
      "--format",
      "json",
    ],
    cwd: root,
    platform: "linux",
    pathExists: (candidatePath) => fs.existsSync(candidatePath),
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.envelope.command, "scaffold");
  assert.equal(result.envelope.data.preview, true);
  assert.equal(result.envelope.data.fileChanges.length > 0, true);
  assert.equal(result.envelope.data.written.length, 0);

  const headerPath = path.join(root, "include/modules/board_health.h");
  assert.equal(fs.existsSync(headerPath), false);
});

test("executeCli scaffold writes files when preview is disabled", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "alp-cli-scaffold-write-"),
  );

  const result = executeCli({
    argv: [
      "scaffold",
      "--destination",
      root,
      "--name",
      "connectivity",
      "--template",
      "connectivity-service",
      "--format",
      "json",
    ],
    cwd: root,
    platform: "linux",
    pathExists: (candidatePath) => fs.existsSync(candidatePath),
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.envelope.command, "scaffold");
  assert.equal(result.envelope.data.preview, false);
  assert.equal(result.envelope.data.written.length > 0, true);

  const sourcePath = path.join(root, "src/modules/connectivity/connectivity.c");
  assert.equal(fs.existsSync(sourcePath), true);
});

test("executeCli scaffold blocks overwriting without force", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "alp-cli-scaffold-overwrite-"),
  );
  const headerPath = path.join(root, "include/modules/net_mod.h");
  fs.mkdirSync(path.dirname(headerPath), { recursive: true });
  fs.writeFileSync(headerPath, "// user-owned header\n");

  const result = executeCli({
    argv: [
      "scaffold",
      "--destination",
      root,
      "--name",
      "net mod",
      "--template",
      "connectivity-service",
      "--format",
      "json",
    ],
    cwd: root,
    platform: "linux",
    pathExists: (candidatePath) => fs.existsSync(candidatePath),
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.envelope.command, "scaffold");
  assert.equal(result.envelope.issues[0].code, "scaffold.overwrite-blocked");
});

test("executeCli scaffold requires module name", () => {
  const result = executeCli({
    argv: ["scaffold", "--template", "sensor-driver", "--format", "json"],
    cwd: "/workspace/app",
    platform: "linux",
    pathExists: () => true,
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.envelope.command, "scaffold");
  assert.equal(result.envelope.issues[0].code, "scaffold.name-required");
});

test("executeCli reports not-implemented commands with deterministic envelope", () => {
  const result = executeCli({
    argv: ["inspect", "--format", "json"],
    cwd: "/workspace/app",
    platform: "linux",
    pathExists: () => false,
    spawnSync: createSpawnWith(0),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.format, "json");
  assert.equal(result.envelope.command, "inspect");
  assert.equal(result.envelope.ok, false);
  assert.equal(result.envelope.issues[0].code, "cli.not-implemented");
});
