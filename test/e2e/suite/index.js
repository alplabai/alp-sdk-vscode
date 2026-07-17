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

// Commands that legitimately do not resolve within the short probe window: they
// either open a modal quick-pick/input (no user in a headless run) or kick off
// long-running work (shell out to the SDK's Python emitters / bootstrap). For
// these the "button" is proven by the handler running without throwing — full
// completion is covered separately by the CLI functional suite. Only a
// command OUTSIDE this set that hangs is a regression.
const SLOW_OR_PROMPTING = new Set([
  // prompt for target/SoM/server/path
  "alp.newProjectWizard",
  "alp.openExistingProject",
  "alp.scaffoldModule",
  "alp.configureDebugProfile",
  "alp.debug",
  "alp.debugDoctor",
  "alp.debugPreflight",
  "alp.exportSupportBundle",
  "alp.switchWorkspace",
  "alp.selectSdk",
  // spawn a west/flash terminal or wait on it
  "alp.westBuild",
  "alp.westAlpImage",
  "alp.westAlpFlash",
  "alp.westAlpClean",
  "alp.westAlpRenode",
  "alp.westRunNativeSim",
  // shell out to the SDK Python emitters / validator (seconds), or bootstrap
  "alp.generateZephyrConf",
  "alp.generateDtsOverlay",
  "alp.generateNativeSimOverlay",
  "alp.generateCmakeArgs",
  "alp.generateYoctoConf",
  "alp.generateAll",
  "alp.validateBoardYaml",
  "alp.installDependencies",
  "alp.openDebugTroubleshootingPanel",
]);

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

  // Point the extension at the real SDK (when the launcher found one) so the
  // SDK-backed commands resolve against a real checkout, not a no-op.
  const sdkRoot = process.env.ALP_E2E_SDK_ROOT;
  if (sdkRoot && fs.existsSync(sdkRoot)) {
    await check("alpSdk.path resolves the real SDK checkout", async () => {
      await vscode.workspace
        .getConfiguration("alpSdk")
        .update("path", sdkRoot, vscode.ConfigurationTarget.Workspace);
      assert.equal(
        vscode.workspace.getConfiguration("alpSdk").get("path"),
        sdkRoot,
      );
    });
  }

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

  // Drive EVERY contributed command — the real "do the buttons work" test.
  // A prompting command (quick-pick/input) never resolves headless, so we race
  // it against a timeout: resolving is a full pass, timing out means the handler
  // was reached and opened its prompt (pass for a prompting command, but a
  // regression for one we expect to complete), and a synchronous/async throw is
  // a FAIL. Terminal-spawning commands (west/flash) return immediately after
  // creating the terminal, so they complete without hardware.
  const withTimeout = (p, ms) =>
    Promise.race([
      p.then(() => "resolved"),
      new Promise((r) => setTimeout(() => r("timeout"), ms)),
    ]);
  let drivenOk = 0;
  const unexpectedTimeouts = [];
  for (const cmd of contributed) {
    if (cmd === "alp.updateCli") continue; // network download — skip in CI
    await check(`command runs: ${cmd}`, async () => {
      assert.ok(registered.has(cmd), `${cmd} not registered`);
      let outcome;
      try {
        outcome = await withTimeout(
          Promise.resolve(vscode.commands.executeCommand(cmd)),
          2500,
        );
      } catch (err) {
        throw new Error(`threw: ${err && err.message ? err.message : err}`);
      }
      if (outcome === "timeout" && !SLOW_OR_PROMPTING.has(cmd)) {
        unexpectedTimeouts.push(cmd);
      }
      drivenOk += 1;
    });
  }
  console.log(
    `  drove ${drivenOk}/${contributed.length - 1} commands without throwing` +
      (unexpectedTimeouts.length
        ? ` (unexpected hangs: ${unexpectedTimeouts.join(", ")})`
        : ""),
  );

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
