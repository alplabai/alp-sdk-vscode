// SPDX-License-Identifier: Apache-2.0
//
// Alp Platform pin consumer (#718): tolerant read of `tan doctor`'s
// `data.platform`, own-version fill-in, mismatch dedupe key.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mismatchKey,
  mismatches,
  isListAccessIssue,
  isPlatformLine,
  isPlatformTarget,
  isPlatformVersion,
  platformMenu,
  readPlatform,
  readPlatformList,
  switchCandidates,
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

test("no key is an unsupported tan; null is supported with no pin", () => {
  assert.equal(readPlatform(undefined).kind, "unsupported");
  assert.equal(readPlatform(null).kind, "none");
});

test("malformed payloads are not a pin and do not throw", () => {
  for (const bad of [
    "27.2.0",
    42,
    {},
    payload({ components: "x" }),
    payload({ version: 27 }),
    payload({ version: "27.02.0" }),
    payload({ line: "27.13" }),
  ]) {
    assert.equal(readPlatform(bad).kind, "malformed", JSON.stringify(bad));
  }
});

test("a bad component entry is skipped, the rest of the pin survives", () => {
  const raw = payload();
  raw.components.push(null, { name: "x" }, comp("a", "1", 2, "match"));
  assert.equal(pinOf(raw).components.length, 5);
});

test("version and line follow the §1 grammar", () => {
  for (const ok of ["27.2.0", "26.11.3", "27.1.0-rc1"])
    assert.ok(isPlatformVersion(ok), ok);
  for (const bad of [
    "27.02.0",
    "27.13.0",
    "27.2",
    "27.2.0-rc0",
    "v27.2.0",
    "--x",
  ])
    assert.ok(!isPlatformVersion(bad), bad);
  assert.ok(isPlatformLine("26.11") && !isPlatformLine("26.11.0"));
  assert.ok(isPlatformTarget("26.11") && !isPlatformTarget("--manifest"));
});

test("tan platform list: tolerant read, newest MICRO per line, all", () => {
  const list = readPlatformList({
    releases: [
      { version: "26.11.0", line: "26.11", prerelease: false, published: "a" },
      { version: "26.11.1", line: "26.11", prerelease: false, published: "b" },
      { version: "27.1.0-rc1", line: "27.1", prerelease: true, published: "c" },
      { version: "27.1.0", line: "27.1", prerelease: false, published: "d" },
      { version: "junk", line: "x" },
      null,
    ],
    pinned: "26.11.0",
  });
  assert.equal(list.releases.length, 4);
  assert.deepEqual(
    switchCandidates(list, false).map((r) => r.version),
    ["27.1.0", "26.11.1"],
  );
  assert.deepEqual(
    switchCandidates(list, true).map((r) => r.version),
    ["27.1.0", "27.1.0-rc1", "26.11.1", "26.11.0"],
  );
  assert.equal(readPlatformList({}), null);
});

test("list access issues are recognised, others are not", () => {
  assert.ok(
    isListAccessIssue([{ code: "platform.http", message: "HTTP 403" }]),
  );
  assert.ok(isListAccessIssue([{ code: "x", message: "GITHUB_TOKEN needed" }]));
  assert.ok(!isListAccessIssue([{ code: "x", message: "timed out" }]));
});

test("the menu: pin lists components then actions; no pin only switch", () => {
  const menu = platformMenu(withOwnVersion(pinOf(payload()), "0.7.1"));
  assert.deepEqual(
    menu.filter((m) => m.action).map((m) => m.action),
    ["switch", "reapply", "clear", "open"],
  );
  assert.ok(
    menu.some((m) =>
      /mismatch — installed 0\.7\.1, pinned 0\.8\.0/.test(m.description ?? ""),
    ),
  );
  assert.deepEqual(
    platformMenu(null)
      .filter((m) => m.action)
      .map((m) => m.action),
    ["switch"],
  );
  assert.equal(statusBarText(null), "Alp Platform: none");
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
