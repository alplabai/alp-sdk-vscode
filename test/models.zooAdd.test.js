// SPDX-License-Identifier: Apache-2.0
//
// `tan model zoo` and `tan model add` are spawned again (#699). Through the
// 0.6.0 pin neither existed, so `src/models/panel.ts` answered both from the
// pin with `unsupportedModelSubcommand`; the 0.7.0-rc1 pin carries
// tan-cli#1338, so the short-circuit is gone.
//
// Same `Module._load` swap test/models.buildModelNoWorkspace.test.js uses:
// drives the REAL handlers out of `out/models/panel.js` through the webview
// message channel, and asserts on what was spawned and what was posted —
// a source-level grep cannot tell a spawn from a synthesised answer.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Open the panel with a stubbed host and return its message handler plus
 *  everything it spawned, posted and reported. */
function openPanel({ workspaceRoot, envelope }) {
  const spawns = [];
  const posted = [];
  const errors = [];
  const notified = [];
  let onMessage = null;

  const modPath = require.resolve(path.join(root, "out", "models", "panel.js"));
  delete require.cache[modPath];
  const stubs = {
    vscode: {
      window: {
        createWebviewPanel: () => ({
          webview: {
            set html(_v) {},
            onDidReceiveMessage: (handler) => {
              onMessage = handler;
              return { dispose() {} };
            },
            postMessage: async (msg) => {
              posted.push(msg);
              return true;
            },
          },
          onDidDispose: () => ({ dispose() {} }),
          reveal() {},
          dispose() {},
        }),
        withProgress: async (_opts, task) => task({ report() {} }, {}),
      },
      ProgressLocation: { Notification: 15 },
      ViewColumn: { Active: 1 },
      Uri: { joinPath: (...p) => p.join("/") },
      env: { openExternal() {} },
    },
    "../alpCli/vscodeAdapter": {
      runAlpCommand: async (_ctx, args, cwd, options) => {
        spawns.push({ args: [...args], cwd, options });
        return { outcome: { exitCode: 0, message: "", envelope } };
      },
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot }),
    },
    "../ideHub/webviewHtml": {
      buildWebviewHtml: () => "<html></html>",
      runWebviewCommand: () => {},
    },
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => notified.push(plan),
      reportError: async (message) => errors.push(message),
    },
    "../util": { log() {} },
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  try {
    require(modPath).showModelsPanel({ extensionUri: "/ext" });
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
  return {
    send: (msg) => onMessage(msg),
    spawns,
    posted,
    errors,
    notified,
  };
}

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
};

const zooEnvelope = {
  command: "model",
  ok: true,
  exitCode: 0,
  project: { root: "/ws", boardYaml: "/ws/board.yaml" },
  data: {
    schemaVersion: "1",
    sku: null,
    boardSku: "E1M-AEN801",
    entries: [{ id: "kws", validatedSoms: ["E1M-AEN801"], runsHere: true }],
  },
  issues: [],
};

test("the zoo section spawns `tan model zoo` in the project, not a synthesised refusal", async () => {
  const panel = openPanel({ workspaceRoot: "/ws", envelope: zooEnvelope });
  panel.send({ type: "requestZoo" });
  await settle();

  assert.deepEqual(
    panel.spawns.map((s) => [s.args, s.cwd]),
    [[["model", "zoo"], "/ws"]],
  );
  const zoo = panel.posted.find((m) => m.type === "zooData");
  assert.equal(zoo.ok, true);
  assert.deepEqual(zoo.entries, zooEnvelope.data.entries);
  assert.equal(
    zoo.issues.some((issue) =>
      /unknown-subcommand|panel-not-wired/.test(issue.code),
    ),
    false,
    "the 0.7.0-rc1 pin implements `zoo`; neither capability verdict belongs here",
  );
});

test("adding a zoo entry spawns `tan model add <id>` and refreshes on success", async () => {
  const panel = openPanel({
    workspaceRoot: "/ws",
    envelope: { ...zooEnvelope, data: { added: "kws" } },
  });
  panel.send({ type: "addFromZoo", id: "kws" });
  await settle();

  const add = panel.spawns.find((s) => s.args[1] === "add");
  assert.deepEqual(add.args, ["model", "add", "kws"]);
  assert.equal(add.cwd, "/ws");
  assert.ok(add.options?.timeoutMs > 60_000, "a fetch can be a real download");

  const order = panel.posted.map((m) => m.type);
  assert.ok(
    order.indexOf("zooAddStarted") < order.indexOf("zooAddResult"),
    `the section is told work started before it is told the result — ${order}`,
  );
  const result = panel.posted.find((m) => m.type === "zooAddResult");
  assert.equal(result.ok, true);
  assert.equal(result.added, "kws");
  assert.ok(
    panel.spawns.some((s) => s.args[1] === "zoo"),
    "a successful add refreshes, so the gallery re-reads the zoo",
  );
  assert.deepEqual(panel.errors, []);
});

test("a refused add is reported, never silent", async () => {
  const panel = openPanel({
    workspaceRoot: "/ws",
    envelope: {
      command: "model",
      ok: false,
      exitCode: 2,
      project: { root: "/ws", boardYaml: "/ws/board.yaml" },
      data: null,
      issues: [
        {
          code: "model.failed",
          severity: "error",
          message: "already in models:",
        },
      ],
    },
  });
  panel.send({ type: "addFromZoo", id: "kws" });
  await settle();

  const result = panel.posted.find((m) => m.type === "zooAddResult");
  assert.equal(result.ok, false);
  assert.equal(panel.errors.length, 1);
  assert.match(panel.errors[0], /kws/);
});

test("with no folder open, add spawns nothing and says why", async () => {
  const panel = openPanel({ workspaceRoot: undefined, envelope: zooEnvelope });
  panel.send({ type: "addFromZoo", id: "kws" });
  panel.send({ type: "requestZoo" });
  await settle();

  assert.deepEqual(
    panel.spawns,
    [],
    "`add` WRITES; with no workspace root it would write into the extension " +
      "host's own cwd (#605)",
  );
  assert.ok(panel.notified.length >= 1, "the click is never silent");
  const result = panel.posted.find((m) => m.type === "zooAddResult");
  assert.equal(result.ok, false);
  assert.equal(
    panel.posted.some((m) => m.type === "zooAddStarted"),
    false,
    "no spinner for work that is not starting",
  );
  assert.equal(panel.posted.find((m) => m.type === "zooData").ok, false);
});
