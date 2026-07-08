const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("alp.connectSdk is contributed and wired into extension activation", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
  const commands = new Set((pkg.contributes.commands ?? []).map((entry) => entry.command));
  const activationEvents = new Set(pkg.activationEvents ?? []);
  const extensionSource = fs.readFileSync(
    path.join(root, "src", "extension.ts"),
    "utf-8",
  );

  assert.ok(commands.has("alp.connectSdk"), "command palette must expose alp.connectSdk");
  assert.ok(
    activationEvents.has("onCommand:alp.connectSdk"),
    "extension must activate when alp.connectSdk is invoked",
  );
  assert.match(extensionSource, /registerSdkConnectCommand\(\)/);
  assert.match(extensionSource, /maybeOfferSdkConnect\(context\)/);
});
