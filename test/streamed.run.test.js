// SPDX-License-Identifier: Apache-2.0
//
// Source-level assertions on `runAlpStreamed`'s wiring. It spawns processes and
// talks to the VS Code window API, so it cannot be imported here (there is no
// `vscode` module outside the host) — the same reason `util.terminalFinish` is
// checked this way.
//
// Deliberately NARROW: everything with an edge case worth a real assertion has
// been moved somewhere it can be executed, and is tested there instead —
//   * the shell quoting / cd / exec  -> `posixLoginShellCommand`, a pure
//     function in `src/alpCli/service.ts` (alpCli.service.test.js, including a
//     round trip through a real /bin/sh)
//   * "one run per name", across the terminal AND channel paths -> the shared
//     reservation registry in `src/util.ts` (util.terminalFinish.test.js)
// What is left here is wiring with no seam: which spawn form is used, that the
// streams are decoded as UTF-8, and that the promise settles once.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ADAPTER = fs.readFileSync(
  path.join(__dirname, "..", "src", "alpCli", "vscodeAdapter.ts"),
  "utf8",
);
const streamed = ADAPTER.slice(
  ADAPTER.indexOf("async function streamRun("),
  ADAPTER.indexOf("async function surfaceResolutionError("),
);

test("streams through the login shell so the child keeps the user's PATH", () => {
  assert.match(ADAPTER, /function loginShellInvocation\(/);
  // `-lc`: a LOGIN shell, so ~/.zshrc / venv activation are sourced. A plain
  // `-c` would source nothing and leave the regression in place.
  assert.match(ADAPTER, /"-lc"/);
  // The command string comes from the pure service, not a second hand-rolled
  // quoter in the adapter.
  assert.match(ADAPTER, /posixLoginShellCommand\(command, args, cwd\)/);
  assert.match(streamed, /shellRun\s*\?\s*cp\.spawn\(shellRun\.file/);
});

test("windows keeps the direct spawn (no -lc equivalent worth emulating)", () => {
  assert.match(ADAPTER, /if \(process\.platform === "win32"\) return null;/);
  assert.match(streamed, /cp\.spawn\(binary\.command, finalArgs/);
});

test("a second run of the same name is REFUSED, never killed", () => {
  // The hardware rule: a streamed run can be a flash (src/west.ts routes flash
  // here), and killing one mid-write can leave a board unbootable (#146). The
  // reservation is taken before the first await, so two clicks landing while
  // the binary is still resolving cannot both pass.
  const entry = ADAPTER.slice(
    ADAPTER.indexOf("export async function runAlpStreamed("),
    ADAPTER.indexOf("async function streamRun("),
  );
  assert.match(entry, /if \(!reserveStreamedRun\(options\.name\)\)/);
  // The refusal is a notify plan now (#368's single presenter), not a
  // hand-rolled showWarningMessage: a warning severity, the "still running"
  // sentence, and a reveal action chosen from the mode of the run that holds
  // the name — "Show Output" for a channel run, "Show Terminal" for a task.
  assert.match(entry, /notifyAsync\(\s*planFailure\(\{/);
  assert.match(entry, /severity: "warning"/);
  assert.match(entry, /is still running\./);
  assert.match(entry, /isStreamedRunActive\(options\.name\)/);
  assert.match(entry, /\{ id: "showOutput" \}/);
  assert.match(entry, /\{ id: "showTerminal", arg: options\.name \}/);
  assert.match(entry, /finally \{\s*releaseStreamedRun\(options\.name\);/);
  // No same-name kill anywhere on this path; the only kill left is the user's
  // own Cancel button.
  assert.doesNotMatch(ADAPTER, /previous\.kill\(\)/);
  assert.doesNotMatch(ADAPTER, /const streamedRuns =/);
  // The only kill left is the user's own Cancel, and it must settle: the
  // reservation is released when this promise resolves, so a cancel that never
  // resolves leaves the command refused until the window is reloaded.
  assert.match(streamed, /token\.onCancellationRequested/);
  assert.match(streamed, /child\.kill\("SIGKILL"\)/);
  // `exit`, not only `close` — `close` waits for grandchildren (west, ninja)
  // to drop the inherited pipes, which after a cancel may never happen.
  assert.match(streamed, /child\.on\("exit"/);
});

test("the run is cancellable and a killed run is not reported as a failure", () => {
  assert.match(streamed, /cancellable: true/);
  // `exit` carries a signal when we killed it — announcing that as an exit
  // code would toast "failed" at a user who pressed Cancel.
  assert.match(streamed, /child\.on\("exit", \(code, signal\)/);
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

test("the streamed argv carries no flag tan defers (tan-cli#427)", () => {
  // tan v0.5.0 deferred `--no-color` AND `--non-interactive`, and `tan build`
  // REFUSES them rather than ignoring them: "error: `tan build --no-color` is
  // deferred and not available in this build", exit 1, before a single slice
  // runs. Appending them left build/image/flash/clean/renode and the Build
  // Plan panel's two buttons all dead on arrival under the v0.5.1 pin.
  //
  // Asserted on the assignment, not on the whole slice: the comment above it
  // quotes both flag names on purpose, so a bare
  // `doesNotMatch(streamed, /--no-color/)` would fail on prose, not on code.
  assert.match(streamed, /const finalArgs = withSdkRoot\(args\);/);
  // Any array literal here is an appended-flag list coming back.
  assert.doesNotMatch(streamed, /const finalArgs = \[/);
});

test("no dispatch site hard-codes a build or flash run name", () => {
  // Two names are two reservations, and two `tan build` processes over one
  // `build/` directory — or, for flash, two programmers writing one board.
  // Scans the whole tree rather than a fixed file list, so a NEW dispatch site
  // (e.g. the debug preLaunchTask arriving with #342) is caught too, which is
  // the entire regression this guards.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        const source = fs.readFileSync(full, "utf8");
        // The literals the shared constants replaced. `src/util.ts` itself
        // declares them, so it is the one file allowed to carry them.
        if (full.endsWith(path.join("src", "util.ts"))) continue;
        for (const literal of [/name: "Alp Build"/, /name: ["`]Alp Flash/]) {
          if (literal.test(source))
            offenders.push(path.relative(__dirname, full));
        }
      }
    }
  };
  walk(path.join(__dirname, "..", "src"));
  assert.deepStrictEqual(
    offenders,
    [],
    `these dispatch sites must use BUILD_RUN_NAME / FLASH_RUN_NAME: ${offenders.join(", ")}`,
  );
  // …and the constants are actually in use.
  const west = fs.readFileSync(
    path.join(__dirname, "..", "src", "west.ts"),
    "utf8",
  );
  assert.match(west, /name: BUILD_RUN_NAME/);
  assert.match(west, /name: FLASH_RUN_NAME/);
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
