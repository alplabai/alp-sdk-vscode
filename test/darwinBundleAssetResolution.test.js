// SPDX-License-Identifier: Apache-2.0
//
// The darwin-arm64 bundled-CLI asset name is resolved in exactly ONE place:
// `releaseAssetForTarget` + `resolvePublishedAsset` (src/alpCli/service.ts,
// download.ts), reached via `scripts/stage-tan-cli-asset.mjs`. Before this
// test existed, `release-vsix.yml`'s `package_darwin_arm64` job and
// `ci.yml`'s darwin smoke step each hand-rolled their OWN
// `tan-aarch64-apple-darwin` URL — a THIRD writer of the same asset-name
// convention `scripts/check-cli-pin.mjs` already probes via
// `releaseAssetForTarget`. When tan-cli#349 moved the asset to an archive,
// that third writer never moved with it: `check-cli-pin.mjs` stayed green
// (it checks both the raw and archive candidate names), while both
// workflows' own hardcoded raw-name URL 404'd — fatally in the release job,
// silently (read as "not published yet") in the CI smoke test.
//
// This test does not re-verify the resolution logic itself (that is
// `test/cliPin.prerelease.test.js` and the `alpCli.download*.test.js` suite)
// — it pins the STRUCTURAL fix: both workflows call the shared script for the
// darwin/arm64 asset, and neither reintroduces its own literal asset URL.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf-8");

const WORKFLOWS = [
  ".github/workflows/release-vsix.yml",
  ".github/workflows/ci.yml",
];

// The exact antipattern that drifted: a `tan-<triple>` (or `.exe`) literal
// built into a URL/variable assignment by hand, rather than resolved through
// `releaseAssetForTarget`. Matches the raw OR archive spelling, so "someone
// updated the extension to just the archive name" would trip this too — the
// fix is routing through the resolver, not memorising a second name.
const HARDCODED_ASSET_URL = /tan-aarch64-apple-darwin(\.tar\.gz|\.exe)?["'\s]/;

test("release-vsix.yml and ci.yml resolve the darwin/arm64 asset through stage-tan-cli-asset.mjs, not a hardcoded name", () => {
  for (const workflow of WORKFLOWS) {
    const contents = read(workflow);
    assert.match(
      contents,
      /node scripts\/stage-tan-cli-asset\.mjs/,
      `${workflow} no longer stages the darwin CLI via scripts/stage-tan-cli-asset.mjs — ` +
        `if the mechanism genuinely changed, update this test alongside it; otherwise this ` +
        `is the #463-class drift returning.`,
    );
    assert.doesNotMatch(
      contents,
      HARDCODED_ASSET_URL,
      `${workflow} embeds a literal tan-aarch64-apple-darwin asset name outside ` +
        `scripts/stage-tan-cli-asset.mjs — that is a second writer of the asset-name ` +
        `convention, which is exactly how the stale-URL defect happened. Resolve it via ` +
        `releaseAssetForTarget instead (see scripts/stage-tan-cli-asset.mjs).`,
    );
  }
});

test("scripts/stage-tan-cli-asset.mjs resolves the asset via releaseAssetForTarget + resolvePublishedAsset, not a hardcoded name", () => {
  const contents = read("scripts/stage-tan-cli-asset.mjs");
  assert.match(contents, /releaseAssetForTarget/);
  assert.match(contents, /resolvePublishedAsset/);
  assert.doesNotMatch(
    contents,
    HARDCODED_ASSET_URL,
    "scripts/stage-tan-cli-asset.mjs itself must not hardcode the asset name — " +
      "that reintroduces the exact bug it exists to close.",
  );
});
