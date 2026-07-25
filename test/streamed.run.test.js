// SPDX-License-Identifier: Apache-2.0
//
// Source-level assertions on `runAlpStreamed`'s wiring. It spawns processes and
// talks to the VS Code window API, so it cannot be imported here (there is no
// `vscode` module outside the host) — the same reason `util.terminalFinish` is
// checked this way. These pin the four properties the review of #333 found
// missing, each of which is invisible in a green build:
//   * the login-shell env (a channel child otherwise loses the user's PATH)
//   * one run per name (two Build clicks otherwise race the same build dir)
//   * cancellation
//   * UTF-8 decoding on the stream, not per chunk

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ADAPTER = fs.readFileSync(
  path.join(__dirname, "..", "src", "alpCli", "vscodeAdapter.ts"),
  "utf8",
);
const streamed = ADAPTER.slice(
  ADAPTER.indexOf("export async function runAlpStreamed("),
  ADAPTER.indexOf("async function surfaceResolutionError("),
);

test("streams through the login shell so the child keeps the user's PATH", () => {
  assert.match(ADAPTER, /function loginShellInvocation\(/);
  // `-lc`: a LOGIN shell, so ~/.zshrc / venv activation are sourced. A plain
  // `-c` would source nothing and leave the regression in place.
  assert.match(ADAPTER, /"-lc"/);
  assert.match(streamed, /shellRun\s*\?\s*cp\.spawn\(shellRun\.file/);
});

test("quotes every word handed to the shell", () => {
  // Paths carry spaces; nothing here may be re-read as a glob or a variable.
  assert.match(ADAPTER, /const quote = \(word: string\): string =>/);
  assert.match(ADAPTER, /\.map\(quote\)\.join\(" "\)/);
});

test("windows keeps the direct spawn (no -lc equivalent worth emulating)", () => {
  assert.match(ADAPTER, /if \(process\.platform === "win32"\) return null;/);
  assert.match(streamed, /cp\.spawn\(binary\.command, finalArgs/);
});

test("a second run of the same name replaces the first", () => {
  assert.match(
    ADAPTER,
    /const streamedRuns = new Map<string, cp\.ChildProcess>/,
  );
  assert.match(streamed, /streamedRuns\.get\(options\.name\)/);
  assert.match(streamed, /previous\.kill\(\)/);
  assert.match(streamed, /streamedRuns\.set\(options\.name, child\)/);
  assert.match(streamed, /streamedRuns\.delete\(options\.name\)/);
});

test("the run is cancellable and a killed run is not reported as a failure", () => {
  assert.match(streamed, /cancellable: true/);
  assert.match(streamed, /token\.onCancellationRequested/);
  // `close` carries a signal when we killed it — announcing that as an exit
  // code would toast "failed" at a user who pressed Cancel.
  assert.match(streamed, /child\.on\("close", \(code, signal\)/);
  assert.match(streamed, /if \(signal\) \{/);
});

test("decodes UTF-8 on the stream, not per chunk", () => {
  // A multi-byte character split across a chunk boundary is mangled by a
  // per-chunk toString() — this repo's own build output is Turkish.
  assert.match(streamed, /child\.stdout\?\.setEncoding\("utf8"\)/);
  assert.match(streamed, /child\.stderr\?\.setEncoding\("utf8"\)/);
  assert.doesNotMatch(streamed, /chunk\.toString\(\)/);
});

test("resolves exactly once across the error/close race", () => {
  assert.match(streamed, /let settled = false;/);
  assert.match(streamed, /if \(settled\) return;/);
});

test("no UI surface routes Flash at the plain-west command any more", () => {
  const view = fs.readFileSync(
    path.join(__dirname, "..", "src", "views", "build.ts"),
    "utf8",
  );
  const hub = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "packages",
      "alp-webview",
      "src",
      "features",
      "sidebar-hub",
      "SidebarHubView.tsx",
    ),
    "utf8",
  );
  for (const [name, source] of [
    ["build view", view],
    ["hub", hub],
  ]) {
    const dispatched = [
      ...source.matchAll(/command: "(alp\.west[A-Za-z]*Flash)"/g),
    ].map((m) => m[1]);
    assert.deepStrictEqual(
      dispatched.filter((c) => c === "alp.westFlash"),
      [],
      `${name} still dispatches the silently-dying alp.westFlash`,
    );
    // And exactly one Flash button per surface — two entries dispatching the
    // same command told the user they did different things.
    assert.strictEqual(
      dispatched.length,
      1,
      `${name} has ${dispatched.length} Flash entries`,
    );
  }
});
