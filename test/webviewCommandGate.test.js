// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert");
const {
  classifyWebviewCommand,
} = require("../out/ideHub/webviewCommandGate.js");

test("non-allowlisted command is refused", () => {
  const v = classifyWebviewCommand("alp.somethingEvil");
  assert.deepEqual(v, { ok: false, reason: "not-allowlisted" });
});

test("allowlisted non-build command runs regardless of buildReady", () => {
  assert.deepEqual(classifyWebviewCommand("alp.openConfigurator"), {
    ok: true,
  });
  assert.deepEqual(classifyWebviewCommand("alp.openConfigurator", false), {
    ok: true,
  });
});

test("build command runs when buildReady is true", () => {
  assert.deepEqual(classifyWebviewCommand("alp.westBuild", true), { ok: true });
  assert.deepEqual(classifyWebviewCommand("alp.westFlash", true), { ok: true });
});

test("build command is refused when buildReady is false", () => {
  assert.deepEqual(classifyWebviewCommand("alp.westBuild", false), {
    ok: false,
    reason: "not-build-ready",
  });
  assert.deepEqual(classifyWebviewCommand("alp.westFlash", false), {
    ok: false,
    reason: "not-build-ready",
  });
});

test("build gate is skipped when buildReady is omitted (non-build callers)", () => {
  assert.deepEqual(classifyWebviewCommand("alp.westBuild"), { ok: true });
});
