// SPDX-License-Identifier: Apache-2.0
//
// `SUPPORTED_CLI_VERSION` must be able to name a tan PRERELEASE (#443).
//
// Why a test and not just a wider regex: the defect was a plain `string`
// constant parsed by hand-written patterns in CI shell and in a script — three
// copies, none of them type-checked, none of them exercised by anything. A pin
// of `0.5.0-rc1` compiled, passed every existing test, and only failed at
// release time in the darwin packaging job. So this file drives the ACTUAL
// patterns, read out of the ACTUAL files, against prerelease fixtures.
//
// Two hazards it covers, and the second is the one that bites quietly:
//
//   1. the pattern REJECTS a prerelease   -> `VERSION` is empty, `::error::`,
//      a loud failure on a tag already pushed;
//   2. the pattern TRUNCATES a prerelease -> the shell sites pipe one grep into
//      another, so widening only the first yields `0.5.0` from `0.5.0-rc1` — a
//      silently WRONG version, which bundles/downloads a different tan than the
//      pin names. Loud beats silent; this asserts the whole pipeline's output
//      equals the full version, suffix included.
//
// `0.4.0-rc1` is not a made-up fixture: it is a published `alplabai/tan-cli`
// tag, and `rc1` (no dot) is the form tan actually uses, so both `rc1` and the
// SemVer-canonical `rc.1` are covered.
//
// This does NOT assert what the pin IS — moving it is a separate decision
// (#446). It asserts only that a prerelease value would survive resolution.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { releaseAssetForTarget } = require("../out/alpCli/service.js");

const root = path.join(__dirname, "..");

/** Every version shape the pin may legitimately take. The two stable ones are
 *  here so a fix for the prerelease case cannot regress the case that worked. */
const VERSIONS = ["0.4.1", "0.5.0", "0.5.0-rc1", "0.5.0-rc.1", "0.4.0-rc1"];

/** The declaration line each site greps for, exactly as it appears in
 *  src/alpCli/service.ts. */
const declaration = (version) =>
  `export const SUPPORTED_CLI_VERSION = "${version}";`;

/** Files that resolve the pin by pattern. Listed rather than globbed so a site
 *  that stops resolving the pin fails here loudly instead of dropping out of
 *  coverage unnoticed. */
const SITES = [
  ".github/workflows/ci.yml",
  ".github/workflows/release-vsix.yml",
  "scripts/fetch-tan-contract.mjs",
];

const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf-8").split(/\r?\n/);

/**
 * Every `SUPPORTED_CLI_VERSION = "<pattern>"` occurrence in `lines`, whether it
 * came from a shell `grep -oE '…'` or a JS regex literal — the quoted construct
 * is byte-identical in both, only the wrapping differs.
 */
function pinPatterns(lines) {
  const found = [];
  lines.forEach((line, index) => {
    const match = /SUPPORTED_CLI_VERSION = "([^"\n]+)"/.exec(line);
    if (match) found.push({ pattern: match[0], line, lineNo: index + 1 });
  });
  return found;
}

test("every pin-resolution site accepts a prerelease SUPPORTED_CLI_VERSION", () => {
  for (const site of SITES) {
    const sites = pinPatterns(read(site));
    assert.ok(
      sites.length > 0,
      `${site} no longer resolves SUPPORTED_CLI_VERSION by pattern — if that is ` +
        `deliberate (e.g. it imports the constant now), drop it from SITES; ` +
        `otherwise this test has stopped covering it.`,
    );

    for (const { pattern, lineNo } of sites) {
      for (const version of VERSIONS) {
        const matched = new RegExp(pattern).exec(declaration(version));
        assert.ok(
          matched,
          `${site}:${lineNo} rejects the pin "${version}" — resolution yields ` +
            `the empty string, which is the #443 release-time failure. Pattern: ${pattern}`,
        );
        // match[0], not a capture group: the shell sites have no group and the
        // script site wraps the whole version in one. The construct that had to
        // match is the same either way.
        assert.equal(
          matched[0],
          `SUPPORTED_CLI_VERSION = "${version}"`,
          `${site}:${lineNo} matched only part of the pin "${version}" — a ` +
            `truncated version resolves to a DIFFERENT tan release than the pin names.`,
        );
      }
    }
  }
});

test("the shell sites' two-grep pipeline keeps the prerelease suffix", () => {
  // `VERSION=$(grep -oE '<match>' … | grep -oE '<extract>')`: the second grep is
  // what actually produces the value, so it has to be as wide as the first.
  // Simulated rather than shelled out — `node --test` runs on Windows in CI too,
  // where spawning bash is not a given.
  const pipeline =
    /grep -oE '(SUPPORTED_CLI_VERSION = "[^']+)' [^|]+\| grep -oE '([^']+)'/;

  for (const site of SITES.filter((s) => s.endsWith(".yml"))) {
    const lines = read(site);
    const steps = lines
      .map((line, index) => ({ match: pipeline.exec(line), lineNo: index + 1 }))
      .filter((entry) => entry.match);

    assert.ok(
      steps.length > 0,
      `${site} has no grep pipeline resolving the pin any more — see the note in SITES.`,
    );

    for (const { match, lineNo } of steps) {
      const [, matchPattern, extractPattern] = match;
      for (const version of VERSIONS) {
        const line = new RegExp(matchPattern).exec(declaration(version))?.[0];
        assert.ok(line, `${site}:${lineNo} first grep rejects "${version}"`);
        assert.equal(
          new RegExp(extractPattern).exec(line)?.[0],
          version,
          `${site}:${lineNo} second grep does not extract "${version}" whole — ` +
            `it resolves a version the pin never named.`,
        );
      }
    }
  }
});

test("a prerelease pin round-trips into a real tan-cli release URL", () => {
  // v0.4.0-rc1 is PUBLISHED (as a raw binary — pre-dates tan-cli#349), so this
  // URL is the live one, not a shape guess.
  const asset = releaseAssetForTarget("darwin", "arm64", "0.4.0-rc1");

  assert.equal(asset.tag, "v0.4.0-rc1");
  // [raw, archive] — see `ReleaseAsset.candidates`'s doc (#463).
  assert.equal(asset.candidates[0].assetName, "tan-aarch64-apple-darwin");
  assert.equal(
    asset.candidates[0].url,
    "https://github.com/alplabai/tan-cli/releases/download/v0.4.0-rc1/tan-aarch64-apple-darwin",
  );
  assert.equal(
    asset.candidates[1].assetName,
    "tan-aarch64-apple-darwin.tar.gz",
  );
  assert.equal(
    asset.checksumsUrl,
    "https://github.com/alplabai/tan-cli/releases/download/v0.4.0-rc1/checksums.txt",
  );

  // The Windows RAW candidate carries `.exe`, and the suffix must not disturb
  // that — this is the one target where the name is not just the triple. Its
  // ARCHIVE candidate carries `.zip`, never `.tar.gz`.
  const winX64 = releaseAssetForTarget("win32", "x64", "0.5.0-rc.1");
  assert.equal(
    winX64.candidates[0].url,
    "https://github.com/alplabai/tan-cli/releases/download/v0.5.0-rc.1/tan-x86_64-pc-windows-msvc.exe",
  );
  assert.equal(
    winX64.candidates[1].url,
    "https://github.com/alplabai/tan-cli/releases/download/v0.5.0-rc.1/tan-x86_64-pc-windows-msvc.zip",
  );
});
