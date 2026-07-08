const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readManifest() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
  );
}

test("manifest advertises the embedded debug companion stack", () => {
  const manifest = readManifest();

  assert.ok(manifest.categories.includes("Debuggers"));
  assert.ok(manifest.keywords.includes("debug"));
  assert.ok(manifest.keywords.includes("svd"));
  assert.deepEqual(manifest.extensionPack, [
    "marus25.cortex-debug",
    "mcu-debug.peripheral-viewer",
    "mcu-debug.memory-view",
    "ms-vscode.cpptools",
    "vadimcn.vscode-lldb",
  ]);
});
