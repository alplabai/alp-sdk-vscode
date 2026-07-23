const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  westWorkspaceCandidates,
} = require("../out/environment/vscodeAdapter.js");

test("westWorkspaceCandidates offers <sdk-parent> (the v0.11 bootstrap topdir)", () => {
  const sdkRoot = path.join(path.sep, "opt", "alp", "sdk");
  const sdkParent = path.dirname(sdkRoot);
  const candidates = westWorkspaceCandidates(null, sdkRoot);

  assert.ok(
    candidates.includes(sdkParent),
    "<sdk-parent> must be a candidate topdir",
  );
  // Must precede the legacy isolated layout, mirroring the Rust half's order.
  assert.ok(
    candidates.indexOf(sdkParent) <
      candidates.indexOf(path.join(sdkParent, "zephyrproject")),
    "<sdk-parent> must precede <sdk-parent>/zephyrproject",
  );
});
