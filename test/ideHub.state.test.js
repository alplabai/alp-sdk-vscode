// SPDX-License-Identifier: Apache-2.0

const test = require("node:test");
const assert = require("node:assert");
const { emptyAlpIdeState } = require("../out/ideHub/messages.js");

test("emptyAlpIdeState seeds tan as null", () => {
  const s = emptyAlpIdeState();
  assert.strictEqual(s.setup.toolVersions.tan, null);
  assert.ok("tan" in s.setup.toolVersions);
});
