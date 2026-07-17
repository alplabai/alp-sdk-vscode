// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decideBinarySource,
  isNativeAlpVersionOutput,
  parseAlpVersion,
  isCliBehind,
  classifyExitCode,
  parseEnvelope,
  classifyOutcome,
  releaseAssetForTarget,
  binaryName,
  SUPPORTED_CLI_VERSION,
} = require("../out/alpCli/service.js");

test("parseAlpVersion extracts MAJOR.MINOR.PATCH and tolerates a suffix", () => {
  assert.equal(parseAlpVersion("alp 0.1.14"), "0.1.14");
  assert.equal(parseAlpVersion("alp 0.1.14 (abc1234)\n"), "0.1.14");
  assert.equal(parseAlpVersion("alp, version 0.8.1"), null); // python click CLI
  assert.equal(parseAlpVersion(""), null);
});

test("isCliBehind compares numeric version tuples", () => {
  assert.equal(isCliBehind("0.1.11", "0.1.14"), true);
  assert.equal(isCliBehind("0.1.14", "0.1.14"), false);
  assert.equal(isCliBehind("0.2.0", "0.1.14"), false);
  assert.equal(isCliBehind("1.0.0", "0.1.14"), false);
  assert.equal(isCliBehind(null, "0.1.14"), false); // unknown → not behind
});

test("decideBinarySource follows the resolution order", () => {
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/alp",
      cliPathExists: true,
      onPath: true,
      bundledExists: true,
      cachedExists: true,
    }),
    "cliPath",
  );
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/alp",
      cliPathExists: false,
      onPath: true,
      bundledExists: true,
      cachedExists: true,
    }),
    "path",
  );
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: false,
      cachedExists: true,
    }),
    "cached",
  );
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: false,
      cachedExists: false,
    }),
    "download",
  );
});

test("decideBinarySource: bundled wins over cached/download but loses to cliPath/path", () => {
  // bundled beats cached and download when nothing higher-priority resolves.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: true,
      cachedExists: true,
    }),
    "bundled",
  );
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: true,
      cachedExists: false,
    }),
    "bundled",
  );

  // an explicit, existing cliPath still wins over a bundled binary.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/alp",
      cliPathExists: true,
      onPath: false,
      bundledExists: true,
      cachedExists: true,
    }),
    "cliPath",
  );

  // `alp` on PATH still wins over a bundled binary.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: true,
      bundledExists: true,
      cachedExists: true,
    }),
    "path",
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

  // Intel macOS has no download asset wired yet: the archive is built by
  // release-cli-rs.yml but not offered for download-on-demand until a release
  // carries it and SUPPORTED_CLI_VERSION points at that release.
  assert.equal(releaseAssetForTarget("darwin", "x64"), null);

  // A host with no published target (e.g. 32-bit ARM Linux) has no asset.
  assert.equal(releaseAssetForTarget("linux", "arm"), null);
});

test("binaryName is platform-specific", () => {
  assert.equal(binaryName("win32"), "alp.exe");
  assert.equal(binaryName("linux"), "alp");
  assert.equal(binaryName("darwin"), "alp");
});

test("isNativeAlpVersionOutput accepts native clap output, rejects the Python click CLI", () => {
  // Native (Rust/clap): `alp <MAJOR.MINOR.PATCH>`.
  for (const out of [
    "alp 0.1.3",
    "alp 0.1.6\n",
    "alp 10.20.30",
    "alp 0.2.0 (abc1234)", // tolerate a future build-metadata suffix
    "  alp 0.1.3  ", // surrounding whitespace
    "alp 0.1.3\r\n", // CRLF
    "\nalp 0.1.3", // leading blank line
  ]) {
    assert.equal(
      isNativeAlpVersionOutput(out),
      true,
      `expected native: ${JSON.stringify(out)}`,
    );
  }

  // Upstream SDK's Python `alp` (click `version_option(prog_name="alp")`):
  // `alp, version X` — the shadowing binary this check exists to reject.
  for (const out of ["alp, version 0.8.1", "alp, version 0.8.1\n"]) {
    assert.equal(
      isNativeAlpVersionOutput(out),
      false,
      `expected click rejected: ${JSON.stringify(out)}`,
    );
  }

  // Garbage / unrelated / partial → not the native CLI.
  for (const out of [
    "",
    "   ",
    "python 3.11.5",
    "alpine 3.19", // must not partial-match the `alp` prefix
    "alp", // name only, no version
    "alp 0.1", // two components, not MAJOR.MINOR.PATCH
    "usage: alp [OPTIONS]", // click help/error text
  ]) {
    assert.equal(
      isNativeAlpVersionOutput(out),
      false,
      `expected rejected: ${JSON.stringify(out)}`,
    );
  }
});
