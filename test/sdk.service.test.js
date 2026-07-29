const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isSdkVersionBelowMin,
  listLocalSdkEntries,
  MIN_SDK_VERSION,
} = require("../packages/alp-core/dist/sdk/service.js");

test("flags SDKs older than the supported floor", () => {
  assert.equal(isSdkVersionBelowMin("0.8.1"), true);
  assert.equal(isSdkVersionBelowMin("0.9.0"), true);
  assert.equal(isSdkVersionBelowMin("v0.9.0"), true); // tolerates a leading v
});

test("accepts the floor and newer", () => {
  assert.equal(isSdkVersionBelowMin(MIN_SDK_VERSION), false);
  assert.equal(isSdkVersionBelowMin("0.10.1"), false);
  assert.equal(isSdkVersionBelowMin("0.11.0"), false);
  assert.equal(isSdkVersionBelowMin("1.0.0"), false);
});

test("treats null/unparseable as unknown, not behind", () => {
  // A dev checkout's metadata/sdk_version.yaml can lag the tag; never mis-flag.
  assert.equal(isSdkVersionBelowMin(null), false);
  assert.equal(isSdkVersionBelowMin("0.11.0-rc1"), false);
  assert.equal(isSdkVersionBelowMin("garbage"), false);
});

// #361: `path.resolve` does not fold case, so a hand-typed `alpSdk.path` seeded
// as a search root used to list the SAME SDK a second time whenever its casing
// differed from what discovery produced. De-dup keys on the canonical form.
test("listLocalSdkEntries de-dups one SDK reached under two casings on win32", () => {
  // Forward slashes on purpose: `listLocalSdkEntries` calls the HOST's
  // `path.resolve`, so a backslash fixture would mean different things on the
  // Windows dev box and the Linux CI runner. These two differ only in case.
  const roots = [
    "C:/Users/Me/.alp/sdk/v0.13.0",
    "c:/users/me/.alp/sdk/v0.13.0",
  ];
  const entries = listLocalSdkEntries(
    roots,
    () => true, // every probe (loader script, readiness) succeeds
    () => "0.13.0",
    () => [],
    "win32",
  );
  assert.equal(entries.length, 1);
});

// The same two strings ARE two directories on a case-sensitive filesystem.
test("listLocalSdkEntries keeps case-distinct roots separate off win32", () => {
  const entries = listLocalSdkEntries(
    ["/home/me/.alp/sdk/V0.13.0", "/home/me/.alp/sdk/v0.13.0"],
    () => true,
    () => "0.13.0",
    () => [],
    "linux",
  );
  assert.equal(entries.length, 2);
});
