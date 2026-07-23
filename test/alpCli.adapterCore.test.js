// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveAlpBinary,
  runAlp,
  runAlpAsync,
} = require("../out/alpCli/adapterCore.js");

function baseDeps(overrides = {}) {
  const existing = new Set(overrides.existing ?? []);
  const calls = { ensureDir: 0, download: 0, chmod: 0 };
  const deps = {
    cliPathSetting: "",
    platform: "linux",
    arch: "x64",
    cacheDir: "/cache/cli",
    cachedBinaryPath: "/cache/cli/tan",
    bundledBinaryPath: "/ext/bin/tan",
    bundledExists: false,
    fileExists: (p) => existing.has(p),
    commandOnPath: () => false,
    ensureDir: () => {
      calls.ensureDir++;
    },
    // tan-cli ships a RAW binary: a successful download writes it straight to
    // the cached binary path (no archive, no extract step).
    download: async (_url, destFile) => {
      calls.download++;
      existing.add(destFile);
    },
    chmodExec: () => {
      calls.chmod++;
    },
    ...overrides,
  };
  return { deps, existing, calls };
}

test("resolveAlpBinary: explicit cliPath wins, no download", async () => {
  const { deps, calls } = baseDeps({
    cliPathSetting: "/dev/tan",
    existing: ["/dev/tan"],
    commandOnPath: () => true,
  });
  const r = await resolveAlpBinary(deps);
  assert.deepEqual(r, { command: "/dev/tan", source: "cliPath" });
  assert.equal(calls.download, 0);
});

test("resolveAlpBinary: PATH when cliPath unset", async () => {
  const { deps } = baseDeps({ commandOnPath: () => true });
  const r = await resolveAlpBinary(deps);
  assert.deepEqual(r, { command: "tan", source: "path" });
});

test("resolveAlpBinary: bundled binary when not on PATH (platform-specific VSIX)", async () => {
  const { deps, calls } = baseDeps({
    bundledExists: true,
    existing: ["/cache/cli/tan"], // cached also exists — bundled must still win
  });
  const r = await resolveAlpBinary(deps);
  assert.deepEqual(r, { command: "/ext/bin/tan", source: "bundled" });
  assert.equal(calls.download, 0);
  assert.equal(calls.chmod, 1); // non-windows → chmod +x the bundled binary
});

test("resolveAlpBinary: windows bundled binary skips chmod", async () => {
  const { deps, calls } = baseDeps({
    platform: "win32",
    bundledBinaryPath: "/ext/bin/tan.exe",
    bundledExists: true,
  });
  const r = await resolveAlpBinary(deps);
  assert.deepEqual(r, { command: "/ext/bin/tan.exe", source: "bundled" });
  assert.equal(calls.chmod, 0);
});

test("resolveAlpBinary: cached binary when not on PATH", async () => {
  const { deps, calls } = baseDeps({ existing: ["/cache/cli/tan"] });
  const r = await resolveAlpBinary(deps);
  assert.deepEqual(r, { command: "/cache/cli/tan", source: "cached" });
  assert.equal(calls.download, 0);
});

test("resolveAlpBinary: a cached binary wins over a verified-native PATH tan (managed binary preferred; PATH is a last resort)", async () => {
  const { deps, calls } = baseDeps({
    existing: ["/cache/cli/tan"],
    commandOnPath: () => true,
  });
  const r = await resolveAlpBinary(deps);
  assert.deepEqual(r, { command: "/cache/cli/tan", source: "cached" });
  assert.equal(calls.download, 0);
});

test("resolveAlpBinary: downloads the raw binary when nothing else resolves", async () => {
  const { deps, calls } = baseDeps();
  const r = await resolveAlpBinary(deps);
  assert.equal(r.source, "download");
  assert.equal(r.command, "/cache/cli/tan");
  assert.equal(calls.ensureDir, 1);
  assert.equal(calls.download, 1);
  assert.equal(calls.chmod, 1); // non-windows → chmod +x
});

test("resolveAlpBinary: throws on unsupported host (no prebuilt asset)", async () => {
  // linux/arm (32-bit) is not in TARGETS, so it has no download asset.
  const { deps } = baseDeps({ platform: "linux", arch: "arm" });
  await assert.rejects(() => resolveAlpBinary(deps), /No prebuilt tan CLI/);
});

test("resolveAlpBinary: throws when download yields no binary", async () => {
  const { deps } = baseDeps({
    download: async () => {
      /* download produced nothing */
    },
  });
  await assert.rejects(
    () => resolveAlpBinary(deps),
    /did not produce a binary/,
  );
});

test("resolveAlpBinary: windows skips chmod", async () => {
  const { deps, calls } = baseDeps({
    platform: "win32",
    arch: "x64",
    cachedBinaryPath: "/cache/cli/tan.exe",
    download: async (_url, destFile) => {
      calls.download++;
      deps.fileExists = (p) => p === destFile;
    },
    existing: [],
  });
  const r = await resolveAlpBinary(deps);
  assert.equal(r.source, "download");
  assert.equal(calls.chmod, 0);
});

function spawnReturning(result) {
  const seen = {};
  const spawn = (command, args, cwd) => {
    seen.command = command;
    seen.args = args;
    seen.cwd = cwd;
    return result;
  };
  return { spawn, seen };
}

const envelope = (over = {}) =>
  JSON.stringify({
    command: "validate",
    ok: true,
    exitCode: 0,
    project: { root: "/p", boardYaml: null },
    data: {},
    issues: [],
    ...over,
  });

test("runAlp: appends --format json and classifies success", () => {
  const { spawn, seen } = spawnReturning({
    status: 0,
    stdout: envelope(),
    stderr: "",
  });
  const { outcome } = runAlp("tan", ["validate"], spawn, "/cwd");
  assert.deepEqual(seen.args, ["validate", "--format", "json"]);
  assert.equal(seen.cwd, "/cwd");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.kind, "success");
});

test("runAlp: validation exit maps to a warning with the first issue", () => {
  const { spawn } = spawnReturning({
    status: 2,
    stdout: envelope({
      ok: false,
      exitCode: 2,
      issues: [{ code: "v", severity: "error", message: "schema error" }],
    }),
    stderr: "",
  });
  const { outcome } = runAlp("tan", ["validate"], spawn);
  assert.equal(outcome.kind, "validation");
  assert.equal(outcome.severity, "warning");
  assert.equal(outcome.message, "schema error");
});

test("runAlp: spawn error yields an unknown/error outcome (no throw)", () => {
  const { spawn } = spawnReturning({
    status: null,
    stdout: "",
    stderr: "",
    error: new Error("spawn tan ENOENT"),
  });
  const { outcome } = runAlp("tan", ["doctor"], spawn);
  assert.equal(outcome.kind, "unknown");
  assert.equal(outcome.severity, "error");
  assert.match(outcome.message, /Could not run the tan CLI/);
});

test("runAlp: falls back to the envelope's exitCode when status is null", () => {
  const { spawn } = spawnReturning({
    status: null,
    stdout: envelope({ ok: false, exitCode: 3 }),
    stderr: "",
  });
  const { outcome } = runAlp("tan", ["generate"], spawn);
  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.kind, "write");
});

function spawnAsyncReturning(result) {
  const seen = {};
  const spawnAsync = async (command, args, cwd) => {
    seen.command = command;
    seen.args = args;
    seen.cwd = cwd;
    return result;
  };
  return { spawnAsync, seen };
}

test("runAlpAsync: appends --format json and classifies success", async () => {
  const { spawnAsync, seen } = spawnAsyncReturning({
    status: 0,
    stdout: envelope(),
    stderr: "",
  });
  const { outcome } = await runAlpAsync(
    "tan",
    ["validate"],
    spawnAsync,
    "/cwd",
  );
  assert.deepEqual(seen.args, ["validate", "--format", "json"]);
  assert.equal(seen.cwd, "/cwd");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.kind, "success");
});

test("runAlpAsync: validation exit maps to a warning with the first issue", async () => {
  const { spawnAsync } = spawnAsyncReturning({
    status: 2,
    stdout: envelope({
      ok: false,
      exitCode: 2,
      issues: [{ code: "v", severity: "error", message: "schema error" }],
    }),
    stderr: "",
  });
  const { outcome } = await runAlpAsync("tan", ["validate"], spawnAsync);
  assert.equal(outcome.kind, "validation");
  assert.equal(outcome.severity, "warning");
  assert.equal(outcome.message, "schema error");
});

test("runAlpAsync: a spawn error (ENOENT / cancelled abort) is an error outcome, no throw", async () => {
  const { spawnAsync } = spawnAsyncReturning({
    status: null,
    stdout: "",
    stderr: "",
    error: new Error("The operation was aborted"),
  });
  const { outcome } = await runAlpAsync("tan", ["validate"], spawnAsync);
  assert.equal(outcome.kind, "unknown");
  assert.equal(outcome.severity, "error");
  assert.match(outcome.message, /Could not run the tan CLI/);
});

test("runAlpAsync: falls back to the envelope's exitCode when status is null", async () => {
  const { spawnAsync } = spawnAsyncReturning({
    status: null,
    stdout: envelope({ ok: false, exitCode: 3 }),
    stderr: "",
  });
  const { outcome } = await runAlpAsync("tan", ["generate"], spawnAsync);
  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.kind, "write");
});
