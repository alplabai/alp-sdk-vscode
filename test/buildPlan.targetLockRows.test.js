// SPDX-License-Identifier: Apache-2.0
//
// The webview half of the target lock (#484): the Memory section only ever
// DISPLAYS the host's verdict, and a region whose verdict is missing — an
// older host, a hand-built fixture — reads as locked, never as open.

const test = require("node:test");
const assert = require("node:assert/strict");

const load = (rel) =>
  import("./webview/esbuildImport.mjs").then((m) => m.importWebviewModule(rel));

function region(overrides) {
  return {
    id: `memory:${overrides.name}`,
    name: overrides.name,
    source: "som_preset",
    kind: "flash",
    status: "ok",
    base: 2153119744,
    sizeBytes: 98304,
    writeAuthority: "customer_runtime",
    authorityClass: "customer_runtime",
    cores: [],
    reason: null,
    ...overrides,
  };
}

test("lockOf: an absent verdict is locked, with a reason", async () => {
  const { lockOf } = await load("features/build-plan/targetLock.ts");
  for (const r of [
    region({ name: "storage" }),
    region({ name: "storage", targetLock: {} }),
    region({ name: "storage", targetLock: { storage: { locked: "no" } } }),
    region({ name: "storage", targetLock: null }),
  ]) {
    const lock = lockOf(r, "storage");
    assert.equal(lock.locked, true);
    assert.ok(lock.reason.length > 0);
  }
});

test("lockOf: a host verdict is passed through verbatim", async () => {
  const { lockOf } = await load("features/build-plan/targetLock.ts");
  const verdict = { locked: false, reason: "customer_runtime flash region" };
  const r = region({
    name: "storage",
    targetLock: { storage: verdict, ipc: { locked: true, reason: "x" } },
  });
  assert.deepEqual(lockOf(r, "storage"), verdict);
  assert.deepEqual(lockOf(r, "ipc"), { locked: true, reason: "x" });
});

test("region rows carry both verdicts; span rows carry none", async () => {
  const { buildRows } = await load("features/build-plan/memoryRows.ts");
  const atoc = region({
    name: "atoc",
    writeAuthority: "secure_enclave",
    targetLock: {
      ipc: { locked: true, reason: "write authority is secure_enclave" },
      storage: { locked: true, reason: "write authority is secure_enclave" },
    },
  });
  const rows = buildRows([atoc], [], new Map(), "memory:atoc");
  assert.equal(rows[0].targetLock.storage.locked, true);
  assert.match(rows[0].targetLock.storage.reason, /secure_enclave/);
  assert.equal(rows[0].fullyLocked, true);
  const bare = buildRows([region({ name: "storage" })], [], new Map(), null);
  assert.equal(bare[0].targetLock.ipc.locked, true, "absent → locked");
  assert.equal(bare[0].fullyLocked, true);
});
