// The VS Code half of #493. The pure comparison is covered by
// test/schemaProvenance.test.js; everything asserted here lives ONLY in the
// adapter and would otherwise ship untested: the fire-once contract, what
// counts as a NEW mismatch worth saying again, the severity mapping, and the
// invariant that a customer with no SDK is never nagged.
const test = require("node:test");
const assert = require("node:assert/strict");
const realFs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

/** Load `out/<rel>.js` with `stubs` standing in for the requires named. Swaps
 *  Node's loader only for the duration of the synchronous require, so it never
 *  leaks into another test file sharing the process. */
function load(rel, stubs) {
  const modPath = require.resolve(path.join(root, "out", `${rel}.js`));
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

const VENDORED = {
  "metadata/schemas/board.schema.json": realFs.readFileSync(
    path.join(root, "schemas", "board.schema.json"),
    "utf-8",
  ),
  "metadata/schemas/system-manifest-v1.schema.json": realFs.readFileSync(
    path.join(root, "schemas", "system-manifest-v1.schema.json"),
    "utf-8",
  ),
};

/** A fake language-status item that records what was painted onto it. */
function statusItemRecorder() {
  const item = {
    id: null,
    selector: null,
    name: null,
    text: null,
    detail: null,
    severity: null,
    command: null,
    disposed: false,
    dispose() {
      item.disposed = true;
    },
  };
  return item;
}

/**
 * @param opts.sdkRoot     what `collectProjectContext` reports
 * @param opts.sdkFiles    map of `<sdkRelativePath>` → contents; absent = ENOENT
 * @param opts.sdkVersion  what `checkSdkReadiness` reports
 */
function harness(opts) {
  const item = statusItemRecorder();
  const notices = [];
  const logs = [];
  const store = new Map();
  const listeners = [];

  const mod = load("schemaProvenance", {
    vscode: {
      languages: {
        createLanguageStatusItem: (id, selector) => {
          item.id = id;
          item.selector = selector;
          return item;
        },
      },
      LanguageStatusSeverity: { Information: 0, Warning: 1, Error: 2 },
      Disposable: class {
        constructor(fn) {
          this.dispose = fn;
        }
      },
    },
    fs: {
      existsSync: () => true,
      readFileSync: (p) => {
        const rel = String(p).slice(String(opts.sdkRoot ?? "").length + 1);
        const hit = opts.sdkFiles?.[rel];
        if (typeof hit === "string") return hit;
        throw new Error(`ENOENT: no such file or directory, open '${p}'`);
      },
    },
    "@alp-sdk/core/sdk/service": {
      checkSdkReadiness: () => ({
        sdkPath: opts.sdkRoot,
        version: opts.sdkVersion ?? null,
        state: "ready",
        issues: [],
      }),
    },
    "./project/vscodeAdapter": {
      collectProjectContext: () => ({ sdkRoot: opts.sdkRoot ?? null }),
    },
    "./notify/vscodeAdapter": {
      notifyAsync: (plan) => notices.push(plan),
    },
    "./util": {
      log: (message, level) => logs.push({ message, level }),
    },
  });

  const stateMgr = {
    onStateChange: (fn) => {
      listeners.push(fn);
      return { dispose: () => listeners.splice(listeners.indexOf(fn), 1) };
    },
  };
  const context = {
    globalState: {
      get: (k) => store.get(k),
      update: async (k, v) => void store.set(k, v),
    },
  };

  const disposable = mod.createSchemaProvenanceStatus(context, stateMgr);
  return {
    item,
    notices,
    logs,
    listeners,
    disposable,
    fire: () => listeners.forEach((fn) => fn()),
  };
}

/** `await` one macrotask turn so the fire-and-forget notice has run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("no SDK resolved: paints the bundled tag and never notifies", async () => {
  // Arrange / Act
  const h = harness({ sdkRoot: null });
  await settle();

  // Assert -- the common first-run state must not nag.
  assert.deepEqual(h.notices, []);
  assert.equal(h.item.severity, 0);
  assert.match(h.item.text, /bundled v/);
  assert.equal(h.item.id, "alp.schemaProvenance");
});

test("an SDK shipping identical schemas notifies nothing", async () => {
  // Arrange / Act
  const h = harness({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.15.0",
    sdkFiles: VENDORED,
  });
  await settle();

  // Assert
  assert.deepEqual(h.notices, []);
  assert.equal(h.item.severity, 0);
  assert.match(h.item.text, /matches SDK/);
});

test("a mismatch notifies exactly once no matter how often state refreshes", async () => {
  // Arrange -- window focus alone fires onStateChange; a toast per focus would
  // be unusable.
  const h = harness({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.14.0",
    sdkFiles: { ...VENDORED, "metadata/schemas/board.schema.json": "{}" },
  });
  await settle();

  // Act
  h.fire();
  h.fire();
  h.fire();
  await settle();

  // Assert
  assert.equal(h.notices.length, 1);
  assert.equal(h.item.severity, 1, "a mismatch is a Warning");
  assert.match(h.item.text, /differs from SDK/);
});

test("switching to a different SDK is a NEW mismatch and is said again", async () => {
  // Arrange
  const first = harness({
    sdkRoot: "/opt/alp-sdk-a",
    sdkVersion: "0.14.0",
    sdkFiles: { ...VENDORED, "metadata/schemas/board.schema.json": "{}" },
  });
  await settle();
  assert.equal(first.notices.length, 1);

  // Act -- a second resolution, different root, same shape of disagreement.
  const second = harness({
    sdkRoot: "/opt/alp-sdk-b",
    sdkVersion: "0.13.0",
    sdkFiles: { ...VENDORED, "metadata/schemas/board.schema.json": "{}" },
  });
  await settle();

  // Assert -- the signature is keyed on the root, so this is not "already told".
  assert.equal(second.notices.length, 1);
});

test("an unreadable SDK schema is Information, not a Warning", async () => {
  // Arrange -- an incomplete install is not the same defect as a disagreement,
  // and must not cry wolf at Warning severity. Nothing else pins this.
  const h = harness({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.15.0",
    sdkFiles: {
      "metadata/schemas/board.schema.json":
        VENDORED["metadata/schemas/board.schema.json"],
    },
  });
  await settle();

  // Assert
  assert.equal(h.item.severity, 0);
  assert.match(h.item.text, /unreadable/);
  assert.deepEqual(h.notices, [], "only a real disagreement gets a toast");
  assert.match(h.item.detail, /system-manifest-v1\.schema\.json/);
  assert.ok(
    !h.item.detail.includes("\n"),
    "detail is rendered in a hover, which does not honour newlines",
  );
});

test("the mismatch notice carries no raw path in its toast text", async () => {
  // Arrange / Act
  const h = harness({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.14.0",
    sdkFiles: { ...VENDORED, "metadata/schemas/board.schema.json": "{}" },
  });
  await settle();

  // Assert -- the seam's rule: interpolated detail belongs in the channel.
  const plan = h.notices[0];
  assert.ok(plan, "a mismatch must notify");
  assert.ok(
    !String(plan.message).includes("/opt/alp-sdk"),
    "the toast must not leak the SDK path",
  );
});

test("a Warning item is clickable and the detail reaches the log once", async () => {
  // Arrange / Act
  const h = harness({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.14.0",
    sdkFiles: { ...VENDORED, "metadata/schemas/board.schema.json": "{}" },
  });
  h.fire();
  h.fire();
  await settle();

  // Assert
  assert.equal(h.item.command.command, "alp.showOutput");
  const warned = h.logs.filter((l) => l.level === "warn");
  assert.equal(warned.length, 1, "an unchanged answer must not re-log");
});

test("disposing releases both the item and the state subscription", () => {
  // Arrange
  const h = harness({ sdkRoot: null });
  assert.equal(h.listeners.length, 1);

  // Act
  h.disposable.dispose();

  // Assert
  assert.equal(h.listeners.length, 0);
  assert.equal(h.item.disposed, true);
});
