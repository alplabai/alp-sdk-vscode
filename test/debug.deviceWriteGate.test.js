// SPDX-License-Identifier: Apache-2.0
//
// The behaviour of the debug device-write consent gate (#586): what the
// customer sees before a debug session programs the board, what happens when
// they say no, and — the assertion that matters most — that the gate sits
// where it CANNOT be walked around.
//
// #549 gated `tan flash` and `west flash`. Debug reached the same silicon by a
// third route neither gate can see, and a fourth one the issue did not name:
// once `.vscode/launch.json` exists, plain F5 (or the Run and Debug dropdown)
// starts the very same cortex-debug configuration without going anywhere near
// this extension's commands. That is why the gate is a
// DebugConfigurationProvider and not an `if` in front of
// `vscode.debug.startDebugging` — a command-scoped check would leave F5 open,
// and F5 is the supported entry point (#406 exists to make it work).
//
// Drives the real `out/debug/deviceWriteGate.js` with only the presenter
// (`../notify/vscodeAdapter`), `../util` and the workspace probe
// (`./vscodeAdapter`) stubbed. The notification PLANNER is left real, so the
// dialog these tests read is the dialog `planConfirm` actually produces.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** The baremetal/OpenOCD shape tan writes, as recorded in #586. */
const LAUNCH = Object.freeze({
  name: "Alp: Baremetal Debug (OpenOCD)",
  type: "cortex-debug",
  request: "launch",
  cwd: "${workspaceFolder}",
  executable: "${workspaceFolder}/build/baremetal/app.elf",
  preLaunchTask: "alp: build baremetal target",
  servertype: "openocd",
});

/**
 * Load the gate with a scripted answer to the confirm modal.
 *
 * `answer` is what the presenter returns from `notify()` — the ActionId the
 * user picked, or `undefined` for a dismissed dialog. Every plan handed to
 * either presenter entry point is captured.
 */
function loadGate(answer, context = {}) {
  const plans = [];
  const logs = [];
  const modPath = require.resolve(
    path.join(root, "out", "debug", "deviceWriteGate.js"),
  );
  delete require.cache[modPath];
  const declinePath = require.resolve(
    path.join(root, "out", "debug", "consentDecline.js"),
  );
  delete require.cache[declinePath];
  const stubs = {
    "../notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return typeof answer === "function" ? answer(plan) : answer;
      },
      notifyAsync: (plan) => {
        plans.push(plan);
      },
    },
    "../util": { log: (line) => logs.push(line) },
    "./vscodeAdapter": {
      collectWorkspaceDebugContext: () => ({
        workspaceRoot: "/w",
        boardYamlExists: true,
        ...context,
      }),
    },
    vscode: {
      debug: {
        registerDebugConfigurationProvider: () => ({ dispose() {} }),
      },
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let mod;
  try {
    mod = require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
  return { mod, plans, logs, decline: require(declinePath) };
}

const confirmPlan = (plans) => plans.find((p) => p.channel === "modal");

// ---------------------------------------------------------------------------
// The negative assertion first: saying no writes nothing

test("a dismissed dialog aborts the session instead of starting it", async () => {
  // `undefined` from resolveDebugConfiguration is VS Code's "abort silently".
  // Returning the config — the shape of a careless early return — would start
  // the session and program the board on a dialog the user closed.
  for (const answer of [undefined, "showOutput", "startAnyway"]) {
    const { mod, plans } = loadGate(answer);
    assert.equal(
      await mod.resolveDebugDeviceWrite(undefined, { ...LAUNCH }),
      undefined,
      `answer=${String(answer)} must abort, not launch`,
    );
    assert.ok(confirmPlan(plans), "the user must have been asked");
  }
});

test("a declined session says so, and says nothing was written", async () => {
  const { mod, plans } = loadGate(undefined);
  await mod.resolveDebugDeviceWrite(undefined, { ...LAUNCH });
  const told = plans.find((p) => /cancelled/i.test(p.message ?? ""));
  assert.ok(told, "a declined debug session must not fail silently");
  assert.match(told.message, /nothing was written/i);
});

test("approving returns the configuration unchanged", async () => {
  const { mod, plans } = loadGate("programDevice");
  const resolved = await mod.resolveDebugDeviceWrite(undefined, { ...LAUNCH });
  assert.deepEqual(resolved, LAUNCH);
  assert.ok(confirmPlan(plans), "approval still has to be asked for");
});

// ---------------------------------------------------------------------------
// What is NOT gated

test("a session that programs nothing is never interrupted", async () => {
  for (const config of [
    { ...LAUNCH, request: "attach" },
    { ...LAUNCH, type: "cppdbg" },
    { ...LAUNCH, loadFiles: [] },
  ]) {
    const { mod, plans } = loadGate(undefined);
    assert.deepEqual(
      await mod.resolveDebugDeviceWrite(undefined, config),
      config,
      "a session that writes nothing must start without a dialog",
    );
    assert.equal(confirmPlan(plans), undefined, "nothing to ask about");
  }
});

test("a workspace with no board.yaml gets no Alp dialog", async () => {
  const { mod, plans } = loadGate(undefined, { boardYamlExists: false });
  assert.deepEqual(
    await mod.resolveDebugDeviceWrite(undefined, { ...LAUNCH }),
    LAUNCH,
  );
  assert.equal(confirmPlan(plans), undefined);
});

test("the dialog names the artefact, the server and the consequence", async () => {
  const { mod, plans } = loadGate("programDevice");
  await mod.resolveDebugDeviceWrite(undefined, { ...LAUNCH });
  const plan = confirmPlan(plans);
  assert.match(plan.message, /This writes to the device\./);
  assert.match(plan.modalDetail, /app\.elf/);
  assert.match(plan.modalDetail, /openocd/);
  assert.match(plan.modalDetail, /Nothing is written unless you continue\.$/);
  assert.deepEqual(
    plan.actions.map((a) => a.id),
    ["programDevice"],
    "the confirm must be caller-handled so the gate can read the pick",
  );
});

// ---------------------------------------------------------------------------
// Where the gate sits — source level, because these seams import real `vscode`

test("the provider is registered for cortex-debug at activation", () => {
  const source = fs.readFileSync(
    path.join(root, "src", "extension.ts"),
    "utf-8",
  );
  assert.match(
    source,
    /registerDebugDeviceWriteGate\(/,
    "an unregistered provider gates nothing",
  );
});

test("no setting can switch the gate off", () => {
  // A consent gate with an off switch is a consent gate that is off in the one
  // workspace where it mattered. #549 made the same call.
  //
  // The gate DOES read one setting — `alpSdk.boardYamlPath`, to find out which
  // folder is an Alp project — so "reads no configuration at all" would be the
  // wrong invariant to pin. What must stay true is that no setting it reads can
  // turn the dialog off, so the assertion is on WHICH keys are consulted.
  const source = fs.readFileSync(
    path.join(root, "src", "debug", "deviceWriteGate.ts"),
    "utf-8",
  );
  const keys = [...source.matchAll(/\.get<[^>]*>\("([^"]+)"\)/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    keys,
    ["boardYamlPath"],
    "the gate may look up which folder is an Alp project, and nothing else",
  );
  assert.doesNotMatch(
    source,
    /\b(enabled?|disabled?|skipConfirm|suppress|alwaysAllow)\b/i,
    "no opt-out vocabulary belongs in a consent gate",
  );
});

// ---------------------------------------------------------------------------
// The perimeter (all three found by an adversarial pass, not by these tests)
//
// The provider is only as good as the answer to "is this an Alp project", and
// that answer used to come from a window-global probe that reads
// `alpSdk.boardYamlPath` scoped to `vscode.window.activeTextEditor` — see
// src/project/vscodeAdapter.ts:66-71, whose own comment says it "falls back to
// window scope when no editor is active". F5 from the Run view is exactly the
// no-active-editor state, so a folder-pinned board.yaml was invisible and a
// real Alp launch came back "not-an-alp-workspace". The launch's OWN folder is
// the only correct input, and VS Code hands it to the provider.

/** Load the gate with a scripted workspace as well as a scripted answer. */
function loadGateInFolder(answer, world) {
  const plans = [];
  const found = [];
  const modPath = require.resolve(
    path.join(root, "out", "debug", "deviceWriteGate.js"),
  );
  delete require.cache[modPath];
  const declinePath = require.resolve(
    path.join(root, "out", "debug", "consentDecline.js"),
  );
  delete require.cache[declinePath];
  const stubs = {
    "../notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return answer;
      },
      notifyAsync: (plan) => plans.push(plan),
    },
    "../util": { log() {} },
    "./vscodeAdapter": {
      collectWorkspaceDebugContext: () => ({
        // Deliberately the WRONG answer: every folder-scoped test below must
        // pass or fail on the folder, never on this window-wide fallback.
        workspaceRoot: "/wrong",
        boardYamlExists: false,
      }),
    },
    fs: {
      existsSync: (p) => world.filesOnDisk.includes(p),
    },
    vscode: {
      debug: { registerDebugConfigurationProvider: () => ({ dispose() {} }) },
      RelativePattern: class {
        constructor(base, pattern) {
          this.base = base;
          this.pattern = pattern;
        }
      },
      workspace: {
        getConfiguration: (section, scope) => ({
          get: (key) => {
            found.push(`${section}.${key}@${scope ? scope.fsPath : "window"}`);
            return world.configuredBoardYamlPath;
          },
        }),
        findFiles: async () => world.deepMatches ?? [],
      },
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let mod;
  try {
    mod = require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
  return { mod, plans, found, decline: require(declinePath) };
}

const FOLDER = { uri: { fsPath: "/projects/blinky" } };

test("the launch's own folder decides, not the window's active editor", async () => {
  const { mod, plans, found } = loadGateInFolder(undefined, {
    configuredBoardYamlPath: "board.yaml",
    filesOnDisk: ["/projects/blinky/board.yaml"],
  });
  assert.equal(
    await mod.resolveDebugDeviceWrite(FOLDER, { ...LAUNCH }),
    undefined,
    "an Alp folder must be gated even when the window probe says otherwise",
  );
  assert.ok(confirmPlan(plans), "the customer must have been asked");
  assert.ok(
    found.some((f) => f.endsWith("@/projects/blinky")),
    "the boardYamlPath setting must be read scoped to the launch's folder",
  );
});

test("a folder's own boardYamlPath setting is honoured", async () => {
  // `alpSdk.boardYamlPath` is declared "scope": "resource" precisely so a
  // multi-root folder can pin its own. Reading it window-scoped loses that.
  const { mod, plans } = loadGateInFolder(undefined, {
    configuredBoardYamlPath: "hw/board.yaml",
    filesOnDisk: ["/projects/blinky/hw/board.yaml"],
  });
  await mod.resolveDebugDeviceWrite(FOLDER, { ...LAUNCH });
  assert.ok(confirmPlan(plans));
});

test("board.yaml one directory down still makes it an Alp project", async () => {
  // The activation predicate is `workspaceContains:**/board.yaml` — ANY depth.
  // A gate narrower than the event that switches it on leaves real projects
  // ungated: open the parent of a project and every launch escapes.
  const { mod, plans } = loadGateInFolder(undefined, {
    configuredBoardYamlPath: "board.yaml",
    filesOnDisk: [],
    deepMatches: [{ fsPath: "/projects/blinky/myproj/board.yaml" }],
  });
  assert.equal(
    await mod.resolveDebugDeviceWrite(FOLDER, { ...LAUNCH }),
    undefined,
  );
  assert.ok(confirmPlan(plans));
});

test("a folder with no board.yaml at any depth is somebody else's", async () => {
  const { mod, plans } = loadGateInFolder(undefined, {
    configuredBoardYamlPath: "board.yaml",
    filesOnDisk: [],
    deepMatches: [],
  });
  assert.deepEqual(
    await mod.resolveDebugDeviceWrite(FOLDER, { ...LAUNCH }),
    LAUNCH,
    "a stranger's cortex-debug session must start with no Alp dialog",
  );
  assert.equal(confirmPlan(plans), undefined);
});

test("the dialog names the launch's own folder, not the window's", async () => {
  // The artefact is printed verbatim and unexpanded (`${workspaceFolder}/...`),
  // so the folder line is the only thing telling the reader WHICH project's
  // image is about to reach the probe. Printing another folder's root next to
  // it is a consent screen describing the wrong board.
  const { mod, plans } = loadGateInFolder("programDevice", {
    configuredBoardYamlPath: "board.yaml",
    filesOnDisk: ["/projects/blinky/board.yaml"],
  });
  await mod.resolveDebugDeviceWrite(FOLDER, { ...LAUNCH });
  assert.match(confirmPlan(plans).modalDetail, /\/projects\/blinky/);
  assert.doesNotMatch(confirmPlan(plans).modalDetail, /\/wrong/);
});

// ---------------------------------------------------------------------------
// Activation — the gate cannot run if the extension is not awake

test("a cortex-debug launch wakes the extension before it is resolved", () => {
  // `workspaceContains:**/board.yaml` is an async file search; F5 is available
  // immediately. Without an onDebugResolve event VS Code never waits for this
  // extension, the provider is not registered yet, and the launch programs the
  // board with no dialog. cortex-debug itself declares onDebugResolve, which is
  // why the session works without us.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf-8"),
  );
  assert.ok(
    manifest.activationEvents.includes("onDebugResolve:cortex-debug"),
    "a provider registered after the launch resolves gates nothing",
  );
});

// ---------------------------------------------------------------------------
// One refusal, one message
//
// A refused launch and a launch VS Code itself turned down both come back as
// `startDebugging` resolving false, so without a bit passed back `alp.debug`
// reports a deliberate "no" as `Alp: VS Code declined to start "<name>" —
// check the Debug Console and launch.json.` — a second, contradictory message
// that sends the reader looking for a fault that is not there.

test("a refusal is remembered for the launch it refused, once", async () => {
  const { mod, decline } = loadGate(undefined);
  await mod.resolveDebugDeviceWrite(undefined, { ...LAUNCH });
  assert.equal(
    decline.consumeDebugConsentDeclined(LAUNCH.name),
    true,
    "the command must be able to tell a refusal from a failure",
  );
  assert.equal(
    decline.consumeDebugConsentDeclined(LAUNCH.name),
    false,
    "a bit left standing would silence the NEXT launch's real failure",
  );
});

test("a refusal for one configuration does not silence another's failure", async () => {
  const { mod, decline } = loadGate(undefined);
  await mod.resolveDebugDeviceWrite(undefined, { ...LAUNCH });
  assert.equal(
    decline.consumeDebugConsentDeclined("Alp: Zephyr Debug (J-Link)"),
    false,
  );
});

test("an APPROVED launch records no refusal", async () => {
  const { mod, decline } = loadGate("programDevice");
  await mod.resolveDebugDeviceWrite(undefined, { ...LAUNCH });
  assert.equal(decline.consumeDebugConsentDeclined(LAUNCH.name), false);
});

test("alp.debug does not report a refusal as a failure", () => {
  // Source level: `startDebugging` imports real `vscode` and cannot be driven
  // from node:test. What is pinned is that the failure branch is guarded.
  const source = fs.readFileSync(path.join(root, "src", "debug.ts"), "utf-8");
  assert.match(
    source,
    /if \(!started && !consumeDebugConsentDeclined\(result\.configName\)\) \{/,
    "a refused launch must not also be reported as a VS Code failure",
  );
});
