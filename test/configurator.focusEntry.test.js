// SPDX-License-Identifier: Apache-2.0
//
// The Configurator half of "Edit in Configurator" (#484): find the entry the
// Build Plan named, by `name`, without ever creating one, and without letting
// the name be read as a CSS selector.

const test = require("node:test");
const assert = require("node:assert/strict");

const load = () =>
  import("./webview/esbuildImport.mjs").then((m) =>
    m.importWebviewModule("features/configurator/focusEntry.ts"),
  );

const board = {
  som: { sku: "E1M-AEN801" },
  cores: {},
  ipc: [{ name: "alp_default_rpmsg", kind: "rpmsg", endpoints: [] }],
  storage: [{ name: "data", size_kib: 64 }],
};

test("focusKeyOf is the section and the name, verbatim", async () => {
  const { focusKeyOf } = await load();
  assert.equal(focusKeyOf("ipc", "a b"), "ipc:a b");
  assert.equal(focusKeyOf("storage", 'x"]'), 'storage:x"]');
});

test("missingEntryNotice is null for a declared entry and a sentence otherwise", async () => {
  const { missingEntryNotice } = await load();
  assert.equal(
    missingEntryNotice(board, { section: "ipc", name: "alp_default_rpmsg" }),
    null,
  );
  assert.equal(
    missingEntryNotice(board, { section: "storage", name: "data" }),
    null,
  );
  const missing = missingEntryNotice(board, {
    section: "storage",
    name: "nvs",
  });
  assert.match(missing, /nvs/);
  assert.match(missing, /nothing was created/);
  assert.match(
    missingEntryNotice(
      { som: { sku: "" }, cores: {} },
      { section: "ipc", name: "x" },
    ),
    /x/,
  );
});

test("findFocusElement compares the attribute, never builds a selector from the name", async () => {
  const { findFocusElement } = await load();
  const queried = [];
  const a = { getAttribute: () => "ipc:other" };
  const b = { getAttribute: () => 'ipc:x"],[data-evil' };
  const root = {
    querySelectorAll: (sel) => {
      queried.push(sel);
      return [a, b];
    },
  };
  assert.equal(findFocusElement(root, 'ipc:x"],[data-evil'), b);
  assert.equal(findFocusElement(root, "ipc:none"), null);
  assert.deepEqual(new Set(queried), new Set(["[data-focus-entry]"]));
});
