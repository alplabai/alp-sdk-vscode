const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test(".vscodeignore excludes local tooling and generated package artifacts", () => {
  const ignore = fs.readFileSync(path.join(root, ".vscodeignore"), "utf-8");
  const lines = new Set(
    ignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  for (const pattern of [
    ".agents/**",
    ".code-review-graph/**",
    ".superpowers/**",
    "AGENTS.md",
    "CLAUDE.md",
    "*.vsix",
  ]) {
    assert.ok(lines.has(pattern), `.vscodeignore must include ${pattern}`);
  }
});

test("package scripts let vsce run vscode:prepublish exactly once", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));

  assert.equal(pkg.scripts.package, "vsce package --no-dependencies");
  assert.equal(
    pkg.scripts["package:dev"],
    "vsce package --no-dependencies --pre-release",
  );
  assert.match(pkg.scripts["vscode:prepublish"], /bundle:ext/);
});
