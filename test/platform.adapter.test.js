// SPDX-License-Identifier: Apache-2.0
//
// `src/platform.ts` (#718, #719): status bar, warning dedupe, the quick-pick
// flows, and the argv handed to tan. vscode and every tan seam are stubbed
// through the same `Module._load` swap the deps adapter tests use.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const tick = () => new Promise((r) => setImmediate(r));
const root = path.join(__dirname, "..");
const PIN = (over = {}) => ({
  version: "26.11.0",
  line: "26.11",
  components: [
    { name: "alp-sdk", pinned: "0.18.0", installed: "0.18.0", status: "match" },
    { name: "tan-cli", pinned: "0.8.0", installed: "0.8.0", status: "match" },
    {
      name: "alp-sdk-vscode",
      pinned: "0.8.0",
      installed: null,
      status: "unknown",
    },
  ],
  ...over,
});
const OFF = (over) => {
  const pin = PIN(over);
  pin.components[0] = {
    ...pin.components[0],
    installed: "0.17.0",
    status: "mismatch",
  };
  return pin;
};

/** Load out/platform.js fresh, with a scripted host. */
async function load(script = {}) {
  const host = {
    items: [],
    notifies: [],
    terminal: [],
    cli: [],
    logs: [],
    quickPicks: [],
    shown: [],
    refreshes: 0,
    ...script,
  };
  const picks = [...(script.picks ?? [])];
  const vscode = {
    StatusBarAlignment: { Left: 1 },
    QuickPickItemKind: { Separator: -1 },
    ThemeColor: class {
      constructor(id) {
        this.id = id;
      }
    },
    Uri: { file: (f) => ({ fsPath: f }) },
    window: {
      createStatusBarItem() {
        const it = {
          visible: false,
          show() {
            this.visible = true;
          },
          hide() {
            this.visible = false;
          },
          dispose() {},
        };
        host.items.push(it);
        return it;
      },
      async showQuickPick(items, opts) {
        host.quickPicks.push({ items, opts });
        const next = picks.shift();
        return typeof next === "function" ? next(items) : next;
      },
      async showOpenDialog() {
        return host.file ? [{ fsPath: host.file }] : undefined;
      },
      async showTextDocument(uri) {
        host.shown.push(uri.fsPath);
      },
    },
    workspace: {
      workspaceFolders: script.noFolder ? [] : [{}],
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
      onDidSaveTextDocument: () => ({ dispose() {} }),
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
  };
  const stubs = {
    vscode,
    "./alpCli/doctor": {
      runDoctor: async () => {
        host.refreshes += 1;
        return { data: {}, platform: host.doctorPlatform };
      },
    },
    "./alpCli/vscodeAdapter": {
      runAlpInTerminal: async (_c, args, opts) => {
        host.terminal.push({ args, opts });
        setImmediate(() => host.finish?.());
      },
      runAlpCommand: async (_c, args) => {
        host.cli.push(args);
        return { outcome: host.listOutcome };
      },
    },
    "./notify/vscodeAdapter": {
      notify: async (plan) => {
        host.notifies.push(plan);
        const pick = host.notifyPicks?.shift();
        return pick;
      },
    },
    "./notify/service": {
      planCliOutcome: (o) => ({ message: o.message, actions: [] }),
    },
    "./project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: host.workspaceRoot ?? "/ws",
      }),
    },
    "./util": {
      log: (m, level) => host.logs.push({ m, level }),
      isRunActive: () => false,
      awaitRun: () => new Promise((r) => (host.finish = () => r(0))),
    },
  };
  const modPath = require.resolve(path.join(root, "out", "platform.js"));
  delete require.cache[modPath];
  const original = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : original.call(this, request, ...rest);
  };
  let mod;
  try {
    mod = require(modPath);
  } finally {
    Module._load = original;
  }
  const context = { extension: { packageJSON: { version: "0.8.0" } } };
  mod.resetPlatformState();
  mod.registerPlatform(context);
  await tick(); // let the activation-time refresh settle
  return { mod, host, context, item: host.items[0] };
}

test("item: hidden for an older tan, `none` is muted, a pin shows its version", async () => {
  const { mod, host, context, item } = await load();
  mod.applyPlatform(context, undefined);
  assert.equal(item.visible, false);
  mod.applyPlatform(context, null);
  assert.equal(item.text, "Alp Platform: none");
  assert.equal(item.color.id, "disabledForeground");
  assert.equal(item.visible, true);
  mod.applyPlatform(context, PIN());
  assert.equal(item.text, "Alp Platform 26.11.0");
  assert.equal(item.color, undefined);
  mod.applyPlatform(context, undefined);
  assert.equal(item.visible, false, "a failed doctor run clears a stale pin");
  assert.equal(host.notifies.length, 0, "no mismatch, no warning");
});

test("a malformed pin hides the item and logs once per session", async () => {
  const { mod, host, context, item } = await load();
  mod.applyPlatform(context, PIN());
  mod.applyPlatform(context, { version: "26.02.0" });
  mod.applyPlatform(context, "nope");
  assert.equal(item.visible, false);
  assert.equal(host.logs.filter((l) => /malformed/.test(l.m)).length, 1);
});

test("the off-manifest warning shows once per distinct mismatch set", async () => {
  const { mod, host, context } = await load();
  mod.applyPlatform(context, OFF());
  mod.applyPlatform(context, OFF());
  assert.equal(host.notifies.length, 1);
  assert.match(
    host.notifies[0].message,
    /alp-sdk 0\.17\.0 \(pinned 0\.18\.0\)/,
  );
  assert.equal(host.notifies[0].actions[0].title, "Run tan platform use 26.11");
  const other = OFF();
  other.components[1] = {
    ...other.components[1],
    installed: "0.7.0",
    status: "mismatch",
  };
  mod.applyPlatform(context, other);
  assert.equal(host.notifies.length, 2);
});

test("the warning action runs `tan platform use <line>` and then refreshes", async () => {
  const { mod, host, context } = await load({ notifyPicks: ["usePlatform"] });
  host.doctorPlatform = PIN();
  mod.applyPlatform(context, OFF());
  await tick();
  await tick();
  assert.deepEqual(host.terminal[0].args, ["platform", "use", "26.11"]);
  assert.equal(host.terminal[0].opts.cwd, "/ws");
  await tick();
  assert.equal(host.refreshes >= 1, true);
});

test("usePlatform refuses a string outside the grammar", async () => {
  const { mod, host, context } = await load();
  await mod.usePlatform(context, "--manifest");
  await mod.usePlatform(context, "26.02");
  assert.equal(host.terminal.length, 0);
});

test("menu: unsupported tan explains instead of opening a pick", async () => {
  const { mod, host, context } = await load();
  await mod.platformRelease(context);
  assert.equal(host.quickPicks.length, 0);
  assert.match(host.notifies[0].message, /does not support/);
});

test("menu: re-apply runs `tan platform use <pinned version>`", async () => {
  const { mod, host, context } = await load({
    picks: [(items) => items.find((i) => i.action === "reapply")],
  });
  mod.applyPlatform(context, PIN());
  await mod.platformRelease(context);
  assert.deepEqual(host.terminal[0].args, ["platform", "use", "26.11.0"]);
});

test("menu: clear confirms first, and a declined confirm runs nothing", async () => {
  const pickClear = (items) => items.find((i) => i.action === "clear");
  const a = await load({ picks: [pickClear], notifyPicks: [undefined] });
  a.mod.applyPlatform(a.context, PIN());
  await a.mod.platformRelease(a.context);
  assert.equal(a.host.notifies[0].channel, "modal");
  assert.equal(a.host.terminal.length, 0);

  const b = await load({ picks: [pickClear], notifyPicks: ["applyChanges"] });
  b.mod.applyPlatform(b.context, PIN());
  const done = b.mod.platformRelease(b.context);
  await done;
  assert.deepEqual(b.host.terminal[0].args, ["platform", "clear"]);
});

test("menu: open manifest opens the pin file found above the workspace", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const top = fs.mkdtempSync(path.join(os.tmpdir(), "alp-plat-"));
  fs.mkdirSync(path.join(top, ".alp"));
  fs.writeFileSync(path.join(top, ".alp", "platform.yaml"), "schema: x\n");
  fs.mkdirSync(path.join(top, "proj"));
  const { mod, host, context } = await load({
    workspaceRoot: path.join(top, "proj"),
    picks: [(items) => items.find((i) => i.action === "open")],
  });
  mod.applyPlatform(context, PIN());
  await mod.platformRelease(context);
  assert.deepEqual(host.shown, [path.join(top, ".alp", "platform.yaml")]);
  fs.rmSync(top, { recursive: true, force: true });
});

const LIST = {
  ok: true,
  envelope: {
    data: {
      releases: [
        {
          version: "26.11.0",
          line: "26.11",
          prerelease: false,
          published: "a",
        },
        {
          version: "26.11.1",
          line: "26.11",
          prerelease: false,
          published: "b",
        },
        {
          version: "27.1.0-rc1",
          line: "27.1",
          prerelease: true,
          published: "c",
        },
      ],
      pinned: null,
    },
    issues: [],
  },
};

test("switch: lists newest per line, offers the rest, runs `use <version>`", async () => {
  const { mod, host, context } = await load({
    listOutcome: LIST,
    picks: [
      (items) => items.find((i) => i.more),
      (items) => items.find((i) => i.label === "27.1.0-rc1"),
    ],
  });
  const done = mod.switchRelease(context);
  await done;
  assert.deepEqual(host.cli[0], ["platform", "list"]);
  assert.deepEqual(host.quickPicks[0].items.map((i) => i.label).slice(0, 1), [
    "26.11.1",
  ]);
  assert.equal(
    host.quickPicks[0].items.some((i) => i.label === "27.1.0-rc1"),
    false,
    "release candidates hidden by default",
  );
  assert.deepEqual(host.terminal[0].args, ["platform", "use", "27.1.0-rc1"]);
});

test("switch: a token/403 failure offers a local manifest file", async () => {
  const { mod, host, context } = await load({
    listOutcome: {
      ok: false,
      message: "boom",
      envelope: {
        issues: [{ code: "platform.list-failed", message: "HTTP 403" }],
      },
    },
    notifyPicks: ["useManifestFile"],
    file: "/tmp/m.yaml",
  });
  const done = mod.switchRelease(context);
  await done;
  assert.match(host.notifies[0].message, /GITHUB_TOKEN/);
  assert.deepEqual(host.terminal[0].args, [
    "platform",
    "use",
    "--manifest",
    "/tmp/m.yaml",
  ]);
});
