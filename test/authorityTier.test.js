// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");

const load = async () =>
  (await import("./webview/esbuildImport.mjs")).importWebviewModule(
    "features/build-plan/authorityTier.ts",
  );

test("every authority class maps to exactly one of three tiers", async () => {
  const { tierOf } = await load();
  assert.equal(tierOf("customer_runtime"), "yours");
  assert.equal(tierOf("customer_image"), "yours");
  assert.equal(tierOf("locked"), "locked");
  assert.equal(tierOf("reserved"), "unproven");
  assert.equal(tierOf("composite"), "unproven");
  assert.equal(tierOf("unstated"), "unproven");
});
