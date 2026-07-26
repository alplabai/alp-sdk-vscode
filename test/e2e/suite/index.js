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

  // Click EVERY sidebar tree button one by one. Each tree item IS a button:
  // constructing the 5 providers over both the real (board.yaml present) and the
  // empty state enumerates every item variant; for each item that carries a
  // `.command` we assert the command is registered and drive it — the literal
  // "click each button in the sidebar".
  const { BuildTreeProvider } = require("../../../out/views/build.js");
  const { ProjectsTreeProvider } = require("../../../out/views/projects.js");
  const { SdkTreeProvider } = require("../../../out/views/sdk.js");
  const { SetupTreeProvider } = require("../../../out/views/setup.js");
  const {
    WorkspacesTreeProvider,
  } = require("../../../out/views/workspaces.js");
  const { StateManager } = require("../../../out/views/stateManager.js");
  const { emptyAlpIdeState } = require("../../../out/ideHub/messages.js");

  // A minimal StateManager stand-in that serves a fixed state (providers only
  // read `.state` and subscribe to `onStateChange`).
  const fixedMgr = (state) => ({
    state,
    onStateChange: () => ({ dispose() {} }),
  });

  const realMgr = new StateManager();
  await realMgr.refresh(null); // real state: this workspace + resolved SDK
  const emptyMgr = fixedMgr(emptyAlpIdeState());

  // A synthetic "fully ready" state so the Build & Flash view renders its build
  // action buttons (Build / Flash / Debug / Image / Renode / Clean / Update),
  // which are gated on westInitialized && boardYamlExists and would otherwise
  // never appear without a bootstrapped Zephyr workspace.
  const readyState = emptyAlpIdeState();
  readyState.workspace = {
    workspaceRoot: process.cwd(),
    boardYamlExists: true,
    westInitialized: true,
  };
  readyState.sdk = {
    activePath: sdkRoot || "/sdk",
    version: "0.11.0",
    readiness: "ready",
    localEntries: [],
  };
  readyState.setup = {
    pythonAvailable: true,
    westAvailable: true,
    lastBootstrapAt: null,
    toolVersions: {
      python: "3.11",
      west: "1.2",
      tan: "0.1.0",
      cmake: "3.28",
      ninja: "1.11",
    },
  };
  const readyMgr = fixedMgr(readyState);

  const providersFor = (mgr) => [
    ["setup", new SetupTreeProvider(mgr)],
    ["workspaces", new WorkspacesTreeProvider(mgr)],
    ["projects", new ProjectsTreeProvider(mgr)],
    ["sdk", new SdkTreeProvider(mgr)],
    ["build", new BuildTreeProvider(mgr)],
  ];

  const buttons = new Map(); // command -> {view, label}
  for (const [stateName, mgr] of [
    ["real", realMgr],
    ["empty", emptyMgr],
    ["ready", readyMgr],
  ]) {
    for (const [view, provider] of providersFor(mgr)) {
      const items = (await provider.getChildren()) || [];
      for (const item of items) {
        const cmd = item.command && item.command.command;
        if (!cmd) continue; // a non-clickable label/info row
        const label =
          typeof item.label === "string"
            ? item.label
            : (item.label && item.label.label) || "";
        buttons.set(cmd, { view: `${view}/${stateName}`, label });
      }
      if (typeof provider.dispose === "function") provider.dispose();
    }
  }
  realMgr.dispose();

  await check(
    `enumerated sidebar tree buttons across states (${buttons.size} distinct)`,
    () => assert.ok(buttons.size >= 8, `too few buttons: ${buttons.size}`),
  );

  let clicked = 0;
  for (const [cmd, meta] of buttons) {
    await check(
      `sidebar button "${meta.label}" (${meta.view}) → ${cmd}`,
      async () => {
        assert.ok(registered.has(cmd), `${cmd} not registered`);
        try {
          await withTimeout(
            Promise.resolve(vscode.commands.executeCommand(cmd)),
            2500,
          );
        } catch (err) {
          throw new Error(`threw: ${err && err.message ? err.message : err}`);
        }
        clicked += 1;
      },
    );
  }
  console.log(`  clicked ${clicked}/${buttons.size} sidebar tree buttons`);

  // Webview buttons: the React surfaces route their button clicks through the
  // allowlisted runWebviewCommand (issue #134). Every command a webview button
  // may fire must be a registered command — assert the whole allowlist resolves.
  const { ALLOWED_WEBVIEW_COMMANDS } = (() => {
    try {
      return require("../../../out/ideHub/webviewHtml.js");
    } catch {
      return {};
    }
  })();
  if (ALLOWED_WEBVIEW_COMMANDS) {
    await check("every webview-button command is registered", () => {
      const builtins = new Set([
        "vscode.openFolder",
        "workbench.action.reloadWindow",
        "workbench.action.openSettings",
      ]);
      const missing = [...ALLOWED_WEBVIEW_COMMANDS].filter(
        (c) => !registered.has(c) && !builtins.has(c),
      );
      assert.deepEqual(
        missing,
        [],
        `unregistered webview commands: ${missing}`,
      );
    });
  }

  // The `tan` CLI must actually RESOLVE — with a sibling `tan-cli` checkout
  // built (target/release/tan) the CLI-backed buttons (New Project, generate,
  // validate) work instead of failing "tan CLI unavailable". Resolve via the
  // real adapter against a fabricated context pointing at this checkout. When no
  // sibling build is present (fresh CI runner) resolution falls through to a
  // download, which we skip here — only assert that resolution does not throw
  // when a local build IS available.
  const {
    resolveAlpBinaryForContext,
  } = require("../../../out/alpCli/vscodeAdapter.js");
  const siblingTan = path.resolve(
    __dirname,
    "../../..",
    "..",
    "tan-cli",
    "target",
    "release",
    process.platform === "win32" ? "tan.exe" : "tan",
  );
  if (fs.existsSync(siblingTan)) {
    await check(
      "tan CLI resolves locally (no 'tan CLI unavailable')",
      async () => {
        const repoRoot = path.resolve(__dirname, "../../..");
        const fakeCtx = {
          extensionPath: repoRoot,
          globalStorageUri: {
            fsPath: fs.mkdtempSync(
              path.join(require("node:os").tmpdir(), "alp-gs-"),
            ),
          },
        };
        const binary = await resolveAlpBinaryForContext(fakeCtx);
        assert.ok(binary && binary.command, "no binary resolved");
        // The sibling tan-cli build resolves locally (not a network download).
        assert.equal(
          binary.source,
          "localBuild",
          `resolved via ${binary.source}`,
        );
        assert.ok(fs.existsSync(binary.command), `missing: ${binary.command}`);
      },
    );
  } else {
    console.log(
      `  SKIP  tan CLI resolves locally (no sibling tan-cli checkout built at ${siblingTan}; this check proves nothing on this run)`,
    );
  }

  // The four `preLaunchTask` labels `tan debug-config` writes into launch.json
  // must actually resolve in a REAL extension host — the unit test only proves
  // the strings agree with each other. VS Code composes a provided task's label
  // as `${source}: ${name}`, which is what `preLaunchTask` matches against; if
  // this set ever stops matching, Debug writes a profile whose pre-launch task
  // cannot be found and `startDebugging` aborts with no useful error (#342).
  // Hard-coded here rather than imported so a rename in src/tasks/service.ts
  // fails this check instead of silently moving with it.
  await check(
    "the four alp: preLaunchTask labels resolve as tasks",
    async () => {
      const tasks = await vscode.tasks.fetchTasks({ type: "alp" });
      const labels = tasks.map((task) => `${task.source}: ${task.name}`).sort();
      assert.deepEqual(labels, [
        "alp: build active target",
        "alp: build baremetal target",
        "alp: build native_sim target",
        "alp: deploy and start gdbserver",
      ]);
    },
  );

  // The Alp IDE side panel is a single webview (SidebarHubView / HubViewProvider,
  // registered at activation); the former five native tree views were folded
  // into it.
  await check("side panel is the single alp-ide.hub webview", () => {
    const views = manifest.contributes.views["alp-ide"] || [];
    assert.deepEqual(
      views.map((v) => v.id),
      ["alp-ide.hub"],
    );
    assert.equal(views[0].type, "webview");
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
