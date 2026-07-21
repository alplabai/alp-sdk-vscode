// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decideBinarySource,
  isNativeTanVersionOutput,
  parseTanVersion,
  isCliBehind,
  isCliAhead,
  classifyExitCode,
  parseEnvelope,
  classifyOutcome,
  releaseAssetForTarget,
  binaryName,
  SUPPORTED_CLI_VERSION,
} = require("../out/alpCli/service.js");
const { resolutionInputFromDeps } = require("../out/alpCli/adapterCore.js");

test("parseTanVersion extracts MAJOR.MINOR.PATCH and tolerates a suffix", () => {
  assert.equal(parseTanVersion("tan 0.1.0"), "0.1.0");
  assert.equal(parseTanVersion("tan 0.1.0 (abc1234)\n"), "0.1.0");
  assert.equal(parseTanVersion("alp 0.1.14"), null); // the retired binary name
  assert.equal(parseTanVersion("tan, version 0.8.1"), null); // click-style output
  assert.equal(parseTanVersion(""), null);
});

test("isCliBehind compares numeric version tuples", () => {
  assert.equal(isCliBehind("0.1.11", "0.1.14"), true);
  assert.equal(isCliBehind("0.1.14", "0.1.14"), false);
  assert.equal(isCliBehind("0.2.0", "0.1.14"), false);
  assert.equal(isCliBehind("1.0.0", "0.1.14"), false);
  assert.equal(isCliBehind(null, "0.1.14"), false); // unknown → not behind
});

test("isCliAhead compares numeric version tuples (mirror of isCliBehind)", () => {
  assert.equal(isCliAhead("0.1.11", "0.1.14"), false); // behind → not ahead
  assert.equal(isCliAhead("0.1.14", "0.1.14"), false); // equal → not ahead
  assert.equal(isCliAhead("0.2.0", "0.1.14"), true);
  assert.equal(isCliAhead("1.0.0", "0.1.14"), true);
  assert.equal(isCliAhead(null, "0.1.14"), false); // unknown → not ahead
});

test("decideBinarySource follows the resolution order", () => {
  // explicit cliPath always wins.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/tan",
      cliPathExists: true,
      onPath: true,
      bundledExists: true,
      cachedExists: true,
    }),
    "cliPath",
  );
  // a managed binary (bundled here) wins over a verified-native PATH `tan` —
  // PATH is a last resort, not a second choice, so a shell's shadowed/stale
  // `tan` can never override the extension's own binary.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/tan",
      cliPathExists: false,
      onPath: true,
      bundledExists: true,
      cachedExists: true,
    }),
    "bundled",
  );
  // no managed binary and no PATH `tan` → a cached download still wins over
  // triggering a fresh one.
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
  // nothing resolves at all → download-on-demand.
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

test("decideBinarySource: a local tan-cli build resolves before cached/download", () => {
  // A source checkout (no bundle, no network) resolves the built CLI instead of
  // failing with "tan CLI unavailable".
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: false,
      localBuildExists: true,
      cachedExists: false,
    }),
    "localBuild",
  );
  // ...but a bundle (platform VSIX) and PATH/cliPath still win over it.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: true,
      localBuildExists: true,
      cachedExists: false,
    }),
    "bundled",
  );
  // ...and a cached download loses to it.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: false,
      bundledExists: false,
      localBuildExists: false,
      cachedExists: true,
    }),
    "cached",
  );
});

test("decideBinarySource: bundled wins over cached/download/PATH but loses to cliPath", () => {
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
      cliPathSetting: "/x/tan",
      cliPathExists: true,
      onPath: false,
      bundledExists: true,
      cachedExists: true,
    }),
    "cliPath",
  );

  // a verified-native `tan` on PATH is a last resort: it no longer overrides
  // a managed bundled binary. PATH may be a stale/non-native `tan` in disguise
  // (see `isNativeTanVersionOutput`), so the extension prefers its own binary
  // whenever one is already available.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: true,
      bundledExists: true,
      cachedExists: true,
    }),
    "bundled",
  );
});

test("decideBinarySource: flag OFF (default) — a verified-native PATH tan is a last resort, pinning the exact default order cliPath > bundled > localBuild > cached > path > download", () => {
  // no cliPath, no bundled/localBuild/cached binary → PATH is all that's left,
  // so it's used ahead of triggering a network download.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: true,
      bundledExists: false,
      localBuildExists: false,
      cachedExists: false,
      preferGlobalCli: false,
    }),
    "path",
  );
  // ...but a cached binary (or bundled/localBuild) still wins over it.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: true,
      bundledExists: false,
      localBuildExists: false,
      cachedExists: true,
      preferGlobalCli: false,
    }),
    "cached",
  );
  // ...and localBuild wins over cached.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: true,
      bundledExists: false,
      localBuildExists: true,
      cachedExists: true,
      preferGlobalCli: false,
    }),
    "localBuild",
  );
  // ...and bundled wins over localBuild.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "",
      cliPathExists: false,
      onPath: true,
      bundledExists: true,
      localBuildExists: true,
      cachedExists: true,
      preferGlobalCli: false,
    }),
    "bundled",
  );
  // ...and an explicit, existing cliPath wins over everything, PATH included.
  assert.equal(
    decideBinarySource({
      cliPathSetting: "/x/tan",
      cliPathExists: true,
      onPath: true,
      bundledExists: true,
      localBuildExists: true,
      cachedExists: true,
      preferGlobalCli: false,
    }),
    "cliPath",
  );
});

test("decideBinarySource: flag ON (preferGlobalCli) — a verified-native PATH tan is promoted above bundled/localBuild/cached, but still loses to cliPath", () => {
  const base = {
    cliPathSetting: "",
    cliPathExists: false,
    onPath: true,
    preferGlobalCli: true,
  };

  // path beats cached.
  assert.equal(
    decideBinarySource({
      ...base,
      bundledExists: false,
      localBuildExists: false,
      cachedExists: true,
    }),
    "path",
  );
  // path beats bundled.
  assert.equal(
    decideBinarySource({
      ...base,
      bundledExists: true,
      localBuildExists: false,
      cachedExists: false,
    }),
    "path",
  );
  // path beats localBuild.
  assert.equal(
    decideBinarySource({
      ...base,
      bundledExists: false,
      localBuildExists: true,
      cachedExists: false,
    }),
    "path",
  );
  // path still loses to an explicit, existing cliPath.
  assert.equal(
    decideBinarySource({
      ...base,
      cliPathSetting: "/x/tan",
      cliPathExists: true,
      bundledExists: true,
      localBuildExists: true,
      cachedExists: true,
    }),
    "cliPath",
  );
  // flag on with onPath:false leaves the rest of the ladder unchanged (falls
  // straight through to bundled, same as flag off).
  assert.equal(
    decideBinarySource({
      ...base,
      onPath: false,
      bundledExists: true,
      localBuildExists: true,
      cachedExists: true,
    }),
    "bundled",
  );
  // ...and with nothing else available either, flag on + onPath:false still
  // falls through to download, same as flag off.
  assert.equal(
    decideBinarySource({
      ...base,
      onPath: false,
      bundledExists: false,
      localBuildExists: false,
      cachedExists: false,
    }),
    "download",
  );
});

test("resolutionInputFromDeps: the single seam both provisioning and resolution build BinaryResolutionInput from sets preferGlobalCli", () => {
  const deps = {
    cliPathSetting: "",
    fileExists: () => false,
    commandOnPath: () => true,
    bundledExists: false,
    localBuildBinaryPath: null,
    cachedBinaryPath: "/cache/tan",
    preferGlobalCli: true,
  };
  const input = resolutionInputFromDeps(deps);
  assert.equal(input.preferGlobalCli, true);
  assert.equal(input.onPath, true);

  const inputOff = resolutionInputFromDeps({ ...deps, preferGlobalCli: false });
  assert.equal(inputOff.preferGlobalCli, false);
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

test("releaseAssetForTarget mirrors the six tan-cli release targets (raw binary, v<version> tag)", () => {
  const linux = releaseAssetForTarget("linux", "x64");
  assert.equal(linux.target, "x86_64-unknown-linux-gnu");
  assert.equal(linux.tag, `v${SUPPORTED_CLI_VERSION}`);
  assert.equal(linux.assetName, "tan-x86_64-unknown-linux-gnu");
  assert.ok(
    linux.url.endsWith(
      `/alplabai/tan-cli/releases/download/v${SUPPORTED_CLI_VERSION}/tan-x86_64-unknown-linux-gnu`,
    ),
  );

  // arm64 Linux ships the gnu build (tan-cli's published aarch64 Linux target).
  assert.equal(
    releaseAssetForTarget("linux", "arm64").target,
    "aarch64-unknown-linux-gnu",
  );

  // both macOS arches are published (Intel + Apple Silicon).
  assert.equal(
    releaseAssetForTarget("darwin", "x64").target,
    "x86_64-apple-darwin",
  );
  assert.equal(
    releaseAssetForTarget("darwin", "arm64").target,
    "aarch64-apple-darwin",
  );

  // Windows ships BOTH x64 and arm64; the asset carries a `.exe` suffix.
  const winX64 = releaseAssetForTarget("win32", "x64");
  assert.equal(winX64.target, "x86_64-pc-windows-msvc");
  assert.equal(winX64.assetName, "tan-x86_64-pc-windows-msvc.exe");
  assert.equal(
    releaseAssetForTarget("win32", "arm64").target,
    "aarch64-pc-windows-msvc",
  );

  // A host with no published target (e.g. 32-bit ARM Linux) has no asset.
  assert.equal(releaseAssetForTarget("linux", "arm"), null);
});

test("binaryName is platform-specific", () => {
  assert.equal(binaryName("win32"), "tan.exe");
  assert.equal(binaryName("linux"), "tan");
  assert.equal(binaryName("darwin"), "tan");
});

test("isNativeTanVersionOutput accepts native clap output, rejects everything else", () => {
  // Native (Rust/clap): `tan <MAJOR.MINOR.PATCH>`.
  for (const out of [
    "tan 0.1.0",
    "tan 0.1.6\n",
    "tan 10.20.30",
    "tan 0.2.0 (abc1234)", // tolerate a future build-metadata suffix
    "  tan 0.1.0  ", // surrounding whitespace
    "tan 0.1.0\r\n", // CRLF
    "\ntan 0.1.0", // leading blank line
  ]) {
    assert.equal(
      isNativeTanVersionOutput(out),
      true,
      `expected native: ${JSON.stringify(out)}`,
    );
  }

  // A click-style `tan, version X` line does not emit the JSON envelope.
  for (const out of ["tan, version 0.8.1", "tan, version 0.8.1\n"]) {
    assert.equal(
      isNativeTanVersionOutput(out),
      false,
      `expected click-style rejected: ${JSON.stringify(out)}`,
    );
  }

  // Garbage / unrelated / partial / the retired `alp` name → not the native CLI.
  for (const out of [
    "",
    "   ",
    "alp 0.1.3", // the retired binary name
    "python 3.11.5",
    "tango 3.19", // must not partial-match the `tan` prefix
    "tan", // name only, no version
    "tan 0.1", // two components, not MAJOR.MINOR.PATCH
    "usage: tan [OPTIONS]", // help/error text
  ]) {
    assert.equal(
      isNativeTanVersionOutput(out),
      false,
      `expected rejected: ${JSON.stringify(out)}`,
    );
  }
});
