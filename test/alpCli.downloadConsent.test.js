// SPDX-License-Identifier: Apache-2.0
//
// #414: a FRESH `tan` CLI install (nothing resolves anywhere) must ask for
// consent before `ensureTanCliProvisioned` ever reaches `downloadCli` — ADR
// 0021's Tier A rule ("install after one consent click"). The other two
// reasons `ensureTanCliProvisioned` fetches — `updatingStaleCache` (a
// self-heal of an ALREADY-accepted install) and `reacquiringUnverifiedCache`
// (#396's security heal: moving a customer OFF an unverified cached binary
// and ONTO a digest-verified one) — must NEVER be gated: honouring a stored
// decline there would strand the customer on a stale/unverified binary, the
// opposite of what consent is for.
//
// Driven through the REAL `ensureTanCliProvisioned` / `installTanCliGlobally`
// in out/alpCli/vscodeAdapter.js — the same `Module._load` swap
// alpCli.cachedVerification.test.js and alpCli.pathFallbackNotice.test.js use
// — against a real file on disk and a real Map-backed `globalState`. NO
// NETWORK beyond 127.0.0.1: every download is served locally.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const CORE_PATH = require.resolve(
  path.join(root, "out", "alpCli", "adapterCore.js"),
);
const ADAPTER = require.resolve(
  path.join(root, "out", "alpCli", "vscodeAdapter.js"),
);
const SERVICE = require(path.join(root, "out", "alpCli", "service.js"));

const BINARY = process.platform === "win32" ? "tan.exe" : "tan";
const GOOD = "the real tan binary\n";
const UPDATED = "the freshly-pinned tan binary\n";
const TAMPERED = "not what Alp Lab published\n";
const sha256 = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

/** globalState key the consent prompt persists its answer under. */
const DOWNLOAD_CONSENT_KEY = "alp.tanCliDownloadConsentAnswer";

const [MAJOR, MINOR] = SERVICE.SUPPORTED_CLI_VERSION.split(".").map(Number);
/** One MINOR behind the pin — same derivation alpCli.preferGlobalCliStaleLoop
 *  .test.js uses, so a pin bump keeps testing the same relationship. */
const BEHIND = `${MAJOR}.${Math.max(MINOR - 1, 0)}.0`;

/** A release server whose `checksums.txt` vouches for what it serves. */
async function releaseServer(body) {
  const server = http.createServer((req, res) => {
    if (req.url === "/checksums.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`${sha256(body)}  ${BINARY}\n`);
      return;
    }
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    asset: {
      target: "test-target",
      assetName: BINARY,
      tag: "v0.0.0-test",
      url: `${base}/${BINARY}`,
      checksumsUrl: `${base}/checksums.txt`,
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** A real-on-disk extension home: temp globalStorage + extensionPath, and a
 *  `globalState` backed by a Map so a stored consent answer is written and
 *  read back the way VS Code would. */
function extensionHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-consent-"));
  const store = new Map();
  return {
    dir,
    store,
    cachedBinaryPath: path.join(dir, "cli", BINARY),
    writeCachedBinary(body) {
      fs.mkdirSync(path.join(dir, "cli"), { recursive: true });
      fs.writeFileSync(this.cachedBinaryPath, body);
      return this.cachedBinaryPath;
    },
    context: {
      extensionPath: path.join(dir, "ext"),
      globalStorageUri: { fsPath: dir },
      subscriptions: [],
      globalState: {
        get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
        update: async (key, value) => {
          if (value === undefined) store.delete(key);
          else store.set(key, value);
        },
      },
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Load a FRESH copy of the real adapter (fresh module state — the per-window
 * resolution memo and the hash memo — so rows do not leak into each other),
 * keeping the REAL `adapterCore`, `service`, `download` and `fs`. Only the
 * host seams are stubbed. `onNotify(plan)` answers every `notify()` call
 * (the consent dialog is the only one reachable in these rows) and its
 * return value is what `notify()` resolves to — the id of the picked action,
 * or `undefined` for "no button pressed".
 */
function loadAdapter({
  onPath = false,
  releaseAsset,
  config = {},
  version = SERVICE.SUPPORTED_CLI_VERSION,
  onNotify = () => undefined,
} = {}) {
  const plans = [];
  const nativeVersion = `tan ${version}\n`;

  const stubs = {
    vscode: {
      Uri: { file: (p) => ({ fsPath: p }) },
      workspace: {
        getConfiguration: (section) => ({
          get: (key, fallback) =>
            Object.hasOwn(config, `${section}.${key}`)
              ? config[`${section}.${key}`]
              : fallback,
        }),
      },
      window: {
        withProgress: async (_options, task) =>
          task(
            { report() {} },
            { onCancellationRequested: () => ({ dispose() {} }) },
          ),
      },
      ProgressLocation: { Notification: 15, Window: 10 },
    },
    child_process: {
      spawn: () => ({
        stdout: { setEncoding() {}, on() {} },
        stderr: { setEncoding() {}, on() {} },
        kill() {},
        on(event, handler) {
          if (event === "close") setImmediate(() => handler(0));
        },
      }),
      // `commandOnPath` goes through this.
      spawnSync: () =>
        onPath
          ? { status: 0, stdout: nativeVersion, stderr: "" }
          : { status: 1, stdout: "", stderr: "" },
      // The cached-binary version probe (`readResolvedCliVersion`) goes
      // through this — same answer regardless of which binary path is
      // passed, which is all these rows need (only one binary is ever
      // "the resolved one" per row).
      execFile: (command, args, _options, callback) => {
        callback(null, { stdout: nativeVersion, stderr: "" });
      },
    },
    "../notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return onNotify(plan);
      },
      notifyAsync: (plan) => {
        plans.push(plan);
      },
    },
    "../project/vscodeAdapter": { collectProjectContext: () => ({}) },
    "../util": { log() {}, runInTerminal() {} },
    ...(releaseAsset
      ? {
          "./service": {
            ...SERVICE,
            releaseAssetForTarget: () => releaseAsset,
          },
        }
      : {}),
  };

  const originalLoad = Module._load;
  delete require.cache[ADAPTER];
  delete require.cache[CORE_PATH];
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let adapter;
  try {
    adapter = require(ADAPTER);
  } finally {
    Module._load = originalLoad;
    delete require.cache[ADAPTER];
    delete require.cache[CORE_PATH];
  }
  return { adapter, plans };
}

/** The one plan shape these rows care about: the consent dialog. Filtered by
 *  its caller-handled action id rather than by message text, so a wording
 *  edit does not silently stop this file from watching the right plan. */
const isConsentPlan = (plan) =>
  plan.actions?.some((a) => a.id === "downloadTanCli");

// ── fresh install: no stored answer ─────────────────────────────────────────

test("fresh install, no stored answer: prompts, and does NOT download until accepted", async () => {
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      onNotify: () => undefined, // no button pressed
    });
    await adapter.ensureTanCliProvisioned(home.context);

    const shown = plans.filter(isConsentPlan);
    assert.equal(shown.length, 1, "the consent dialog was not raised");
    const [plan] = shown;
    assert.match(plan.message, /download the tan CLI/i);
    assert.match(plan.message, new RegExp(SERVICE.SUPPORTED_CLI_VERSION));
    // ADR 0021 Tier A: artifact, source, size, licence — all four present.
    assert.match(plan.modalDetail, /Artifact:.*tan/i);
    assert.ok(
      plan.modalDetail.includes(server.asset.url),
      "the dialog must name the ACTUAL asset url downloadCli is about to fetch",
    );
    assert.match(plan.modalDetail, /Size:/);
    assert.match(plan.modalDetail, /Licence:.*Apache/i);

    assert.equal(
      fs.existsSync(home.cachedBinaryPath),
      false,
      "a declined/unanswered prompt must not download anything",
    );
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("fresh install, no stored answer: accepting proceeds with the download", async () => {
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    const { adapter } = loadAdapter({
      releaseAsset: server.asset,
      onNotify: (plan) => (isConsentPlan(plan) ? "downloadTanCli" : undefined),
    });
    await adapter.ensureTanCliProvisioned(home.context);

    assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
    assert.equal(home.store.get("alp.tanCachedBinarySha256"), sha256(GOOD));
    assert.equal(
      home.store.get(DOWNLOAD_CONSENT_KEY),
      "accepted",
      "an accepted fresh install must persist the answer",
    );
  } finally {
    await server.close();
    home.cleanup();
  }
});

// ── stored decline ──────────────────────────────────────────────────────────

test("stored decline: no prompt, no download", async () => {
  const home = extensionHome();
  home.store.set(DOWNLOAD_CONSENT_KEY, "declined");
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      onNotify: () => {
        throw new Error("a stored decline must never re-prompt");
      },
    });
    await adapter.ensureTanCliProvisioned(home.context);

    assert.deepEqual(plans.filter(isConsentPlan), []);
    assert.equal(fs.existsSync(home.cachedBinaryPath), false);
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("stored decline + explicit alp.installTanCli: proceeds anyway", () => {
  const home = extensionHome();
  home.store.set(DOWNLOAD_CONSENT_KEY, "declined");
  const terminals = [];
  delete require.cache[ADAPTER];
  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: () => ({ get: (_k, fallback) => fallback }),
      },
    },
    "../notify/vscodeAdapter": {
      notify: async () => {
        throw new Error("installTanCliGlobally must never consult consent");
      },
      notifyAsync: () => {
        throw new Error("installTanCliGlobally must never consult consent");
      },
    },
    "../util": {
      log() {},
      runInTerminal: (options) => terminals.push(options),
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let adapter;
  try {
    adapter = require(ADAPTER);
  } finally {
    Module._load = originalLoad;
    delete require.cache[ADAPTER];
  }
  try {
    // `extensionPath: root` — the one field the handler reads — so the
    // "bundled script exists" guard sees the real vendored install.sh/.ps1
    // rather than a fixture that could drift from them (same choice
    // alpCli.installTanCli.test.js makes for the same handler).
    adapter.installTanCliGlobally({
      extensionPath: root,
      subscriptions: [],
      globalState: home.context.globalState,
    });
    assert.equal(
      terminals.length,
      1,
      "an explicit Install tan CLI must still run the installer, decline or not",
    );
  } finally {
    home.cleanup();
  }
});

// ── the two ungated arms ────────────────────────────────────────────────────

test("updatingStaleCache (behind-pin self-heal): no prompt, downloads", async () => {
  const home = extensionHome();
  const file = home.writeCachedBinary(GOOD);
  home.store.set("alp.tanCachedBinarySha256", sha256(GOOD)); // digest-clean
  home.store.set(DOWNLOAD_CONSENT_KEY, "declined"); // must not matter
  const server = await releaseServer(UPDATED);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      version: BEHIND, // the cached binary reports a version behind the pin
      onNotify: () => {
        throw new Error("the stale-cache self-heal must never prompt");
      },
    });
    await adapter.ensureTanCliProvisioned(home.context);

    assert.deepEqual(plans.filter(isConsentPlan), []);
    assert.equal(fs.readFileSync(file, "utf8"), UPDATED);
    assert.equal(home.store.get("alp.tanCachedBinarySha256"), sha256(UPDATED));
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("reacquiringUnverifiedCache (#396 security heal): no prompt, downloads", async () => {
  const home = extensionHome();
  const file = home.writeCachedBinary(TAMPERED); // present, no digest recorded
  home.store.set(DOWNLOAD_CONSENT_KEY, "declined"); // must not matter
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      onNotify: () => {
        throw new Error(
          "the un-digested-cache security heal must never prompt",
        );
      },
    });
    await adapter.ensureTanCliProvisioned(home.context);

    assert.deepEqual(plans.filter(isConsentPlan), []);
    assert.equal(fs.readFileSync(file, "utf8"), GOOD);
    assert.equal(home.store.get("alp.tanCachedBinarySha256"), sha256(GOOD));
  } finally {
    await server.close();
    home.cleanup();
  }
});

// ── the setting pre-answers it ──────────────────────────────────────────────

test("alpSdk.tanCliDownloadConsent: deny pre-answers a fresh install — no prompt, no download", async () => {
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      config: { "alpSdk.tanCliDownloadConsent": "deny" },
      onNotify: () => {
        throw new Error("a pre-answered deny must never prompt");
      },
    });
    await adapter.ensureTanCliProvisioned(home.context);

    assert.deepEqual(plans.filter(isConsentPlan), []);
    assert.equal(fs.existsSync(home.cachedBinaryPath), false);
    assert.equal(
      home.store.has(DOWNLOAD_CONSENT_KEY),
      false,
      "a setting-level answer is not the same fact as a dialog pick and must not be recorded as one",
    );
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("alpSdk.tanCliDownloadConsent: allow pre-answers a fresh install — no prompt, downloads", async () => {
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      config: { "alpSdk.tanCliDownloadConsent": "allow" },
      onNotify: () => {
        throw new Error("a pre-answered allow must never prompt");
      },
    });
    await adapter.ensureTanCliProvisioned(home.context);

    assert.deepEqual(plans.filter(isConsentPlan), []);
    assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("alpSdk.tanCliDownloadConsent: allow overrides a PRIOR stored decline", async () => {
  const home = extensionHome();
  home.store.set(DOWNLOAD_CONSENT_KEY, "declined");
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      config: { "alpSdk.tanCliDownloadConsent": "allow" },
      onNotify: () => {
        throw new Error("the setting must win over a stale stored decline");
      },
    });
    await adapter.ensureTanCliProvisioned(home.context);

    assert.deepEqual(plans.filter(isConsentPlan), []);
    assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
  } finally {
    await server.close();
    home.cleanup();
  }
});
