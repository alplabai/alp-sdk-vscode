// SPDX-License-Identifier: Apache-2.0
//
// tan owns WHAT to run; the host owns WHERE and WITH WHICH binary.
// `retargetWestCommand` is the host's half of that split: it swaps a leading
// bare `west` token for the resolved binary and touches nothing else — it
// must not know or care what flags follow `west`. It returns an ARGV array,
// never a re-quoted shell string: a quoted Windows path put PowerShell (the
// default terminal profile on Windows) into expression mode, so the path
// parsed as a string literal instead of a command — the review that found
// this measured `powershell -NoProfile -Command '"C:\Program
// Files\nodejs\node.exe" -v"'` failing with `Unexpected token '-v' in
// expression or statement`, and the same line succeeding only with a `&` call
// operator this codebase does not want to special-case per shell.
//
// Failing-before-fix scenario (issue #412): `west sdk install --version 1.0.1
// -t arm-zephyr-eabi` is the command the pinned tan v0.4.1 hands back
// (measured, verbatim) for the `zephyrSdk` row, and on a real machine `west`
// is not on PATH — it lives in the bootstrap venv. Running the command
// unmodified fails with `'west' is not recognized` before this fix.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  retargetWestCommand,
} = require("../packages/alp-core/dist/deps/westCommand.js");

test("the measured Zephyr SDK command retargets onto a POSIX venv west (argv)", () => {
  assert.deepEqual(
    retargetWestCommand(
      "west sdk install --version 1.0.1 -t arm-zephyr-eabi",
      "/opt/ws/.venv/bin/west",
    ),
    [
      "/opt/ws/.venv/bin/west",
      "sdk",
      "install",
      "--version",
      "1.0.1",
      "-t",
      "arm-zephyr-eabi",
    ],
  );
});

test("a Windows venv west path with a space is ONE argv element, never quoted", () => {
  assert.deepEqual(
    retargetWestCommand(
      "west sdk install --version 1.0.1 -t arm-zephyr-eabi",
      "C:\\Program Files\\ws\\.venv\\Scripts\\west.exe",
    ),
    [
      // No added quotes: an argv spawn passes this as ONE element regardless
      // of the space it contains, and quoting it would be a shell-string habit
      // leaking into an argv array that has no shell to parse it back out.
      "C:\\Program Files\\ws\\.venv\\Scripts\\west.exe",
      "sdk",
      "install",
      "--version",
      "1.0.1",
      "-t",
      "arm-zephyr-eabi",
    ],
  );
});

test("a Windows venv west path with no space retargets the same way", () => {
  assert.deepEqual(
    retargetWestCommand(
      "west sdk install --version 1.0.1 -t arm-zephyr-eabi",
      "C:\\ws\\.venv\\Scripts\\west.exe",
    ),
    [
      "C:\\ws\\.venv\\Scripts\\west.exe",
      "sdk",
      "install",
      "--version",
      "1.0.1",
      "-t",
      "arm-zephyr-eabi",
    ],
  );
});

test("a command carrying a quoted argument is left alone, not mangled", () => {
  // Plain whitespace tokenizing cannot survive a quoted argument (it would
  // split `"foo bar"` into two tokens), so a quote anywhere refuses the
  // retarget rather than silently produce a wrong argv.
  assert.equal(
    retargetWestCommand(
      'west sdk install --name "foo bar"',
      "/opt/ws/.venv/bin/west",
    ),
    null,
  );
  assert.equal(
    retargetWestCommand(
      "west sdk install --name 'foo bar'",
      "/opt/ws/.venv/bin/west",
    ),
    null,
  );
});

test("a command tan wrote for a different tool is left alone", () => {
  assert.equal(
    retargetWestCommand(
      "winget install -e --id Ninja-build.Ninja",
      "/opt/ws/.venv/bin/west",
    ),
    null,
  );
});

test("west named mid-string, not as the leading token, is left alone", () => {
  assert.equal(
    retargetWestCommand("sudo apt-get install west", "/opt/ws/.venv/bin/west"),
    null,
  );
});

test("a token that merely starts with west is not a west command", () => {
  assert.equal(
    retargetWestCommand("westtool x", "/opt/ws/.venv/bin/west"),
    null,
  );
});
