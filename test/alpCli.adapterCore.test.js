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
  // What `sha256File` reports per path. A file with no entry hashes to a stable
  // value derived from its path, so a download always yields SOMETHING to
  // record; a test corrupts a file by overriding its entry (#386).
  const digests = new Map(Object.entries(overrides.digests ?? {}));
  const hashOf = (p) =>
    digests.get(p) ?? (existing.has(p) ? `sha256(${p})` : null);
  // undefined = no digest was ever recorded for the cached binary, i.e. every
  // machine that cached one before verification existed.
  let recorded = overrides.recordedDigest;
  const calls = {
    ensureDir: 0,
    download: 0,
    chmod: 0,
    verify: undefined,
    recorded: [],
  };
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
    download: async (_url, destFile, _signal, verify) => {
      calls.download++;
      calls.verify = verify;
      existing.add(destFile);
    },
    chmodExec: () => {
      calls.chmod++;
    },
    sha256File: hashOf,
    recordedCachedDigest: () => recorded,
    recordCachedDigest: async (digest) => {
      recorded = digest;
      calls.recorded.push(digest);
    },
    // Consent already granted by default — these rows are about the
    // resolution LADDER, not ADR 0021's consent gate (its own file:
    // test/alpCli.downloadConsent.test.js). A row that wants to drive a
    // refusal overrides this via `overrides`.
    ensureFreshDownloadConsent: async () => true,
    ...overrides,
  };
  return { deps, existing, calls, digests };
}

/** Deps for a cached binary this extension DID record a digest for — the state
 *  every machine reaches after one verified download. */
function cachedAndRecorded(overrides = {}) {
  return baseDeps({
    existing: ["/cache/cli/tan"],
    recordedDigest: "sha256(/cache/cli/tan)",
    ...overrides,
  });
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
  const { deps, calls } = cachedAndRecorded({
    bundledExists: true, // a verified cached copy also exists — bundled wins
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
  const { deps, calls } = cachedAndRecorded();
  const r = await resolveAlpBinary(deps);
  assert.deepEqual(r, { command: "/cache/cli/tan", source: "cached" });
  assert.equal(calls.download, 0);
});

test("resolveAlpBinary: a cached binary wins over a verified-native PATH tan (managed binary preferred; PATH is a last resort)", async () => {
  const { deps, calls } = cachedAndRecorded({
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

test("resolveAlpBinary: the download is handed the checksum spec for the SAME release", async () => {
  const { deps, calls } = baseDeps();
  await resolveAlpBinary(deps);
  assert.equal(calls.download, 1);
  // Without this the binary is fetched and executed having verified nothing —
  // and a dropped 4th argument is a silent, invisible regression at runtime.
  assert.ok(calls.verify, "downloadCli must pass a checksum spec");
  assert.equal(calls.verify.assetName, "tan-x86_64-unknown-linux-gnu");
  assert.ok(calls.verify.checksumsUrl.endsWith("/checksums.txt"));
  // Same release tag as the binary URL: a digest from another release proves
  // nothing about these bytes.
  const tag = `/download/v${require("../out/alpCli/service.js").SUPPORTED_CLI_VERSION}/`;
  assert.ok(calls.verify.checksumsUrl.includes(tag), calls.verify.checksumsUrl);
});

// ── consent gate (finding 1: a stale un-digested cache must not bypass it) ──

test("resolveAlpBinary: an un-digested cache with nothing on PATH is STILL gated on consent (deny is honoured)", async () => {
  // The exact state a review found: a leftover un-digested cache file (#386
  // migration population) plus nothing on PATH. `decideBinarySource` skips the
  // un-digested cache (no record) and, with `onPath` false, falls all the way
  // to `download` — so NOTHING is currently running, and there is no one to
  // strand by asking. Before the fix, `isUnverifiableCache(input)` alone
  // excluded this state from the gate, so a `deny` here downloaded anyway.
  const { deps, calls } = baseDeps({
    existing: ["/cache/cli/tan"], // present, but recordedDigest is undefined
    commandOnPath: () => false,
    ensureFreshDownloadConsent: async () => false, // simulates `deny`
  });
  await assert.rejects(
    () => resolveAlpBinary(deps),
    new RegExp(
      require("../out/alpCli/service.js").TAN_CLI_DOWNLOAD_CONSENT_NEEDED,
    ),
  );
  assert.equal(calls.download, 0, "a denied consent must not download");
});

test("resolveAlpBinary: an un-digested cache with nothing on PATH still asks (consent granted proceeds)", async () => {
  let asked = 0;
  const { deps, calls } = baseDeps({
    existing: ["/cache/cli/tan"],
    commandOnPath: () => false,
    ensureFreshDownloadConsent: async () => {
      asked++;
      return true;
    },
  });
  const r = await resolveAlpBinary(deps);
  assert.equal(
    asked,
    1,
    "the download arm must always ask, un-digested cache or not",
  );
  assert.equal(r.source, "download");
  assert.equal(calls.download, 1);
});

test("resolveAlpBinary: throws on unsupported host (no prebuilt asset)", async () => {
  // linux/arm (32-bit) is not in TARGETS, so it has no download asset.
  const { deps } = baseDeps({ platform: "linux", arch: "arm" });
  await assert.rejects(() => resolveAlpBinary(deps), /No prebuilt tan CLI/);
});

test("resolveAlpBinary: throws when the download leaves nothing to hash", async () => {
  const { deps } = baseDeps({
    download: async () => {
      /* download produced nothing */
    },
  });
  // Nothing on disk to hash, so there is nothing to RECORD either — and a
  // binary with no record would be refused on every later resolution anyway
  // (#386), so this refuses now rather than installing a dead end.
  await assert.rejects(
    () => resolveAlpBinary(deps),
    /did not produce a binary that could be read back/,
  );
});

test("resolveAlpBinary: throws when the download produces no binary at the cached path", async () => {
  const { deps } = baseDeps({
    // Hashable but absent: isolates the `fileExists` guard from the hash guard
    // above, so neither can be deleted while the other keeps the suite green.
    digests: { "/cache/cli/tan": "d".repeat(64) },
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
