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
  // Instrumentation only — counts `commandOnPath`'s PATH probe (#438: an
  // interactive escalation must not rerun the whole resolution ladder for a
  // `deny`/stored-declined answer that cannot change).
  onSpawnSync = () => {},
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
      spawnSync: () => {
        onSpawnSync();
        return onPath
          ? { status: 0, stdout: nativeVersion, stderr: "" }
          : { status: 1, stdout: "", stderr: "" };
      },
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

test("reacquiringUnverifiedCache (#396 security heal), onPath TRUE: no prompt, downloads", async () => {
  // The genuine heal: a customer is CURRENTLY RUNNING the un-digested cache
  // via the PATH fallback (`onPath: true` — `decideBinarySource` can only
  // reach `path` after stepping over the un-digested cache), so migrating
  // them onto a digest-verified copy strands nobody — they already have a
  // binary in use. This is the only state the exclusion may cover.
  const home = extensionHome();
  const file = home.writeCachedBinary(TAMPERED); // present, no digest recorded
  home.store.set(DOWNLOAD_CONSENT_KEY, "declined"); // must not matter
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      onPath: true,
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

test("un-digested cache, onPath FALSE (nothing running): a stored decline IS honoured, no download", async () => {
  // A review found this after #434 merged: `onPath: false` (the default) means
  // NOTHING resolves anywhere — `decideBinarySource` skips the un-digested
  // cache and, with no PATH fallback either, falls through to `download`. That
  // is a plain fresh install wearing a leftover cache file, not the #396 heal,
  // and there is nobody to strand by honouring `deny`. Before the fix this row
  // downloaded anyway, silently ignoring the stored decline.
  const home = extensionHome();
  const file = home.writeCachedBinary(TAMPERED); // present, no digest recorded
  home.store.set(DOWNLOAD_CONSENT_KEY, "declined");
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      onPath: false,
      releaseAsset: server.asset,
      onNotify: () => {
        throw new Error("a stored decline must never re-prompt");
      },
    });
    await adapter.ensureTanCliProvisioned(home.context);

    assert.deepEqual(plans.filter(isConsentPlan), []);
    assert.equal(
      fs.readFileSync(file, "utf8"),
      TAMPERED,
      "a denied consent must leave the un-digested cache file untouched",
    );
    assert.equal(home.store.has("alp.tanCachedBinarySha256"), false);
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("un-digested cache, onPath FALSE (nothing running): no stored answer prompts, like any fresh install", async () => {
  const home = extensionHome();
  home.writeCachedBinary(TAMPERED); // present, no digest recorded
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      onPath: false,
      releaseAsset: server.asset,
      onNotify: () => undefined, // no button pressed
    });
    await adapter.ensureTanCliProvisioned(home.context);

    const shown = plans.filter(isConsentPlan);
    assert.equal(
      shown.length,
      1,
      "an un-digested cache with nothing on PATH must ask like any fresh install",
    );
    assert.equal(
      fs.existsSync(home.cachedBinaryPath),
      true,
      "the tampered file is still there",
    );
    assert.equal(
      fs.readFileSync(home.cachedBinaryPath, "utf8"),
      TAMPERED,
      "an unanswered prompt must not have re-downloaded",
    );
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

// ── `runAlpCommand`'s `interactive` default (finding 3) ─────────────────────

test("runAlpCommand: WITHOUT interactive, a fresh install never raises the consent dialog", async () => {
  // The bug: every caller of `runAlpCommand` used to be treated as "the user
  // just asked for this", so a background caller (the language server's
  // catalog refresh, a Dependencies-panel status probe) could pop ADR 0021's
  // blocking modal out of a window-focus event or a `prj.conf` open.
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      onNotify: () => {
        throw new Error("a non-interactive runAlpCommand must never prompt");
      },
    });
    const { outcome } = await adapter.runAlpCommand(home.context, ["presets"]);

    assert.deepEqual(plans.filter(isConsentPlan), []);
    assert.equal(outcome.unavailable?.reason, "consentDeclined");
    assert.equal(fs.existsSync(home.cachedBinaryPath), false);
    // A reader that shows `outcome.message` DIRECTLY (never through
    // `planCliOutcome`'s composed wording — e.g. the Dependencies panel's
    // inline error text) must still be told which setting to change, and must
    // not see it dressed up as a broken CLI.
    assert.match(outcome.message, /alpSdk\.tanCliDownloadConsent/);
    assert.equal(outcome.severity, "warning");
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("runAlpCommand: interactive: true DOES raise the consent dialog for a fresh install", async () => {
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      onNotify: (plan) => (isConsentPlan(plan) ? "downloadTanCli" : undefined),
    });
    await adapter.runAlpCommand(home.context, ["presets"], undefined, {
      interactive: true,
    });

    assert.equal(plans.filter(isConsentPlan).length, 1);
    assert.equal(fs.existsSync(home.cachedBinaryPath), true);
  } finally {
    await server.close();
    home.cleanup();
  }
});

// ── in-flight dedupe (finding 4) ─────────────────────────────────────────────

test("resolveAlpBinaryForContext: concurrent interactive resolutions share ONE in-flight resolution", async () => {
  // Proven directly: 3 concurrent interactive resolutions against an
  // unanswered "ask" must raise exactly ONE consent modal, not one per caller
  // — the shape of the bug `pushSdkCatalog`'s fan-out over several open
  // `prj.conf` tabs hit.
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      onNotify: (plan) => (isConsentPlan(plan) ? "downloadTanCli" : undefined),
    });
    const results = await Promise.all([
      adapter.resolveAlpBinaryForContext(home.context, { interactive: true }),
      adapter.resolveAlpBinaryForContext(home.context, { interactive: true }),
      adapter.resolveAlpBinaryForContext(home.context, { interactive: true }),
    ]);

    assert.equal(
      plans.filter(isConsentPlan).length,
      1,
      "three concurrent resolutions must share one in-flight resolution, not open three dialogs",
    );
    assert.deepEqual(results[1], results[0]);
    assert.deepEqual(results[2], results[0]);
  } finally {
    await server.close();
    home.cleanup();
  }
});

// ── a rejecting `notify` must not break "never throws" (finding 5) ──────────

test("ensureTanCliProvisioned: a `notify` rejection that is NOT a cancellation must not propagate", async () => {
  // `notify` can reject for reasons other than the user closing the window
  // (`src/notify/vscodeAdapter.ts`) — this used to rethrow out of
  // `ensureFreshInstallConsent`, past `ensureTanCliProvisioned`'s own
  // try/catch (the call site sits outside it), breaking that function's
  // documented "Never throws" contract into an unhandled rejection at
  // `extension.ts`'s un-awaited `void ensureTanCliProvisioned(context)
  // .finally(...)` (no `.catch`).
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    const { adapter } = loadAdapter({
      releaseAsset: server.asset,
      onNotify: () => {
        throw new Error("some other VS Code API failure, not a decline");
      },
    });
    await assert.doesNotReject(() =>
      adapter.ensureTanCliProvisioned(home.context),
    );
    // A failed prompt is not consent — nothing should have downloaded.
    assert.equal(fs.existsSync(home.cachedBinaryPath), false);
  } finally {
    await server.close();
    home.cleanup();
  }
});

// ── #438: an interactive caller landing during a non-interactive in-flight
//    resolution must not inherit its silent refusal ──────────────────────────

test("resolveAlpBinaryForContext: an interactive request landing during a non-interactive in-flight resolution ends up prompting, not silently refused", async () => {
  // The defect: activation's non-interactive `runCliVersionCheck` starts a
  // resolution first (unanswered "ask", so it will refuse quietly); a real
  // click (Dependencies panel Refresh, opening the Build Plan panel) lands
  // while that is still in flight and, before this fix, joined the SAME
  // promise verbatim — inheriting `interactive: false` and getting the
  // silent refusal instead of its own dialog.
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      onNotify: (plan) => (isConsentPlan(plan) ? "downloadTanCli" : undefined),
    });

    // All calls issued back-to-back with no `await` between them, exactly
    // like `runCliVersionCheck` firing un-awaited on activation and clicks
    // landing moments later while it is still resolving. `.catch` is attached
    // to the background call IMMEDIATELY (not after the interactive calls
    // below) so its expected rejection is never reported as an unhandled one.
    // THREE interactive callers, not one: the first escalates
    // (`chainInteractiveRetry`), and the second and third must join that
    // SAME chain — via the `resolving === attempt` identity check that
    // stops a later caller from starting a second retry (and a second
    // dialog) while the escalation's own retry is in flight — rather than
    // each building their own.
    const background = adapter
      .resolveAlpBinaryForContext(home.context)
      .catch((error) => error);
    const interactiveA = adapter.resolveAlpBinaryForContext(home.context, {
      interactive: true,
    });
    const interactiveB = adapter.resolveAlpBinaryForContext(home.context, {
      interactive: true,
    });
    const interactiveC = adapter.resolveAlpBinaryForContext(home.context, {
      interactive: true,
    });

    const [resolvedA, resolvedB, resolvedC] = await Promise.all([
      interactiveA,
      interactiveB,
      interactiveC,
    ]);
    const backgroundOutcome = await background;

    assert.equal(
      plans.filter(isConsentPlan).length,
      1,
      "three interactive callers landing on an in-flight background resolution must still share ONE dialog",
    );
    assert.equal(resolvedA.command, home.cachedBinaryPath);
    assert.deepEqual(resolvedB, resolvedA);
    assert.deepEqual(resolvedC, resolvedA);
    assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
    // The background caller's own behaviour is UNCHANGED by this fix — it
    // still gets the quiet refusal `runCliVersionCheck` relies on (its own
    // call site swallows this).
    assert.ok(
      backgroundOutcome instanceof Error,
      "the non-interactive caller must still be refused quietly, not prompted",
    );
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("resolveAlpBinaryForContext: an interactive caller joining a deny-refused background resolution does not retry — no dialog, no second PATH probe", async () => {
  // `adapterCore.ts`'s `download` arm throws the IDENTICAL
  // TAN_CLI_DOWNLOAD_CONSENT_NEEDED message for a `deny` setting as it does
  // for a genuinely unanswered "ask" — neither depends on `interactive`. An
  // interactive retry cannot turn a `deny` into a "yes", so escalating
  // anyway would rerun the whole resolution ladder (a second `tan --version`
  // PATH probe among it, each capped at 5s in production) for an answer that
  // can never change — a real cost on exactly the enterprise images most
  // likely to set `deny`.
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    let spawnSyncCalls = 0;
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      config: { "alpSdk.tanCliDownloadConsent": "deny" },
      onSpawnSync: () => {
        spawnSyncCalls += 1;
      },
      onNotify: () => {
        throw new Error("a deny setting must never prompt, retry or not");
      },
    });

    const background = adapter
      .resolveAlpBinaryForContext(home.context)
      .catch((error) => error);
    const interactive = adapter
      .resolveAlpBinaryForContext(home.context, { interactive: true })
      .catch((error) => error);

    const [backgroundOutcome, interactiveOutcome] = await Promise.all([
      background,
      interactive,
    ]);

    assert.deepEqual(plans.filter(isConsentPlan), []);
    assert.ok(backgroundOutcome instanceof Error);
    assert.ok(interactiveOutcome instanceof Error);
    assert.equal(
      spawnSyncCalls,
      1,
      "joining a deny-refused resolution must not rerun the resolution ladder for an answer that cannot change",
    );
    assert.equal(fs.existsSync(home.cachedBinaryPath), false);
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("resolveAlpBinaryForContext: a non-interactive-only fan-in still raises no plan (no regression)", async () => {
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      onNotify: () => {
        throw new Error(
          "a non-interactive-only in-flight resolution must never prompt",
        );
      },
    });

    const results = await Promise.all([
      adapter.resolveAlpBinaryForContext(home.context).catch((error) => error),
      adapter.resolveAlpBinaryForContext(home.context).catch((error) => error),
    ]);

    assert.deepEqual(plans.filter(isConsentPlan), []);
    assert.ok(results[0] instanceof Error);
    assert.ok(results[1] instanceof Error);
    assert.equal(fs.existsSync(home.cachedBinaryPath), false);
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("resolveAlpBinaryForContext: a rejected resolution clears the slot so the next caller retries instead of inheriting a dead promise", async () => {
  const home = extensionHome();
  home.store.set(DOWNLOAD_CONSENT_KEY, "declined");
  const server = await releaseServer(GOOD);
  try {
    const { adapter } = loadAdapter({
      releaseAsset: server.asset,
      onNotify: () => {
        throw new Error("a stored decline must never prompt");
      },
    });

    await assert.rejects(
      adapter.resolveAlpBinaryForContext(home.context, { interactive: true }),
    );

    // Consent is now granted (the user flipped the setting) — the caller
    // after the rejection must get a FRESH resolution, not the settled
    // rejected promise the slot was left holding.
    home.store.set(DOWNLOAD_CONSENT_KEY, "accepted");
    const resolved = await adapter.resolveAlpBinaryForContext(home.context, {
      interactive: true,
    });

    assert.equal(resolved.command, home.cachedBinaryPath);
    assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
  } finally {
    await server.close();
    home.cleanup();
  }
});
