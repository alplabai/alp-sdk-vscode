// SPDX-License-Identifier: Apache-2.0
//
// `tan model zoo` and `tan model add` are spawned again (#699). Through the
// 0.6.0 pin neither existed, so `src/models/panel.ts` answered both from the
// pin with `unsupportedModelSubcommand`; the 0.7.0 pin carries
// tan-cli#1338, so the short-circuit is gone.
//
// Same `Module._load` swap test/models.buildModelNoWorkspace.test.js uses:
// drives the REAL handlers out of `out/models/panel.js` through the webview
// message channel, and asserts on what was spawned and what was posted —
// a source-level grep cannot tell a spawn from a synthesised answer.
//
// Two guards ride on `add` and are pinned here too: the id must be one the
// last zoo listing returned (it arrives from the webview and goes into argv),
// and a DIRTY board.yaml buffer stops the add unless the customer saves first
// (tan's on-disk splice would otherwise be overwritten by that save, leaving
// an orphaned model file that a re-add then refuses).

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const WS = path.resolve("/ws");

const zooEnvelope = {
  command: "model",
  ok: true,
  exitCode: 0,
  project: { root: WS, boardYaml: path.join(WS, "board.yaml") },
  data: {
    schemaVersion: "1",
    sku: null,
    boardSku: "E1M-AEN801",
    entries: [{ id: "kws", validatedSoms: ["E1M-AEN801"], runsHere: true }],
  },
  issues: [],
};

const addedEnvelope = { ...zooEnvelope, data: { added: "kws" } };

const refusedEnvelope = {
  command: "model",
  ok: false,
  exitCode: 2,
  project: zooEnvelope.project,
  data: null,
  issues: [
    { code: "model.failed", severity: "error", message: "already in models:" },
  ],
};

/**
 * Open the panel with a stubbed host.
 *
 * @param opts.workspaceRoot what `collectProjectContext` resolves.
 * @param opts.add           the envelope `tan model add` answers with.
 * @param opts.documents     `vscode.workspace.textDocuments`.
 * @param opts.answer        the action id the modal confirm returns, or
 *                           `undefined` for dismissed.
 */
function openPanel(opts) {
  const spawns = [];
  const posted = [];
  const errors = [];
  const notified = [];
  const warnings = [];
  let onMessage = null;
  const disposeHandlers = [];
  let disposed = false;

  const modPath = require.resolve(path.join(root, "out", "models", "panel.js"));
  delete require.cache[modPath];
  const stubs = {
    vscode: {
      workspace: { textDocuments: opts.documents ?? [] },
      window: {
        createWebviewPanel: () => ({
          webview: {
            set html(_v) {},
            onDidReceiveMessage: (handler) => {
              onMessage = handler;
              return { dispose() {} };
            },
            // What VS Code does: a disposed webview THROWS (synchronously).
            postMessage: async (msg) => {
              if (disposed) throw new Error("Webview is disposed");
              posted.push(msg);
              return true;
            },
          },
          onDidDispose: (handler) => {
            disposeHandlers.push(handler);
            return { dispose() {} };
          },
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
        if (args[1] === "add" && opts.holdAdd) await opts.holdAdd;
        const envelope =
          args[1] === "add" ? (opts.add ?? addedEnvelope) : zooEnvelope;
        return { outcome: { exitCode: 0, message: "", envelope } };
      },
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({ workspaceRoot: opts.workspaceRoot }),
    },
    "../ideHub/webviewHtml": {
      buildWebviewHtml: () => "<html></html>",
      runWebviewCommand: () => {},
    },
    "../notify/vscodeAdapter": {
      notifyAsync: (plan) => notified.push(plan),
      // The save-first confirm, through the one presenter seam.
      notify: async (plan) => {
        warnings.push(plan);
        return opts.answer;
      },
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
  let mod;
  try {
    mod = require(modPath);
    mod.showModelsPanel({ extensionUri: "/ext" });
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
  return {
    /** VS Code closing the panel: handlers run, later posts throw. */
    close: () => {
      disposed = true;
      for (const handler of disposeHandlers) handler();
    },
    /** Open the panel again on the SAME module instance (a reopen). */
    reopen: () => {
      disposed = false;
      mod.showModelsPanel({ extensionUri: "/ext" });
    },
    send: (msg) => onMessage(msg),
    spawns,
    posted,
    errors,
    notified,
    warnings,
  };
}

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r));
};

/** List the zoo, then add `id` — the order a real click arrives in. */
async function listThenAdd(panel, id = "kws") {
  panel.send({ type: "requestZoo" });
  await settle();
  panel.send({ type: "addFromZoo", id });
  await settle();
}

/** A board.yaml editor buffer, dirty or clean, recording whether it saved. */
const boardDoc = (isDirty, fsPath = path.join(WS, "board.yaml")) => {
  const doc = {
    isDirty,
    uri: { fsPath },
    saved: false,
    save: async () => {
      doc.saved = true;
      return true;
    },
  };
  return doc;
};

const addSpawned = (panel) => panel.spawns.some((s) => s.args[1] === "add");

test("the zoo section spawns `tan model zoo` in the project, not a synthesised refusal", async () => {
  const panel = openPanel({ workspaceRoot: WS });
  panel.send({ type: "requestZoo" });
  await settle();

  assert.deepEqual(
    panel.spawns.map((s) => [s.args, s.cwd]),
    [[["model", "zoo"], WS]],
  );
  const zoo = panel.posted.find((m) => m.type === "zooData");
  assert.equal(zoo.ok, true);
  assert.deepEqual(zoo.entries, zooEnvelope.data.entries);
  assert.equal(
    zoo.issues.some((issue) =>
      /unknown-subcommand|panel-not-wired/.test(issue.code),
    ),
    false,
    "the 0.7.0 pin implements `zoo`; neither capability verdict belongs here",
  );
});

test("adding a zoo entry spawns `tan model add <id>` and refreshes on success", async () => {
  const panel = openPanel({ workspaceRoot: WS });
  await listThenAdd(panel);

  const add = panel.spawns.find((s) => s.args[1] === "add");
  assert.deepEqual(add.args, ["model", "add", "kws"]);
  assert.equal(add.cwd, WS);
  assert.ok(add.options?.timeoutMs > 60_000, "a fetch can be a real download");

  const order = panel.posted.map((m) => m.type);
  assert.ok(
    order.indexOf("zooAddStarted") < order.indexOf("zooAddResult"),
    `the section is told work started before it is told the result — ${order}`,
  );
  const result = panel.posted.find((m) => m.type === "zooAddResult");
  assert.equal(result.ok, true);
  assert.equal(result.added, "kws");
  assert.equal(
    panel.spawns.filter((s) => s.args[1] === "zoo").length,
    2,
    "a successful add refreshes, so the gallery re-reads the zoo",
  );
  assert.deepEqual(panel.errors, []);
});

test("a refused add is reported, never silent", async () => {
  const panel = openPanel({ workspaceRoot: WS, add: refusedEnvelope });
  await listThenAdd(panel);

  const result = panel.posted.find((m) => m.type === "zooAddResult");
  assert.equal(result.ok, false);
  assert.equal(panel.errors.length, 1);
  assert.match(panel.errors[0], /kws/);
});

test("with no folder open, add spawns nothing and says why", async () => {
  const panel = openPanel({ workspaceRoot: undefined });
  await listThenAdd(panel);

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

// ---------------------------------------------------------------------------
// The id reaches argv only if the zoo listed it
// ---------------------------------------------------------------------------

test("an id the last zoo listing did not return is refused before argv", async () => {
  const panel = openPanel({ workspaceRoot: WS });
  await listThenAdd(panel, "--sdk-root=/elsewhere");

  assert.equal(addSpawned(panel), false);
  const result = panel.posted.find((m) => m.type === "zooAddResult");
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, "zooAdd.unknown-id");
  assert.equal(panel.errors.length, 1, "the click is never silent");
});

test("an add sent before any zoo listing is refused", async () => {
  const panel = openPanel({ workspaceRoot: WS });
  panel.send({ type: "addFromZoo", id: "kws" });
  await settle();

  assert.equal(addSpawned(panel), false);
  assert.equal(
    panel.posted.find((m) => m.type === "zooAddResult").issues[0].code,
    "zooAdd.unknown-id",
  );
});

// ---------------------------------------------------------------------------
// A dirty board.yaml buffer would overwrite tan's splice on its next save
// ---------------------------------------------------------------------------

test("dismissing the save prompt cancels the add SILENTLY", async () => {
  const doc = boardDoc(true);
  const panel = openPanel({
    workspaceRoot: WS,
    documents: [doc],
    answer: undefined,
  });
  await listThenAdd(panel);

  assert.equal(panel.warnings.length, 1, "the customer is asked");
  assert.equal(addSpawned(panel), false);
  assert.equal(doc.saved, false);
  assert.deepEqual(panel.errors, [], "their own cancel is not an error");
  assert.equal(
    panel.posted.some((m) => m.type === "zooAddResult"),
    false,
  );
});

test("a save that FAILS stops the add and is reported as an error", async () => {
  const doc = boardDoc(true);
  doc.save = async () => false;
  const panel = openPanel({
    workspaceRoot: WS,
    documents: [doc],
    answer: "saveAndContinue",
  });
  await listThenAdd(panel);

  assert.equal(addSpawned(panel), false);
  assert.equal(panel.errors.length, 1);
  const result = panel.posted.find((m) => m.type === "zooAddResult");
  assert.equal(result.issues[0].code, "zooAdd.board-yaml-unsaved");
  assert.match(result.issues[0].message, /could not be saved/);
});

test("choosing Save and Continue saves board.yaml BEFORE tan edits it", async () => {
  const doc = boardDoc(true);
  const panel = openPanel({
    workspaceRoot: WS,
    documents: [doc],
    answer: "saveAndContinue",
  });
  await listThenAdd(panel);

  assert.equal(doc.saved, true);
  assert.equal(addSpawned(panel), true);
});

test("the same file spelled differently is still recognised as board.yaml", async () => {
  const doc = boardDoc(true, path.join(WS, "sub", "..", "board.yaml"));
  const panel = openPanel({ workspaceRoot: WS, documents: [doc] });
  await listThenAdd(panel);

  assert.equal(panel.warnings.length, 1);
  assert.equal(addSpawned(panel), false);
});

test("a clean board.yaml, or a dirty OTHER file, asks nothing", async () => {
  const panel = openPanel({
    workspaceRoot: WS,
    documents: [boardDoc(false), boardDoc(true, path.join(WS, "prj.conf"))],
  });
  await listThenAdd(panel);

  assert.deepEqual(panel.warnings, []);
  assert.equal(addSpawned(panel), true);
});

// ---------------------------------------------------------------------------
// The panel can close under an add; the outcome must still reach the customer
// ---------------------------------------------------------------------------

test("a failed add whose panel was closed mid-flight still raises the error toast", async () => {
  // Arrange -- hold `tan model add` open, close the panel, then let it fail.
  let release;
  const holdAdd = new Promise((resolve) => (release = resolve));
  const panel = openPanel({
    workspaceRoot: WS,
    add: refusedEnvelope,
    holdAdd,
  });
  panel.send({ type: "requestZoo" });
  await settle();
  panel.send({ type: "addFromZoo", id: "kws" });
  await settle();

  // Act
  panel.close();
  release();
  await settle();

  // Assert -- `post` on a disposed webview throws; that must not eat the toast.
  assert.equal(panel.errors.length, 1);
  assert.match(panel.errors[0], /kws/);
});

test("a second add is refused while one is running, even from a reopened panel", async () => {
  // Arrange
  let release;
  const holdAdd = new Promise((resolve) => (release = resolve));
  const panel = openPanel({ workspaceRoot: WS, holdAdd });
  panel.send({ type: "requestZoo" });
  await settle();
  panel.send({ type: "addFromZoo", id: "kws" });
  await settle();

  // Act -- close, reopen (a fresh instance), list, and click add again.
  panel.close();
  panel.reopen();
  panel.send({ type: "requestZoo" });
  await settle();
  panel.send({ type: "addFromZoo", id: "kws" });
  await settle();

  // Assert
  assert.equal(
    panel.spawns.filter((s) => s.args[1] === "add").length,
    1,
    "the second add must not spawn while the first writes board.yaml",
  );
  assert.equal(
    panel.posted.find((m) => m.type === "zooAddResult")?.issues[0].code,
    "zooAdd.in-progress",
  );
  release();
  await settle();

  // Once the first finishes, adding works again.
  panel.send({ type: "addFromZoo", id: "kws" });
  await settle();
  assert.equal(panel.spawns.filter((s) => s.args[1] === "add").length, 2);
});
