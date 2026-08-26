// SPDX-License-Identifier: Apache-2.0
//
// A release row must bind to the install that IS that release, or to none
// (#593).
//
// Observed on a real machine: `~/.alp/sdk/` held exactly one SDK,
// `v0.16.0-rc1`, and the SDK Manager showed BOTH `v0.16.0` and `v0.16.0-rc1`
// as Active. Pressing Deactivate on either cleared the same pointer and both
// went inactive.
//
// The cause is in the matcher, not in the host: an entry's `version` is the
// SDK's own metadata, and an RC reports the release it is a candidate for.
// `~/.alp/sdk/v0.16.0-rc1` reports `0.16.0`, so the version arm answered for
// the `v0.16.0` tag as well as the directory arm answering for `v0.16.0-rc1`.
// Both rows then carried the same `localPath` — which is what Remove deletes,
// so Remove on a row labelled `v0.16.0` would have deleted `v0.16.0-rc1`.
//
// The rule lives in `shared/sdkRows.ts` because it could not be asked a
// question while it lived inside the component: that is why this shipped.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

function loadTs(rel) {
  const file = path.join(__dirname, "..", rel);
  const { code } = esbuild.transformSync(fs.readFileSync(file, "utf8"), {
    loader: "ts",
    format: "cjs",
  });
  const mod = new Module(file, null);
  mod.filename = file;
  mod._compile(code, file);
  return mod.exports;
}

const { buildRows, installedFor, looksLikeVersionDir } = loadTs(
  "packages/alp-webview/src/shared/sdkRows.ts",
);

const release = (tag, publishedAt) => ({
  tag,
  publishedAt,
  releaseNotes: "",
  releaseNotesSummary: "",
});

/** The machine this was reported from: ONE install, an RC, reporting the
 *  release version it is a candidate for. */
const RC_ONLY = [
  {
    path: "/Users/hakan/.alp/sdk/v0.16.0-rc1",
    version: "0.16.0",
    active: true,
    activeSource: "pinned",
    removable: true,
    readiness: "ready",
    issues: [],
  },
];

test("a stable release does not bind to the prerelease install", () => {
  const rows = buildRows(
    [release("v0.16.0", "2026-08-23"), release("v0.16.0-rc1", "2026-08-15")],
    RC_ONLY,
  );
  const stable = rows.find((r) => r.id === "v0.16.0");
  const rc = rows.find((r) => r.id === "v0.16.0-rc1");

  assert.equal(
    stable.isActive,
    false,
    "v0.16.0 is shown as Active while the only install on disk is " +
      "v0.16.0-rc1. Two rows Active off one entry is the reported symptom.",
  );
  assert.equal(
    stable.localPath,
    undefined,
    "v0.16.0 carries the rc1 install's path. That path is what Remove " +
      "deletes, so Remove on a row labelled v0.16.0 would delete v0.16.0-rc1.",
  );
  assert.equal(
    stable.installTag,
    "v0.16.0",
    "v0.16.0 is not offered for install. It is not on disk, so Install is " +
      "the only honest action for that row.",
  );
  assert.equal(stable.source, "available");

  assert.equal(rc.isActive, true, "the install that IS active lost its badge");
  assert.equal(rc.localPath, "/Users/hakan/.alp/sdk/v0.16.0-rc1");
  assert.equal(rc.source, "installed");
});

test("one install answers for at most one release", () => {
  const rows = buildRows([release("v0.16.0"), release("v0.16.0-rc1")], RC_ONLY);
  const bound = rows.filter(
    (r) => r.localPath === "/Users/hakan/.alp/sdk/v0.16.0-rc1",
  );
  assert.equal(
    bound.length,
    1,
    "two rows share one install path. They then share its Active state and " +
      "its destructive actions, which is the same defect by another route.",
  );
});

test("a version-named directory outranks the SDK's own version metadata", () => {
  const entry = {
    path: "/x/v0.15.0",
    version: "0.16.0", // metadata disagreeing with the directory
    active: false,
    removable: true,
    readiness: "ready",
    issues: [],
  };
  assert.equal(
    installedFor("v0.16.0", [entry]),
    undefined,
    "a directory named v0.15.0 answered for the v0.16.0 tag on the strength " +
      "of its metadata. The installer names the directory after the tag, so " +
      "the directory is the authoritative answer.",
  );
  assert.equal(installedFor("v0.15.0", [entry]), entry);
});

test("the version fallback still serves installs not named after a tag", () => {
  const checkout = {
    path: "/home/dev/alp-sdk",
    version: "0.16.0",
    active: false,
    removable: false,
    readiness: "ready",
    issues: [],
  };
  assert.equal(
    installedFor("v0.16.0", [checkout]),
    checkout,
    "a sibling checkout whose directory is not a version can only be matched " +
      "by its reported version — removing that fallback would list it as a " +
      "second, unrelated row.",
  );
});

test("an already-claimed install is not offered to a later release", () => {
  const entry = {
    path: "/home/dev/alp-sdk",
    version: "0.16.0",
    active: false,
    removable: false,
    readiness: "ready",
    issues: [],
  };
  assert.equal(
    installedFor("v0.16.0", [entry], new Set([entry.path])),
    undefined,
  );
});

test("an install with no matching release still gets its own row", () => {
  const rows = buildRows([release("v0.15.0")], RC_ONLY);
  const own = rows.find((r) => r.id === "/Users/hakan/.alp/sdk/v0.16.0-rc1");
  assert.ok(own, "the installed SDK vanished from the list entirely");
  assert.equal(own.isActive, true);
  assert.equal(own.source, "installed");
});

test("version-shaped directory names are told from other names", () => {
  for (const yes of ["v0.16.0", "0.16.0", "v1.2.3-rc1", "0.1.0+build.5"]) {
    assert.equal(looksLikeVersionDir(yes), true, `${yes} is a version`);
  }
  for (const no of ["alp-sdk", "sdk", "main", "v0.16", "checkout-0.16.0"]) {
    assert.equal(looksLikeVersionDir(no), false, `${no} is not a version`);
  }
});
