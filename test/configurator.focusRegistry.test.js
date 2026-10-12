// SPDX-License-Identifier: Apache-2.0
//
// The Build Plan → Configurator hand-off (#484): a focus request waits for
// the Configurator panel on that board.yaml to be READY, is delivered once,
// and never reaches a panel for a different file.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const load = () => {
  const mod = path.join(
    __dirname,
    "..",
    "out",
    "configurator",
    "focusRegistry.js",
  );
  delete require.cache[require.resolve(mod)];
  return require(mod);
};

const BOARD = path.join("/home/dev/proj", "board.yaml");

test("a request made before the panel exists is delivered once it is ready", () => {
  const r = load();
  r.requestConfiguratorFocus(BOARD, { section: "ipc", name: "link0" });
  const posted = [];
  const panel = r.attachConfiguratorPanel(BOARD, (m) => posted.push(m));
  assert.deepEqual(posted, [], "nothing before ready — the view would drop it");
  panel.ready();
  assert.deepEqual(posted, [
    { type: "focusEntry", section: "ipc", name: "link0" },
  ]);
  panel.ready();
  assert.equal(posted.length, 1, "delivered once");
});

test("a request to an already-ready panel is delivered at once", () => {
  const r = load();
  const posted = [];
  r.attachConfiguratorPanel(BOARD, (m) => posted.push(m)).ready();
  r.requestConfiguratorFocus(BOARD, { section: "storage", name: "data" });
  assert.deepEqual(posted, [
    { type: "focusEntry", section: "storage", name: "data" },
  ]);
  assert.equal(r.takePendingFocus(BOARD), null);
});

test("a panel on another file never receives the request", () => {
  const r = load();
  const posted = [];
  r.attachConfiguratorPanel("/other/board.yaml", (m) => posted.push(m)).ready();
  r.requestConfiguratorFocus(BOARD, { section: "ipc", name: "link0" });
  assert.deepEqual(posted, []);
});

test("a disposed panel stops receiving; the request waits for the next one", () => {
  const r = load();
  const posted = [];
  const panel = r.attachConfiguratorPanel(BOARD, (m) => posted.push(m));
  panel.ready();
  panel.dispose();
  r.requestConfiguratorFocus(BOARD, { section: "ipc", name: "link0" });
  assert.deepEqual(posted, []);
  assert.deepEqual(r.takePendingFocus(BOARD), {
    section: "ipc",
    name: "link0",
  });
});

test("isFocusEntryTarget accepts only ipc/storage with a non-empty name", () => {
  const { isFocusEntryTarget } = load();
  assert.equal(isFocusEntryTarget({ section: "ipc", name: "a" }), true);
  assert.equal(isFocusEntryTarget({ section: "storage", name: "a" }), true);
  for (const bad of [
    null,
    {},
    { section: "slices", name: "a" },
    { section: "ipc", name: "" },
    { section: "ipc", name: 1 },
    { section: "ipc", name: "x".repeat(300) },
  ]) {
    assert.equal(isFocusEntryTarget(bad), false, JSON.stringify(bad));
  }
});
