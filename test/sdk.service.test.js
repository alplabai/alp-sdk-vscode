const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isSdkVersionBelowMin,
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
