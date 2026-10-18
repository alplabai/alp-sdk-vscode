// SPDX-License-Identifier: Apache-2.0
//
// Every extension release publishes to the STABLE Marketplace / Open VSX
// channel, whatever its minor digit. release-vsix.yml used to derive the
// channel from the minor's parity (odd = `--pre-release`), which hid 0.5.x and
// 0.7.0 from everyone who installed the extension the default way: VS Code
// installs the newest STABLE version unless a user opts into pre-release, so
// they got the previous release, and its first-run dialog offered them the
// previous release's tan.
//
// The rule is now "no pre-release, anywhere in the release path". These tests
// pin it to the files that would have to change to bring the parity rule back:
//
// 1. No executable line of release-vsix.yml passes `--pre-release` or carries
//    a PRERELEASE_FLAG / IS_PRERELEASE variable. Comments are skipped so the
//    workflow can still explain why the flag is absent.
// 2. The GitHub Release is created with `prerelease: false` — a literal, not
//    an expression a future channel variable could flip.
// 3. scripts/resolve-vsix-channel.mjs, the old parity resolver, stays deleted.
// 4. No package.json script packages a `--pre-release` VSIX either, so a
//    locally built test VSIX installs on the same channel users get.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf-8");
const RELEASE_WORKFLOW = ".github/workflows/release-vsix.yml";
const PRERELEASE_MARKERS = /--pre-release|PRERELEASE_FLAG|IS_PRERELEASE/;

/** Lines of the workflow that are not YAML comments, with 1-based numbers. */
function executableLines(contents) {
  return contents
    .split("\n")
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => !text.trimStart().startsWith("#"));
}

test("release-vsix.yml never publishes or packages to the pre-release channel", () => {
  // Arrange
  const lines = executableLines(read(RELEASE_WORKFLOW));

  // Act
  const offenders = lines.filter(({ text }) => PRERELEASE_MARKERS.test(text));

  // Assert
  assert.deepEqual(
    offenders.map(({ line, text }) => `${line}: ${text.trim()}`),
    [],
    `${RELEASE_WORKFLOW} must not route any release to the pre-release channel — ` +
      "every release is stable.",
  );
});

test("release-vsix.yml creates the GitHub Release with a literal prerelease: false", () => {
  // Arrange
  const lines = executableLines(read(RELEASE_WORKFLOW));

  // Act
  const prereleaseKeys = lines.filter(({ text }) =>
    /^\s*prerelease:/.test(text),
  );

  // Assert
  assert.ok(
    prereleaseKeys.length > 0,
    `${RELEASE_WORKFLOW} must set prerelease: explicitly on the GitHub Release step.`,
  );
  for (const { line, text } of prereleaseKeys) {
    assert.match(
      text,
      /^\s*prerelease:\s*false\s*$/,
      `${RELEASE_WORKFLOW}:${line} must be the literal "prerelease: false", got "${text.trim()}".`,
    );
  }
});

test("the odd/even-minor channel resolver stays deleted", () => {
  // Arrange
  const resolver = path.join(root, "scripts", "resolve-vsix-channel.mjs");

  // Act
  const exists = fs.existsSync(resolver);

  // Assert
  assert.equal(
    exists,
    false,
    "scripts/resolve-vsix-channel.mjs derived the publish channel from the minor's parity; " +
      "releases are always stable now, so it must not come back.",
  );
});

test("no package.json script packages a --pre-release VSIX", () => {
  // Arrange
  const { scripts = {} } = JSON.parse(read("package.json"));

  // Act
  const offenders = Object.entries(scripts).filter(([, command]) =>
    command.includes("--pre-release"),
  );

  // Assert
  assert.deepEqual(
    offenders.map(([name]) => name),
    [],
    "package.json scripts must not package a pre-release VSIX.",
  );
});
