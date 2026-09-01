// The VS Code half of #493. The pure comparison is covered by
// test/schemaProvenance.test.js; everything asserted here lives ONLY in the
// adapter and would otherwise ship untested: the fire-once contract, what
// counts as a NEW mismatch worth saying again, the severity mapping, and the
// invariant that a customer with no SDK is never nagged.
const test = require("node:test");
const realSdkService = require("../packages/alp-core/dist/sdk/service.js");
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

/**
 * Resolve a stubbed read by NORMALISED tail, never by slicing off the root's
 * length. The adapter builds these paths with `path.join`, so on Windows the
 * separator is `\` while these keys (and the relative paths the production code
 * declares) use `/`. Slicing produced `metadata\schemas\board.schema.json`,
 * matched no key, and turned four mismatch cases into `unreadable` — green on
 * macOS and Linux, red only on Windows. Exported-by-hoisting so the Windows
 * shape can be asserted from a machine that is not Windows.
 */
function resolveStubbedRead(sdkFiles, p) {
  const normalised = String(p).replace(/\\/g, "/");
  const hit = Object.entries(sdkFiles ?? {}).find(([rel]) =>
    normalised.endsWith(rel),
  );
  return hit ? hit[1] : null;
}

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
        const hit = resolveStubbedRead(opts.sdkFiles, p);
        if (hit !== null) return hit;
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
      // Delegated to the REAL implementation, not re-stubbed. It is pure (a
      // string in, a string out, no IO), so a hand-written stub here would
      // only give the test a second opinion to agree with — and the whole
      // point of it is deciding an rc install's identity from its path.
      sdkIdentityVersion: realSdkService.sdkIdentityVersion,
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

test("the read stub resolves a Windows-shaped path (the CI-only failure)", () => {
  // Arrange -- what `path.join` actually produces on win32. This assertion is
  // the whole reason the matcher is a named function: it fails on a Windows
  // runner otherwise, and nowhere else.
  const files = { "metadata/schemas/board.schema.json": "BODY" };

  // Act / Assert
  assert.equal(
    resolveStubbedRead(
      files,
      "D:\\a\\alp-sdk-vscode\\sdk\\metadata\\schemas\\board.schema.json",
    ),
    "BODY",
    "a backslash path must resolve, or every mismatch case reads as unreadable",
  );
  assert.equal(
    resolveStubbedRead(
      files,
      "/opt/alp-sdk/metadata/schemas/board.schema.json",
    ),
    "BODY",
  );
  assert.equal(
    resolveStubbedRead(files, "/opt/alp-sdk/metadata/schemas/other.json"),
    null,
    "an absent file must still read as absent",
  );
});

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
  assert.match(h.item.text, /alp-sdk v0\.15\.0/);
});

test("a plain mismatch is silent and Information — the SDK is being served", async () => {
  // Arrange -- a customer on another tag whose schema we CAN serve. Before
  // #493 this was the defect and got a Warning plus a toast; now it is the
  // feature working, and nagging about it would train people to ignore the
  // item that still matters.
  const h = harness({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.14.0",
    sdkFiles: { ...VENDORED, "metadata/schemas/board.schema.json": "{}" },
  });
  await settle();

  // Assert
  assert.deepEqual(h.notices, []);
  assert.equal(h.item.severity, 0);
  assert.match(h.item.text, /alp-sdk v0\.14\.0/);
});

test("a rejected SDK schema notifies once no matter how often state refreshes", async () => {
  // Arrange -- window focus alone fires onStateChange; a toast per focus would
  // be unusable. `nope` is not JSON, so the editor falls back to the bundled
  // copy and the customer is being asserted at again.
  const h = harness({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.14.0",
    sdkFiles: { ...VENDORED, "metadata/schemas/board.schema.json": "nope" },
  });
  await settle();

  // Act
  h.fire();
  h.fire();
  h.fire();
  await settle();

  // Assert
  assert.equal(h.notices.length, 1);
  assert.equal(
    h.item.severity,
    1,
    "a fallback the customer can fix is a Warning",
  );
  assert.match(h.item.text, /SDK schema rejected/);
});

test("switching to a different SDK is a NEW notice and is said again", async () => {
  // Arrange
  const first = harness({
    sdkRoot: "/opt/alp-sdk-a",
    sdkVersion: "0.14.0",
    sdkFiles: { ...VENDORED, "metadata/schemas/board.schema.json": "nope" },
  });
  await settle();
  assert.equal(first.notices.length, 1);

  // Act -- a second resolution, different root, same shape of problem.
  const second = harness({
    sdkRoot: "/opt/alp-sdk-b",
    sdkVersion: "0.13.0",
    sdkFiles: { ...VENDORED, "metadata/schemas/board.schema.json": "nope" },
  });
  await settle();

  // Assert -- the signature is keyed on the root, so this is not "already told".
  assert.equal(second.notices.length, 1);
});

test("a served SDK schema the configurator would truncate warns about the loss", async () => {
  // Arrange -- validation is CORRECT here (the SDK's schema is served), but
  // BOARD_KEY_ORDER does not model `telemetryBudget`, so saving through the
  // visual configurator would delete it. Silent data loss outranks a tidy
  // status bar, which is the only reason a `mismatch` ever warns.
  const h = harness({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.16.0",
    sdkFiles: {
      ...VENDORED,
      "metadata/schemas/board.schema.json": JSON.stringify({
        properties: { som: {}, telemetryBudget: {} },
      }),
    },
  });
  await settle();

  // Assert
  assert.equal(h.item.severity, 1);
  assert.equal(h.notices.length, 1);
  assert.match(h.item.detail, /telemetryBudget/);
  assert.match(h.item.detail, /DROPS those keys/);
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

test("the notice carries no raw path in its toast text", async () => {
  // Arrange / Act
  const h = harness({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.14.0",
    sdkFiles: { ...VENDORED, "metadata/schemas/board.schema.json": "nope" },
  });
  await settle();

  // Assert -- the seam's rule: interpolated detail belongs in the channel.
  const plan = h.notices[0];
  assert.ok(plan, "a rejected SDK schema must notify");
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
    sdkFiles: { ...VENDORED, "metadata/schemas/board.schema.json": "nope" },
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

test("an rc install is named by its tag in the status text, not by its metadata", async () => {
  // The reported disagreement, at this surface. `sdkLabel` renders
  // `alp-sdk v${sdkVersion}` into the language-status item and the one-time
  // notice, and an RC's `metadata/sdk_version.yaml` names the release it is a
  // CANDIDATE for -- `~/.alp/sdk/v0.16.0-rc1` declares `0.16.0`
  // (alp-sdk#1902). Saying "alp-sdk v0.16.0" here names a tree the customer
  // does not have, in the one sentence whose job is telling them WHICH schemas
  // the editor followed.
  const h = harness({
    sdkRoot: "/home/dev/.alp/sdk/v0.16.0-rc1",
    sdkVersion: "0.16.0",
    sdkFiles: VENDORED,
  });
  await settle();

  assert.match(
    h.item.text,
    /alp-sdk v0\.16\.0-rc1/,
    "the status text must name the install, not the release it is a " +
      "candidate for",
  );
  assert.doesNotMatch(
    h.item.text,
    /alp-sdk v0\.16\.0(?!-rc1)/,
    "and must not ALSO read as the GA — the two declare the same string, " +
      "which is exactly why the declaration cannot be the answer",
  );
});
