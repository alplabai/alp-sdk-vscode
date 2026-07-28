// SPDX-License-Identifier: Apache-2.0
//
// The OFFER around the `ALP:`/`Alp:` repair — the half that makes it safe, and
// the half no pure-planner test can see.
//
// `test/debug.rescue.test.js` proves what the merge decides. It cannot prove
// that the customer was asked first, and every property that keeps this repair
// from being a silent rewrite of a file the customer owns lives out here:
//
//   1. no duplicate -> not one word, and nothing read past the file;
//   2. nothing is written until an `applyChanges` pick comes BACK from the
//      seam — an edit that moved the write above that gate would stay green
//      against the planner alone;
//   3. a dismissed offer is RE-OFFERED. It was recorded before the pick once,
//      which meant one accidental dismissal stranded the value for the life of
//      the workspace and left the customer with a broken F5 whose only fix is a
//      command they have never heard of. `src/ideHub/setupOrchestrator.ts`
//      already ruled on this shape; only "Don't show again" records.
//
// So these drive the REAL `maybeRescueOrphanedLaunchConfig` out of `out/`
// (the `Module._load` swap generalised in test/cancellation.sweep.test.js)
// against a REAL launch.json in a temp dir, with the notification seam and the
// workspace root as the only fakes.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** A relative stub key stands for that module however it is SPELLED: `out/`
 *  reaches `util.js` as `./util` from `debug.js` and as `../util` from
 *  `notify/vscodeAdapter.js`, and an exact-string swap catches only the first —
 *  leaving the real output channel to be built against a fake `vscode`. */
function matches(request, key) {
  return (
    request === key || (key.startsWith("./") && request.endsWith(key.slice(1)))
  );
}

/** Load `out/<rel>.js` with `stubs` standing in for the requires named. Swaps
 *  Node's loader only for the duration of the synchronous require, so it never
 *  leaks into another test file sharing the process. */
function load(rel, stubs) {
  const modPath = require.resolve(path.join(root, "out", `${rel}.js`));
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    const key = Object.keys(stubs).find((k) => matches(request, k));
    return key ? stubs[key] : originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

const ORPHANED = {
  version: "0.2.0",
  configurations: [
    {
      name: "Alp: Zephyr Debug (J-Link)",
      type: "cortex-debug",
      servertype: "jlink",
      device: "AE822F4M55_HP",
    },
    {
      name: "ALP: Zephyr Debug (J-Link)",
      type: "cortex-debug",
      servertype: "jlink",
      device: "<resolved-device>",
    },
  ],
};

const NO_DUPLICATE = {
  version: "0.2.0",
  configurations: [
    { name: "ALP: Zephyr Debug (J-Link)", device: "<resolved-device>" },
  ],
};

/** A workspace root holding a real `.vscode/launch.json`. */
function workspace(document) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-rescue-"));
  fs.mkdirSync(path.join(dir, ".vscode"));
  fs.writeFileSync(
    path.join(dir, ".vscode", "launch.json"),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf-8",
  );
  return dir;
}

function launchJson(dir) {
  return fs.readFileSync(path.join(dir, ".vscode", "launch.json"), "utf-8");
}

/** `maybeRescueOrphanedLaunchConfig` with the seam faked: `picks` is answered
 *  to the offers in order, `toasts` records every plan presented, and
 *  `state` is the workspaceState the one-shot key lands in. */
function harness(workspaceRoot, picks) {
  const toasts = [];
  const state = new Map();
  const vscode = {
    window: {},
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
    commands: { executeCommand: async () => undefined },
    extensions: { getExtension: () => undefined },
    Uri: { file: (p) => ({ fsPath: p }) },
    ProgressLocation: { Notification: 15 },
    EventEmitter: class {
      constructor() {
        this.event = () => ({ dispose() {} });
      }
      fire() {}
      dispose() {}
    },
  };
  const mod = load("debug", {
    vscode,
    "./debug/vscodeAdapter": {
      collectWorkspaceDebugContext: () => ({ workspaceRoot }),
      collectRuntimeCapabilities: () => ({}),
      fileExists: () => false,
      writeSupportBundle: () => "",
    },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        toasts.push(plan);
        return picks.shift();
      },
    },
    "./util": { log: () => undefined, showOutput: () => undefined },
  });
  const context = {
    workspaceState: {
      get: (key, fallback) => (state.has(key) ? state.get(key) : fallback),
      update: async (key, value) => void state.set(key, value),
    },
  };
  return {
    toasts,
    state,
    offer: (options) => mod.maybeRescueOrphanedLaunchConfig(context, options),
  };
}

test("a launch.json with no duplicate never says a word", async () => {
  const dir = workspace(NO_DUPLICATE);
  const before = launchJson(dir);
  const h = harness(dir, []);
  await h.offer({ oneShot: true });
  assert.deepStrictEqual(h.toasts, []);
  assert.equal(launchJson(dir), before);
});

test("nothing is written until the customer accepts", async () => {
  // The gate is `if (choice !== "applyChanges") return;`. Both non-answers go
  // through it: a dismissal (undefined) and "Open launch.json", which the
  // presenter runs itself and reports back as no pick.
  for (const pick of [undefined, undefined]) {
    const dir = workspace(ORPHANED);
    const before = launchJson(dir);
    const h = harness(dir, [pick]);
    await h.offer({
      oneShot: false,
      maintainedName: "ALP: Zephyr Debug (J-Link)",
    });
    assert.equal(h.toasts.length, 1);
    assert.equal(launchJson(dir), before, "the customer's file was rewritten");
  }
});

test("accepting repairs the file, and only then", async () => {
  const dir = workspace(ORPHANED);
  const h = harness(dir, ["applyChanges"]);
  await h.offer({
    oneShot: false,
    maintainedName: "ALP: Zephyr Debug (J-Link)",
  });

  assert.deepStrictEqual(JSON.parse(launchJson(dir)), {
    version: "0.2.0",
    configurations: [
      {
        name: "ALP: Zephyr Debug (J-Link)",
        type: "cortex-debug",
        servertype: "jlink",
        device: "AE822F4M55_HP",
      },
    ],
  });
  // tan's own shape: two-space indent, trailing newline, no churn on its next
  // write.
  assert.ok(launchJson(dir).endsWith("}\n"));
});

test("a dismissed offer comes back on the next activation", async () => {
  // The one-shot key used to be recorded BEFORE the pick, "because a window
  // closing mid-offer never lands the write" — but the update is awaited to
  // completion first, so it always landed. Window 1 asked and died; window 2
  // showed nothing, forever.
  const dir = workspace(ORPHANED);
  const h = harness(dir, [undefined, undefined]);
  await h.offer({ oneShot: true });
  await h.offer({ oneShot: true });
  assert.equal(h.toasts.length, 2, "an unanswered offer must be retried");
  assert.deepStrictEqual([...h.state.keys()], [], "nothing was recorded");
});

test('"Don\'t show again" is the only answer that silences it', async () => {
  const dir = workspace(ORPHANED);
  const h = harness(dir, ["custom", "custom"]);
  await h.offer({ oneShot: true });
  await h.offer({ oneShot: true });

  assert.equal(h.toasts.length, 1);
  assert.deepStrictEqual(
    [...h.state.entries()],
    [[`alp.launchConfigRescueOffered:${dir}`, true]],
  );
  // Silenced, not repaired: it is still the customer's file.
  assert.equal(JSON.parse(launchJson(dir)).configurations.length, 2);
});

test("only the activation offer carries a stop-asking button", async () => {
  // From Alp: Configure Debug Profile the customer asked the question, so the
  // answer is an answer, not a nag — and a "Don't show again" there would
  // silence an activation offer they never saw.
  const dir = workspace(ORPHANED);
  const activation = harness(dir, [undefined]);
  await activation.offer({ oneShot: true });
  const command = harness(dir, [undefined]);
  await command.offer({
    oneShot: false,
    maintainedName: "ALP: Zephyr Debug (J-Link)",
  });

  assert.deepStrictEqual(
    activation.toasts[0].actions.map((a) => a.id),
    ["applyChanges", "openLaunchJson", "custom"],
  );
  assert.deepStrictEqual(
    command.toasts[0].actions.map((a) => a.id),
    ["applyChanges", "openLaunchJson"],
  );
});

test("a discarded hand-filled value is reported to the customer", async () => {
  // The repair overwrote their file in place with no backup, so the message
  // that follows is the only place a deleted value is ever named.
  const dir = workspace({
    version: "0.2.0",
    configurations: [
      {
        name: "Alp: Zephyr Debug (J-Link)",
        device: "AE822F4M55_HP",
        myOwnKey: "keep-me",
      },
      { name: "ALP: Zephyr Debug (J-Link)", device: "AE722F80F55_HP" },
    ],
  });
  const h = harness(dir, ["applyChanges"]);
  await h.offer({
    oneShot: false,
    maintainedName: "ALP: Zephyr Debug (J-Link)",
  });

  const outcome = h.toasts[1];
  assert.match(outcome.message, /device was discarded/);
  assert.equal(outcome.channel, "toast", "not the status bar, for a deletion");
});
