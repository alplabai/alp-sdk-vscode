// SPDX-License-Identifier: Apache-2.0
//
// Which release IS the resolved SDK? (the Hub badge / SDK Manager disagreement)
//
// ── The report ──────────────────────────────────────────────────────────────
//
// The sidebar badge read `v0.16.0` while the SDK Manager panel showed
// `v0.16.0-rc1` selected. Neither surface was wrong by its own source:
//
//   panel  -- the release whose install matched, by directory name
//   badge  -- `checkSdkReadiness().version`, i.e. metadata/sdk_version.yaml
//
// They disagree because the ARTEFACT does. Measured on a real install, one
// tree, two answers:
//
//   $ git -C ~/.alp/sdk/v0.16.0-rc1 describe --tags   ->  v0.16.0-rc1
//   $ python3 -c "... from alp_cli import __version__" ->  0.16.0
//
// An RC's metadata names the release it is a CANDIDATE for. Systematic, not one
// bad tag -- `v0.15.0-rc1` declares `0.15.0` too, so an rc and its GA declare
// the SAME string and are indistinguishable from inside the checkout. Filed
// upstream as alp-sdk#1902.
//
// ── Why the fix is a rule this repo already wrote ──────────────────────────
//
// #593 hit the same artefact defect one surface over: the `v0.16.0` release row
// bound to the `v0.16.0-rc1` install, both rows showed Active off one entry,
// and Remove on a row labelled `v0.16.0` would have deleted `v0.16.0-rc1`.
// `sdkRows.ts` fixed it and stated the rule -- "the directory name is the
// AUTHORITATIVE answer to 'which release is this?' and the version-metadata
// fallback must not override it".
//
// The badge never learned that rule. `sdkIdentityVersion` is it, applied at the
// producer so every reader of the resolved SDK's version gets the same answer.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  sdkIdentityVersion,
  looksLikeVersionDir,
} = require("../packages/alp-core/dist/sdk/service.js");

// ---------------------------------------------------------------------------
// The reported case
// ---------------------------------------------------------------------------

test("an rc install is named by its directory, not by what it declares", () => {
  assert.equal(
    sdkIdentityVersion("/home/dev/.alp/sdk/v0.16.0-rc1", "0.16.0"),
    "0.16.0-rc1",
    "the badge said v0.16.0 while the panel said v0.16.0-rc1; the install IS " +
      "the rc, and its metadata naming the GA is the artefact's defect " +
      "(alp-sdk#1902), not a fact about which SDK is active",
  );
});

test("a GA install is unchanged, so the fix costs the common case nothing", () => {
  assert.equal(
    sdkIdentityVersion("/home/dev/.alp/sdk/v0.16.0", "0.16.0"),
    "0.16.0",
  );
});

test("the rc and its GA no longer collapse to one answer", () => {
  const rc = sdkIdentityVersion("/home/dev/.alp/sdk/v0.16.0-rc1", "0.16.0");
  const ga = sdkIdentityVersion("/home/dev/.alp/sdk/v0.16.0", "0.16.0");
  assert.notEqual(
    rc,
    ga,
    "both declare `0.16.0`, so reading the declaration alone makes two " +
      "different installs indistinguishable — which is the whole report",
  );
});

// ---------------------------------------------------------------------------
// Rule 2: what a checkout with no tag-shaped name needs
// ---------------------------------------------------------------------------

test("a sibling checkout falls back to what the SDK declares", () => {
  assert.equal(
    sdkIdentityVersion("/home/dev/projects/alp-sdk", "0.16.0"),
    "0.16.0",
    "`alp-sdk` names no release, so the declared version is all there is — " +
      "the same fallback `installedFor`'s rule 2 exists for",
  );
});

test("no directory hint and no declaration answers null, never a guess", () => {
  assert.equal(sdkIdentityVersion("/home/dev/projects/alp-sdk", null), null);
});

test("a trailing separator does not hide the directory name", () => {
  assert.equal(
    sdkIdentityVersion("/home/dev/.alp/sdk/v0.16.0-rc1/", "0.16.0"),
    "0.16.0-rc1",
  );
});

test("a Windows path is read the same way", () => {
  assert.equal(
    sdkIdentityVersion("C:\\Users\\dev\\.alp\\sdk\\v0.16.0-rc1", "0.16.0"),
    "0.16.0-rc1",
    "`sdkPath` is toPosix'd in `resolveProjectContext`, but this function is " +
      "handed raw paths elsewhere and must not depend on which separator won",
  );
});

// ---------------------------------------------------------------------------
// The hand-mirror
// ---------------------------------------------------------------------------

test("core and the webview agree on what a version directory looks like", () => {
  // `packages/alp-webview` does not import `@alp-sdk/core` — it mirrors it by
  // hand, on purpose. So this predicate exists twice and can drift apart.
  //
  // Compared by extracting the REGEX LITERAL from each side, not by eval'ing a
  // function body out of source text and not by diffing the whole function: a
  // regex literal has no insignificant whitespace, so string equality on it is
  // exact, and it is the only part that decides the answer.
  const literalOf = (rel) => {
    const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf-8");
    const fn =
      /export function looksLikeVersionDir\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(
        src,
      );
    assert.ok(fn, `${rel}'s \`looksLikeVersionDir\` moved or was renamed`);
    const lit = /(\/\^[^\n]*?\/)\s*\.test\(/.exec(fn[1]);
    assert.ok(lit, `could not read a regex literal from ${rel}:\n${fn[1]}`);
    return lit[1];
  };

  const core = literalOf("packages/alp-core/src/sdk/service.ts");
  const webview = literalOf("packages/alp-webview/src/shared/sdkRows.ts");
  assert.equal(
    webview,
    core,
    "the SDK Manager panel and the Hub badge would answer the same question " +
      "differently again — which is the defect this file exists for. Update " +
      "both, or make one import the other if the package boundary ever allows " +
      "it.",
  );

  // And that the shared literal actually classifies the cases that matter,
  // so two identical-but-wrong copies still fail.
  for (const [name, expected] of [
    ["v0.16.0-rc1", true],
    ["v0.16.0", true],
    ["0.16.0-rc1", true],
    ["v1.2.3+build.4", true],
    ["alp-sdk", false],
    ["sdk", false],
    ["v0.16", false],
    ["", false],
  ]) {
    assert.equal(looksLikeVersionDir(name), expected, `"${name}"`);
  }
});

// ---------------------------------------------------------------------------
// The class, not the instance
// ---------------------------------------------------------------------------

test("no host file renders checkSdkReadiness's version without resolving identity", () => {
  // The risk worth gating is not "someone reverts one line". It is a NEW
  // surface reading `checkSdkReadiness().version` and repeating the defect --
  // which is exactly how this one happened: `installedFor` learned the rule in
  // #593 and the Hub badge, written earlier, never did.
  //
  // So the sites are DISCOVERED, not listed. A hand-written allowlist that
  // shrinks is invisible to the test that reads it.
  //
  // `src/sdk/activeSdk.ts` calls `checkSdkReadiness` and is deliberately NOT
  // caught: it reads `report.state` and `report.issues` and never the version,
  // so it has nothing to resolve. That is why the condition is "reads a
  // version", not "calls the probe".
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.isFile() && full.endsWith(".ts") ? [full] : [];
    });

  const root = path.join(__dirname, "..", "src");
  const offenders = [];
  let readers = 0;
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, "utf-8");
    if (!src.includes("checkSdkReadiness(")) continue;
    // The result is bound to a name and the version read off it. Both current
    // readers spell it `report.version` / `readiness.version`; the pattern is
    // deliberately loose so a third spelling is still caught.
    if (!/\b\w+\.version\b/.test(src)) continue;
    readers += 1;
    if (!src.includes("sdkIdentityVersion")) {
      offenders.push(path.relative(root, file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(", ")} reads a version off \`checkSdkReadiness\` without ` +
      "passing it through `sdkIdentityVersion`.\n\n" +
      "That value is what the SDK declares about ITSELF, and an RC declares " +
      "the release it is a candidate for (alp-sdk#1902) — so an rc install " +
      "renders as its GA and the surface disagrees with the SDK Manager " +
      "panel, which resolves identity correctly.",
  );
  assert.ok(
    readers >= 2,
    `only ${readers} version-reading site(s) found — the scan stopped seeing ` +
      "the files it exists to check, and an empty sweep satisfies the " +
      "assertion above perfectly",
  );
});

// ---------------------------------------------------------------------------
// The gate is not vacuous
// ---------------------------------------------------------------------------

test("the predicate really does separate version names from ordinary ones", () => {
  assert.equal(looksLikeVersionDir("v0.16.0-rc1"), true);
  assert.equal(looksLikeVersionDir("alp-sdk"), false);
});
