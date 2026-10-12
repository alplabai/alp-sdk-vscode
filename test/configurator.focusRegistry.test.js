// SPDX-License-Identifier: Apache-2.0
//
// The Build Plan → Configurator hand-off (#484): a focus request waits for
// the Configurator panel on that board.yaml to be READY (or for the open to
// finish, when one already is), is delivered once, never reaches a panel for
// a different file, and never outlives its panel or its time limit.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const mod = () =>
  require(
    path.join(__dirname, "..", "out", "configurator", "focusRegistry.js"),
  );

/** A fresh registry with a hand-driven clock. */
function registry({ platform = "linux" } = {}) {
  const clock = { t: 1000 };
  const r = mod().createFocusRegistry({ now: () => clock.t, platform });
  return { r, clock };
}

const BOARD = path.posix.join("/home/dev/proj", "board.yaml");
const focus = (section, name) => ({ type: "focusEntry", section, name });

test("a request made before the panel exists is delivered once it is ready", () => {
  const { r } = registry();
  r.requestConfiguratorFocus(BOARD, { section: "ipc", name: "link0" });
  const posted = [];
  const panel = r.attachConfiguratorPanel(BOARD, (m) => posted.push(m));
  assert.deepEqual(posted, [], "nothing before ready — the view would drop it");
  panel.ready();
  assert.deepEqual(posted, [focus("ipc", "link0")]);
  panel.ready();
  assert.equal(posted.length, 1, "delivered once");
});

test("a ready panel gets the request only after the open resolves, not at request time", () => {
  const { r } = registry();
  const posted = [];
  r.attachConfiguratorPanel(BOARD, (m) => posted.push(m)).ready();
  r.requestConfiguratorFocus(BOARD, { section: "storage", name: "data" });
  assert.deepEqual(posted, [], "the tab may not be visible yet");
  r.deliverPendingFocus(BOARD);
  assert.deepEqual(posted, [focus("storage", "data")]);
  assert.equal(r.takePendingFocus(BOARD), null);
});

test("a panel on another file never receives the request", () => {
  const { r } = registry();
  const posted = [];
  r.attachConfiguratorPanel("/other/board.yaml", (m) => posted.push(m)).ready();
  r.requestConfiguratorFocus(BOARD, { section: "ipc", name: "link0" });
  r.deliverPendingFocus("/other/board.yaml");
  r.deliverPendingFocus(BOARD);
  assert.deepEqual(posted, []);
});

test("disposing a panel before it is ready drops its request — a later panel gets nothing", () => {
  const { r } = registry();
  r.requestConfiguratorFocus(BOARD, { section: "ipc", name: "link0" });
  r.attachConfiguratorPanel(BOARD, () => {}).dispose();
  const posted = [];
  r.attachConfiguratorPanel(BOARD, (m) => posted.push(m)).ready();
  r.deliverPendingFocus(BOARD);
  assert.deepEqual(posted, []);
});

test("a request older than the time limit is dropped, not delivered", () => {
  const { r, clock } = registry();
  const { FOCUS_REQUEST_TTL_MS } = mod();
  assert.equal(FOCUS_REQUEST_TTL_MS, 30000);
  r.requestConfiguratorFocus(BOARD, { section: "ipc", name: "link0" });
  clock.t += FOCUS_REQUEST_TTL_MS + 1;
  const posted = [];
  r.attachConfiguratorPanel(BOARD, (m) => posted.push(m)).ready();
  r.deliverPendingFocus(BOARD);
  assert.deepEqual(posted, []);
  assert.equal(r.takePendingFocus(BOARD), null);
});

test("a request inside the time limit is still delivered", () => {
  const { r, clock } = registry();
  r.requestConfiguratorFocus(BOARD, { section: "ipc", name: "link0" });
  clock.t += 29000;
  const posted = [];
  r.attachConfiguratorPanel(BOARD, (m) => posted.push(m)).ready();
  assert.deepEqual(posted, [focus("ipc", "link0")]);
});

test("on Windows a drive-letter case and separator difference is the same file", () => {
  const { r } = registry({ platform: "win32" });
  r.requestConfiguratorFocus("C:/x/board.yaml", { section: "ipc", name: "a" });
  const posted = [];
  r.attachConfiguratorPanel("c:\\x\\board.yaml", (m) => posted.push(m)).ready();
  assert.deepEqual(posted, [focus("ipc", "a")]);
});

test("off Windows, paths differing in case are different files", () => {
  const { r } = registry({ platform: "linux" });
  r.requestConfiguratorFocus("/x/Board.yaml", { section: "ipc", name: "a" });
  const posted = [];
  r.attachConfiguratorPanel("/x/board.yaml", (m) => posted.push(m)).ready();
  assert.deepEqual(posted, []);
});

test("isFocusEntryTarget accepts only ipc/storage with a non-empty name", () => {
  const { isFocusEntryTarget } = mod();
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
