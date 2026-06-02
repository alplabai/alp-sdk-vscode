// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveAlpBinary, runAlp } = require("../out/alpCli/adapterCore.js");

function baseDeps(overrides = {}) {
  const existing = new Set(overrides.existing ?? []);
  const calls = { ensureDir: 0, download: 0, extract: 0, chmod: 0 };
  const deps = {
    cliPathSetting: "",
    platform: "linux",
    arch: "x64",
    cacheDir: "/cache/cli",
    cachedBinaryPath: "/cache/cli/alp",
    fileExists: (p) => existing.has(p),
    commandOnPath: () => false,
    ensureDir: () => {
      calls.ensureDir++;
    },
    download: async () => {
      calls.download++;
    },
    extractTarGz: async () => {
      calls.extract++;
      existing.add("/cache/cli/alp"); // a successful extract produces the binary
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
    cliPathSetting: "/dev/alp",
    existing: ["/dev/alp"],
    commandOnPath: () => true,
  });
  const r = await resolveAlpBinary(deps);
  assert.deepEqual(r, { command: "/dev/alp", source: "cliPath" });
  assert.equal(calls.download, 0);
});

test("resolveAlpBinary: PATH when cliPath unset", async () => {
  const { deps } = baseDeps({ commandOnPath: () => true });
  const r = await resolveAlpBinary(deps);
  assert.deepEqual(r, { command: "alp", source: "path" });
});

test("resolveAlpBinary: cached binary when not on PATH", async () => {
  const { deps, calls } = baseDeps({ existing: ["/cache/cli/alp"] });
  const r = await resolveAlpBinary(deps);
  assert.deepEqual(r, { command: "/cache/cli/alp", source: "cached" });
  assert.equal(calls.download, 0);
});

test("resolveAlpBinary: downloads when nothing else resolves", async () => {
  const { deps, calls } = baseDeps();
  const r = await resolveAlpBinary(deps);
  assert.equal(r.source, "download");
  assert.equal(r.command, "/cache/cli/alp");
  assert.equal(calls.ensureDir, 1);
  assert.equal(calls.download, 1);
  assert.equal(calls.extract, 1);
  assert.equal(calls.chmod, 1); // non-windows → chmod +x
});

test("resolveAlpBinary: throws on unsupported host (no prebuilt asset)", async () => {
  const { deps } = baseDeps({ platform: "darwin", arch: "x64" });
  await assert.rejects(() => resolveAlpBinary(deps), /No prebuilt alp CLI/);
});

test("resolveAlpBinary: throws when download yields no binary", async () => {
  const { deps } = baseDeps({
    extractTarGz: async () => {
      /* extract produced nothing */
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
    cachedBinaryPath: "/cache/cli/alp.exe",
    extractTarGz: async () => {
      calls.extract++;
    },
    existing: [],
  });
  // make the binary appear after extract
  deps.extractTarGz = async () => {
    calls.extract++;
    deps.fileExists = (p) => p === "/cache/cli/alp.exe";
  };
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
  const { outcome } = runAlp("alp", ["validate"], spawn, "/cwd");
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
  const { outcome } = runAlp("alp", ["validate"], spawn);
  assert.equal(outcome.kind, "validation");
  assert.equal(outcome.severity, "warning");
  assert.equal(outcome.message, "schema error");
});

test("runAlp: spawn error yields an unknown/error outcome (no throw)", () => {
  const { spawn } = spawnReturning({
    status: null,
    stdout: "",
    stderr: "",
    error: new Error("spawn alp ENOENT"),
  });
  const { outcome } = runAlp("alp", ["doctor"], spawn);
  assert.equal(outcome.kind, "unknown");
  assert.equal(outcome.severity, "error");
  assert.match(outcome.message, /Could not run the alp CLI/);
});

test("runAlp: falls back to the envelope's exitCode when status is null", () => {
  const { spawn } = spawnReturning({
    status: null,
    stdout: envelope({ ok: false, exitCode: 3 }),
    stderr: "",
  });
  const { outcome } = runAlp("alp", ["generate"], spawn);
  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.kind, "write");
});
