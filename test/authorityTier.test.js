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

test("the writable group sorts first, then locked, then unproven", async () => {
  const { compareByTierThenAddress } = await load();
  const rows = [
    { authorityClass: "locked", base: 0x80000000, name: "mcuboot" },
    { authorityClass: "unstated", base: 0x80600000, name: "odd" },
    { authorityClass: "customer_image", base: 0x80010000, name: "he_slot0" },
    { authorityClass: "customer_runtime", base: 0x80560000, name: "storage" },
  ];
  const names = [...rows].sort(compareByTierThenAddress).map((r) => r.name);
  assert.deepEqual(names, ["he_slot0", "storage", "mcuboot", "odd"]);
});

test("a null base sorts after every resolved base inside its own tier", async () => {
  const { compareByTierThenAddress } = await load();
  const rows = [
    { authorityClass: "composite", base: null, name: "mram_main" },
    { authorityClass: "reserved", base: 0x80000000, name: "placed" },
  ];
  const names = [...rows].sort(compareByTierThenAddress).map((r) => r.name);
  assert.deepEqual(names, ["placed", "mram_main"]);
});
