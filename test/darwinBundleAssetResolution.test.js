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
//
// Two gaps found by review, both fixed here:
//
// 1. The invocation check used to be `/node scripts\/stage-tan-cli-asset\.mjs/`
//    with no anchor, so it matched the string ANYWHERE in the file — including
//    a comment. Replacing the real call with a hardcoded `curl` download and
//    leaving behind a `# replaces: node scripts/stage-tan-cli-asset.mjs`
//    breadcrumb removed every real invocation and still passed. It is now
//    anchored to the start of a shell line (`^[ \t]*node scripts/...`, `m`
//    flag), which only a real `run:` step body satisfies — a `#`-prefixed
//    comment mentioning the same text does not. It also accepts the same
//    invocation written as an inline `run: node scripts/stage-tan-cli-
//    asset.mjs …` (no leading block-scalar body, `run:` and the command on
//    one line) — a legitimate reflow that collapsing a `run: |` block into a
//    single-line step would produce — without reopening the comment hole
//    above: the pattern still requires `node scripts/…` to sit immediately
//    after only whitespace or a literal `run:` prefix, so a `#`-prefixed
//    comment (even one that itself contains the text `run: node scripts/
//    stage-tan-cli-asset.mjs`) still cannot satisfy it.
//
// 2. `HARDCODED_ASSET_URL` only ever covered `aarch64-apple-darwin`, so a
//    hand-rolled `tan-x86_64-unknown-linux-gnu` URL was invisible to it, and
//    its trailing-boundary-only check (`["'\s]` with nothing required before
//    the match) meant a plain, unbackticked comment mention of the name — no
//    quotes, no path — would have tripped it as a false positive. It now
//    requires ALL SIX triples `src/alpCli/service.ts`'s `TARGETS` declares,
//    and requires the match be preceded by a quote or a path separator (`/`)
//    — i.e. actually used as a value, not just named in prose. A markdown/
//    comment mention (backtick-fenced or not) has neither before the name, so
//    it no longer trips this. Documented residual gap: a triple assembled
//    from a shell variable (`T=aarch64-apple-darwin; URL=".../tan-${T}"`)
//    never spells the full name as one literal token and is NOT caught —
//    catching that needs parsing the shell, not a text regex.

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

// Anchored to the start of a (whitespace-indented) shell line, `m` flag so
// `^`/no-`^` apply per line, optionally preceded by an inline `run:` prefix
// (`run: node scripts/…`) for a step whose body was collapsed onto one line.
// A `run: |` block body is shell, so its lines start with indentation then
// the command; a YAML/shell `#` comment starts with `#`, never with `run:`
// or `node`, so it cannot satisfy this even if it quotes the exact
// invocation text — including the inline `run:` form — elsewhere on the
// line.
const REAL_INVOCATION =
  /^[ \t]*(?:run:[ \t]*)?node scripts\/stage-tan-cli-asset\.mjs\b/m;

// tan-cli publishes (or has published) an asset per triple in `TARGETS`
// (src/alpCli/service.ts) — see that file for why each is there (gnu vs musl,
// which hosts a Python release skips this tag, etc). This list is the same
// six; a triple hardcoded for any one of them is the same class of bug the
// darwin/arm64 one was.
const TAN_CLI_TARGET_TRIPLES = [
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-musl",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
];

// The exact antipattern that drifted: a `tan-<triple>` (optionally `.tar.gz`/
// `.zip`/`.exe`) literal built into a URL/variable assignment by hand, rather
// than resolved through `releaseAssetForTarget`. Requires a quote or a path
// separator immediately before the name (an actual embedded/quoted value —
// what a URL or a shell string literal looks like) so a bare prose mention
// (backtick-fenced or not) does not trip it. See the residual-gap note above
// the imports for what this deliberately does not catch.
const HARDCODED_ASSET_URL = new RegExp(
  `["'/]tan-(?:${TAN_CLI_TARGET_TRIPLES.join("|")})(?:\\.tar\\.gz|\\.zip|\\.exe)?["'\\s]`,
);

test("release-vsix.yml and ci.yml resolve the darwin/arm64 asset through stage-tan-cli-asset.mjs, not a hardcoded name", () => {
  for (const workflow of WORKFLOWS) {
    const contents = read(workflow);
    assert.match(
      contents,
      REAL_INVOCATION,
      `${workflow} no longer stages the darwin CLI via scripts/stage-tan-cli-asset.mjs — ` +
        `if the mechanism genuinely changed, update this test alongside it; otherwise this ` +
        `is the #463-class drift returning (a comment merely mentioning the script name does ` +
        `not count — this must be a real run-step line).`,
    );
    assert.doesNotMatch(
      contents,
      HARDCODED_ASSET_URL,
      `${workflow} embeds a literal hardcoded tan-cli asset name outside ` +
        `scripts/stage-tan-cli-asset.mjs — that is a second writer of the asset-name ` +
        `convention, which is exactly how the stale-URL defect happened. Resolve it via ` +
        `releaseAssetForTarget instead (see scripts/stage-tan-cli-asset.mjs).`,
    );
  }
});

test("REAL_INVOCATION accepts an inline `run:` refactor but still rejects a comment merely naming the invocation", () => {
  // The legitimate refactor this anchor must not false-red: a step whose
  // `run: |` block body collapses to a single inline command.
  const inlineRunStep =
    "      - name: Download + stage the aarch64-apple-darwin tan binary\n" +
    '        run: node scripts/stage-tan-cli-asset.mjs --platform darwin --arch arm64 --dest bin --version "1.2.3"\n';
  assert.match(
    inlineRunStep,
    REAL_INVOCATION,
    "REAL_INVOCATION must accept an inline `run: node scripts/stage-tan-cli-asset.mjs …` step " +
      "body, not only the multi-line `run: |` block form.",
  );

  // The regression this anchor exists to close: the real call replaced by a
  // hardcoded download, with a comment breadcrumb naming the script it
  // replaced — that comment must NOT satisfy the invocation check even
  // though it contains the exact same text an inline `run:` step would.
  const commentSubstitution =
    "      - name: Download + stage the aarch64-apple-darwin tan binary\n" +
    "        # replaces: node scripts/stage-tan-cli-asset.mjs\n" +
    "        run: |\n" +
    '          curl -fsSL -o bin/tan "https://example.invalid/tan"\n';
  assert.doesNotMatch(
    commentSubstitution,
    REAL_INVOCATION,
    "REAL_INVOCATION must not be satisfied by a comment that merely names the script it " +
      "replaced — this is the #463-class regression the anchor exists to catch.",
  );
});

test("HARDCODED_ASSET_URL guards every tan-cli target triple, not just darwin/arm64, and ignores prose mentions", () => {
  for (const triple of TAN_CLI_TARGET_TRIPLES) {
    for (const suffix of ["", ".tar.gz", ".zip", ".exe"]) {
      const seeded = `          URL="https://github.com/alplabai/tan-cli/releases/download/v0.5.1/tan-${triple}${suffix}"\n`;
      assert.ok(
        HARDCODED_ASSET_URL.test(seeded),
        `HARDCODED_ASSET_URL does not catch a hardcoded tan-${triple}${suffix} URL — ` +
          `every TAN_CLI_TARGET_TRIPLES entry must be covered, not just darwin/arm64.`,
      );
    }
  }

  // A plain-text or backtick-fenced comment NAMING the asset (documentation,
  // not a value being assigned/interpolated) must not trip the gate — this is
  // the false-positive release-vsix.yml:30-31 depends on staying green even if
  // its backticks are ever dropped.
  const proseMentions = [
    "# through v0.5.0-rc4 that was a RAW tan-aarch64-apple-darwin binary; from the\n",
    "# archive freeze (tan-cli#349) on, it is a tan-aarch64-apple-darwin.tar.gz onedir tree\n",
    "# through v0.5.0-rc4 that was a RAW `tan-aarch64-apple-darwin` binary; from the\n",
    "# archive freeze (tan-cli#349) on, it is a `tan-aarch64-apple-darwin.tar.gz`\n",
  ];
  for (const prose of proseMentions) {
    assert.ok(
      !HARDCODED_ASSET_URL.test(prose),
      `HARDCODED_ASSET_URL false-positives on a prose mention: ${JSON.stringify(prose)}`,
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
