// SPDX-License-Identifier: Apache-2.0
//
// Runs INSIDE the VS Code extension host (has the real `vscode` API). Activates
// the Alp IDE extension and drives it end-to-end: every contributed command is
// registered, the extension activates cleanly, and the safe read-only commands
// (the ones the sidebar "buttons" fire) execute without throwing.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vscode = require("vscode");

const EXT_ID = "AlpLabAI.alp-sdk";

// Commands that open a panel / refresh / show output — safe to invoke in a
// headless run (no prompt that blocks, no filesystem mutation, no flash).
const SAFE_COMMANDS = [
  "alp.showOutput",
  "alp.openOverview",
  "alp.openSetupFlow",
  "alp.openSdkManager",
  "alp.views.refresh",
  "alp.showBuildPlan",
];

async function runChecks() {
  const results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  PASS  ${name}`);
    } catch (err) {
      results.push({
        name,
        ok: false,
        err: String(err && err.message ? err.message : err),
      });
      console.log(
        `  FAIL  ${name}\n        ${err && err.stack ? err.stack : err}`,
      );
    }
  };

  const ext = vscode.extensions.getExtension(EXT_ID);
  await check("extension is present", () =>
    assert.ok(ext, `${EXT_ID} not found`),
  );
  await check("extension activates without throwing", async () => {
    await ext.activate();
    assert.equal(ext.isActive, true);
  });

  // Every command the manifest contributes must actually be registered.
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf-8"),
  );
  const contributed = [
    ...new Set((manifest.contributes.commands || []).map((c) => c.command)),
  ];
  const registered = new Set(await vscode.commands.getCommands(true));
  await check(
    `all ${contributed.length} contributed commands are registered`,
    () => {
      const missing = contributed.filter((c) => !registered.has(c));
      assert.deepEqual(missing, [], `unregistered: ${missing.join(", ")}`);
    },
  );

  // Invoke the safe "button" commands — these are what the sidebar tree items
  // fire. Executing them must not throw.
  for (const cmd of SAFE_COMMANDS) {
    await check(`command executes: ${cmd}`, async () => {
      assert.ok(registered.has(cmd), `${cmd} not registered`);
      await vscode.commands.executeCommand(cmd);
    });
  }

  // The five contributed views must exist (their providers registered at activation).
  await check("all 5 tree views are contributed", () => {
    const views = (manifest.contributes.views["alp-ide"] || []).map(
      (v) => v.id,
    );
    assert.deepEqual(views.sort(), [
      "alp-ide.build",
      "alp-ide.projects",
      "alp-ide.sdk",
      "alp-ide.setup",
      "alp-ide.workspaces",
    ]);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\ne2e: ${results.length - failed.length}/${results.length} checks passed`,
  );
  if (failed.length) {
    throw new Error(
      `${failed.length} e2e check(s) failed: ${failed.map((f) => f.name).join("; ")}`,
    );
  }
}

// @vscode/test-electron calls this exported run().
exports.run = function run() {
  return runChecks();
};
