// SPDX-License-Identifier: Apache-2.0
//
// Wiring checks for `alp.installTanCli` (runs the bundled tan-cli install
// script in a terminal so `tan` lands on the user's PATH globally, distinct
// from the private managed-download resolver). These are cheap source-level
// checks -- they don't spawn a terminal or a shell -- so they catch a
// mis-wired command id, a missing bundled script, or an allowlist regression
// without needing `vsce package` + the electron test harness.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const scriptDir = path.join(root, "media", "tan-install");

test("alp.installTanCli is contributed as a command", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf-8"),
  );
  const commands = pkg.contributes.commands;
  const cmd = commands.find((c) => c.command === "alp.installTanCli");
  assert.ok(
    cmd,
    "package.json contributes.commands must list alp.installTanCli",
  );
  assert.equal(cmd.title, "Alp: Install tan CLI (global)");
  assert.equal(cmd.category, "Alp");
});

test("the bundled install scripts the handler runs exist under media/tan-install/", () => {
  // Must match the scriptDir the handler (src/alpCli/vscodeAdapter.ts,
  // installTanCliGlobally) resolves from context.extensionPath.
  for (const name of ["install.sh", "install.ps1"]) {
    const p = path.join(scriptDir, name);
    assert.ok(fs.existsSync(p), `${p} must exist (bundled by the extension)`);
  }
});

test("install.sh is executable so a direct invocation works", () => {
  const mode = fs.statSync(path.join(scriptDir, "install.sh")).mode;
  assert.ok(mode & 0o111, "install.sh should carry the executable bit");
});

test("check-vsix-allowlist.sh's allowlist covers media/, the top-level dir the bundled scripts ship under", () => {
  const allowlistScript = fs.readFileSync(
    path.join(root, "scripts", "check-vsix-allowlist.sh"),
    "utf-8",
  );
  // media/tan-install/ is a subdirectory of the already-allowlisted top-level
  // `media` entry -- the gate only checks top-level paths -- so this asserts
  // that entry is present and .vscodeignore doesn't exclude the subdirectory.
  assert.match(
    allowlistScript,
    /\bmedia\b/,
    "scripts/check-vsix-allowlist.sh must allowlist the top-level media dir",
  );

  const vscodeignore = fs.readFileSync(
    path.join(root, ".vscodeignore"),
    "utf-8",
  );
  assert.doesNotMatch(
    vscodeignore,
    /^media\/tan-install\/\*\*/m,
    "media/tan-install/** must not be excluded by .vscodeignore",
  );
  assert.doesNotMatch(
    vscodeignore,
    /^media\/\*\*$/m,
    "media/** must not be excluded wholesale by .vscodeignore",
  );
});

test("extension.ts registers the alp.installTanCli handler (not just contributes it)", () => {
  // A command contributed in package.json but never registerCommand()'d is a
  // dead palette entry that does nothing — assert the wiring exists.
  const ext = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf-8");
  assert.match(
    ext,
    /registerCommand\(\s*["']alp\.installTanCli["']/,
    "extension.ts must registerCommand('alp.installTanCli')",
  );
});
