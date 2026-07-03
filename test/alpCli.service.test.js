// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decideBinarySource,
  classifyExitCode,
  parseEnvelope,
  classifyOutcome,
  releaseAssetForTarget,
  binaryName,
  SUPPORTED_CLI_VERSION,
} = require("../out/alpCli/service.js");

test("decideBinarySource follows the locked order", () => {
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/alp",
      cliPathExists: true,
      onPath: true,
      cachedExists: true,
    }),
    "cliPath",
  );
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/alp",
      cliPathExists: false,
      onPath: true,
      cachedExists: true,
    }),
    "path",
  );
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      cachedExists: true,
    }),
    "cached",
  );
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      cachedExists: false,
    }),
    "download",
  );
});

test("classifyExitCode maps the stable codes", () => {
  assert.equal(classifyExitCode(0), "success");
  assert.equal(classifyExitCode(1), "runtime");
  assert.equal(classifyExitCode(2), "validation");
  assert.equal(classifyExitCode(3), "write");
  assert.equal(classifyExitCode(4), "doctor");
  assert.equal(classifyExitCode(5), "internal");
  assert.equal(classifyExitCode(99), "unknown");
});

test("parseEnvelope accepts a well-formed envelope, rejects junk", () => {
  const good = JSON.stringify({
    command: "validate",
    ok: true,
    exitCode: 0,
    project: { root: "/p", boardYaml: "/p/board.yaml" },
    data: {},
    issues: [],
  });
  const parsed = parseEnvelope(good);
  assert.ok(parsed);
  assert.equal(parsed.command, "validate");

  assert.equal(parseEnvelope(""), null);
  assert.equal(parseEnvelope("   "), null);
  assert.equal(parseEnvelope("not json"), null);
  assert.equal(parseEnvelope(JSON.stringify({ command: "x" })), null); // missing fields
});

test("classifyOutcome sets severity by kind and prefers the first issue", () => {
  const ok = classifyOutcome(
    0,
    parseEnvelope(
      JSON.stringify({
        command: "x",
        ok: true,
        exitCode: 0,
        project: {},
        data: {},
        issues: [],
      }),
    ),
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.kind, "success");
  assert.equal(ok.severity, "info");

  const validation = classifyOutcome(
    2,
    parseEnvelope(
      JSON.stringify({
        command: "validate",
        ok: false,
        exitCode: 2,
        project: {},
        data: {},
        issues: [{ code: "x", severity: "error", message: "bad board.yaml" }],
      }),
    ),
  );
  assert.equal(validation.kind, "validation");
  assert.equal(validation.severity, "warning");
  assert.equal(validation.message, "bad board.yaml");

  const runtime = classifyOutcome(1, null);
  assert.equal(runtime.kind, "runtime");
  assert.equal(runtime.severity, "error");

  assert.equal(classifyOutcome(4, null).severity, "warning"); // doctor
  assert.equal(classifyOutcome(3, null).severity, "error"); // write
});

test("releaseAssetForTarget mirrors the published targets", () => {
  const linux = releaseAssetForTarget("linux", "x64");
  assert.equal(linux.target, "x86_64-unknown-linux-gnu");
  assert.equal(linux.tag, `cli-rs-v${SUPPORTED_CLI_VERSION}`);
  assert.ok(linux.url.endsWith("/alp-x86_64-unknown-linux-gnu.tar.gz"));

  // arm64 Linux ships the static musl build (runs on glibc hosts too).
  assert.equal(
    releaseAssetForTarget("linux", "arm64").target,
    "aarch64-unknown-linux-musl",
  );
  assert.equal(
    releaseAssetForTarget("darwin", "arm64").target,
    "aarch64-apple-darwin",
  );
  assert.equal(
    releaseAssetForTarget("win32", "x64").target,
    "x86_64-pc-windows-msvc",
  );

  // Intel macOS has no prebuilt archive.
  assert.equal(releaseAssetForTarget("darwin", "x64"), null);
});

test("binaryName is platform-specific", () => {
  assert.equal(binaryName("win32"), "alp.exe");
  assert.equal(binaryName("linux"), "alp");
  assert.equal(binaryName("darwin"), "alp");
});
