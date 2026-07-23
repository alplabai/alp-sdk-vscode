// SPDX-License-Identifier: Apache-2.0
//
// Wiring checks for the terminal-finish refresh signal (P1.7): the hub panels
// used to refresh their status a blind `setTimeout(..., 8000/1200)` after
// kicking off a webview command, so a bootstrap or `west` build that ran
// longer than the guess left the status stale. Now `runInTerminal` fires
// `onDidFinishTerminalCommand` when its terminal closes, and each panel keeps a
// standing subscription that refreshes on that real signal — no race, no
// one-shot, no blind delay. These are cheap source-level checks (the runtime
// behaviour is covered by the e2e harness) so they catch a panel that
// regresses to a blind timer, or a lost emitter fire, without needing
// `vsce package` + electron.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf-8");

const PANELS = [
  "src/ideHub/overviewPanel.ts",
  "src/ideHub/hubViewProvider.ts",
  "src/ideHub/existingProjectFlowPanel.ts",
  "src/ideHub/setupFlowPanel.ts",
];

test("util.ts exports the terminal-finish signal", () => {
  const util = read("src/util.ts");
  assert.match(
    util,
    /export const onDidFinishTerminalCommand =/,
    "util must export onDidFinishTerminalCommand",
  );
});

test("runInTerminal fires the terminal-finish signal when the terminal closes", () => {
  const util = read("src/util.ts");
  // The fire must sit inside the onDidCloseTerminal handler, keyed off the
  // closed terminal's name + exit code -- not merely defined somewhere.
  assert.match(
    util,
    /onDidCloseTerminal\([\s\S]*?terminalFinished\.fire\(\{[\s\S]*?name: options\.name[\s\S]*?code[\s\S]*?\}\)/,
    "runInTerminal must fire terminalFinished({name, code}) on close",
  );
});

test("every hub panel keeps a standing refresh-on-terminal-finish subscription", () => {
  for (const rel of PANELS) {
    const src = read(rel);
    assert.match(
      src,
      /onDidFinishTerminalCommand\(\(\) => void this\.refresh\(\)\)/,
      `${rel} must subscribe to onDidFinishTerminalCommand`,
    );
  }
});

test("no hub panel refreshes on a blind setTimeout", () => {
  for (const rel of PANELS) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      /setTimeout\(\(\) => (?:void )?this\.refresh\(\)/,
      `${rel} must not refresh on a blind setTimeout`,
    );
  }
});
