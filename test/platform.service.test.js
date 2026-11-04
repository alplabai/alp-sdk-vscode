// SPDX-License-Identifier: Apache-2.0
//
// Alp Platform pin consumer (#718): tolerant read of `tan doctor`'s
// `data.platform`, own-version fill-in, mismatch dedupe key.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mismatchKey,
  mismatches,
  readPlatform,
  statusBarText,
  warningMessage,
  withOwnVersion,
} = require("../packages/alp-core/dist/platform/service.js");

const comp = (name, pinned, installed, status) => ({
  name,
  pinned,
  installed,
  status,
});
const payload = (over = {}) => ({
  version: "27.2.0",
  line: "27.2",
  manifestSha256: "ab",
  components: [
    comp("alp-sdk", "0.18.0", "0.18.0", "match"),
    comp("tan-cli", "0.8.0", "0.8.0", "match"),
    comp("alp-sdk-vscode", "0.8.0", null, "unknown"),
    comp("gd32-bridge-firmware", "0.3.1", null, "unknown"),
    comp("cc3501e-bridge-firmware", "0.9.2", null, "unknown"),
  ],
  extraFutureField: 1,
  ...over,
});
const pinOf = (v) => {
  const r = readPlatform(v);
  assert.equal(r.kind, "pin");
  return r.pin;
};

test("no key and null mean no pin", () => {
  assert.equal(readPlatform(undefined).kind, "none");
  assert.equal(readPlatform(null).kind, "none");
});

test("malformed payloads are not a pin and do not throw", () => {
  for (const bad of [
    "27.2.0",
    42,
    {},
    payload({ components: "x" }),
    payload({ version: 27 }),
    payload({ components: [null] }),
    payload({ components: [comp("a", "1", 2, "match")] }),
    payload({ components: [{ name: "a" }] }),
  ]) {
    assert.equal(readPlatform(bad).kind, "malformed", JSON.stringify(bad));
  }
});

test("match: own version equal to pinned, no mismatch, status text", () => {
  const pin = withOwnVersion(pinOf(payload()), "0.8.0");
  assert.equal(statusBarText(pin), "Alp Platform 27.2.0");
  assert.equal(mismatchKey(pin), "");
});

test("own-version fill-in sets installed and recomputes status", () => {
  const own = (pin) => pin.components.find((c) => c.name === "alp-sdk-vscode");
  const ok = own(withOwnVersion(pinOf(payload()), "v0.8.0"));
  assert.deepEqual([ok.installed, ok.status], ["v0.8.0", "match"]);
  const bad = own(withOwnVersion(pinOf(payload()), "0.7.1"));
  assert.deepEqual([bad.installed, bad.status], ["0.7.1", "mismatch"]);
});

test("each component mismatch is reported with installed and pinned", () => {
  for (const name of ["alp-sdk", "tan-cli", "alp-sdk-vscode"]) {
    const raw = payload();
    const c = raw.components.find((x) => x.name === name);
    c.installed = "9.9.9";
    c.status = "mismatch";
    const pin = withOwnVersion(
      pinOf(raw),
      name === "alp-sdk-vscode" ? "9.9.9" : "0.8.0",
    );
    assert.deepEqual(
      mismatches(pin).map((x) => x.name),
      [name],
    );
    assert.match(
      warningMessage(pin),
      new RegExp(`${name} 9\\.9\\.9 \\(pinned `),
    );
  }
});

test("the dedupe key changes with the mismatch set", () => {
  const a = withOwnVersion(pinOf(payload()), "0.7.1");
  const b = withOwnVersion(pinOf(payload()), "0.7.2");
  assert.notEqual(mismatchKey(a), "");
  assert.equal(
    mismatchKey(a),
    mismatchKey(withOwnVersion(pinOf(payload()), "0.7.1")),
  );
  assert.notEqual(mismatchKey(a), mismatchKey(b));
});
