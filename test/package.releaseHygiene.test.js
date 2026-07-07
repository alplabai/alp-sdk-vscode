// SPDX-License-Identifier: Apache-2.0
//
// Release-hygiene guards for the packaged VSIX (#70). CI additionally gates the
// *actual* packaged contents against a runtime allowlist (see the "VSIX ships
// only allowlisted top-level paths" step in ci.yml); these cheap source-level
// checks fail fast if the .vscodeignore exclusions or the single-prepublish
// package scripts regress -- without having to run `vsce package`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test(".vscodeignore excludes local tooling + generated package artefacts", () => {
  const lines = new Set(
    fs
      .readFileSync(path.join(root, ".vscodeignore"), "utf-8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  // Developer-machine tooling folders + memory files + built VSIXs. vsce
  // packages by the working tree (not .gitignore), so these must be excluded
  // explicitly or they leak into the Marketplace package.
  for (const pattern of [
    ".agents/**",
    ".claude/**",
    ".code-review-graph/**",
    ".superpowers/**",
    ".scratch/**",
    "AGENTS.md",
    "CLAUDE.md",
    ".prettierignore",
    "*.vsix",
  ]) {
    assert.ok(lines.has(pattern), `.vscodeignore must exclude ${pattern}`);
  }
});

test("package scripts let vsce run vscode:prepublish exactly once", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf-8"),
  );

  assert.equal(pkg.scripts.package, "vsce package --no-dependencies");
  assert.equal(
    pkg.scripts["package:dev"],
    "vsce package --no-dependencies --pre-release",
  );
  // prepublish still does the real build work (webview + tsc + esbuild bundle).
  assert.match(pkg.scripts["vscode:prepublish"], /bundle:ext/);
  // No packaging script may explicitly chain prepublish -- vsce runs it itself,
  // so an explicit call would build everything twice.
  for (const name of ["package", "package:dev", "publish:vsix"]) {
    assert.doesNotMatch(
      pkg.scripts[name],
      /vscode:prepublish/,
      `${name} must not explicitly run vscode:prepublish (vsce runs it once)`,
    );
  }
});
