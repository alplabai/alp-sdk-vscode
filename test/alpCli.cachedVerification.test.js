// SPDX-License-Identifier: Apache-2.0
//
// #386: a binary sitting in the extension's cache was spawned having been
// checked exactly once — when it was downloaded, and only since #389. The
// download happens once; the cache is read on every activation forever, so the
// `cached` arm is the one that actually gets reached.
//
// Two halves, and neither catches the other's failure:
//
//   * the CHECK — `resolveAlpBinary`'s `cached` arm, driven through injected
//     deps, including a corrupted file with a valid record present. A test that
//     only proves a good binary runs also passes when the comparison is
//     deleted, so the mismatch case is the load-bearing one.
//   * the WIRING — the same check driven through the REAL `vscodeAdapter`,
//     against a real file on disk and a real `globalState`, on every route that
//     can reach a spawn. #389 shipped a guard that watched one route while two
//     others bypassed it, and the omission failed OPEN; the routes are
//     therefore enumerated here rather than assumed.
//
// The routes that reach a spawn of the resolved binary, verified by grepping
// for callers rather than trusting a list:
//
//   resolveAlpBinary
//     ├── resolveAlpBinaryForContext (memoized per window)
//     │     ├── runAlpCommand          → cp.spawn
//     │     ├── runAlpInTerminal       → runInTerminal   (the `alp` task
//     │     │                             provider delegates here, it does not
//     │     │                             spawn `tan` itself)
//     │     └── checkCliVersion        → cp.spawnSync --version
//     └── readResolvedCliVersion (NOT memoized — its own deps)
//           ├── probeTanVersion        → cp.execFile --version
//           └── ensureTanCliProvisioned
//
// Nothing else in `src/` names `cachedBinaryPath`.
//
// NO NETWORK. Every download here is served from 127.0.0.1. A guard test that
// suddenly takes seconds is doing I/O it should not be — that is how #389's
// silent-real-network bug surfaced (a 2.4 s test), so keep an eye on the
// duration line rather than only the tick.

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
const SERVICE_PATH = require.resolve(
  path.join(root, "out", "alpCli", "service.js"),
);
const ADAPTER = require.resolve(
  path.join(root, "out", "alpCli", "vscodeAdapter.js"),
);

// Captured BEFORE anything is stubbed, and held by reference: the cache entries
// below are deleted and re-required, but these objects stay valid.
const CORE = require(CORE_PATH);
const SERVICE = require(SERVICE_PATH);
// NOT reloaded anywhere, so `instanceof` stays meaningful across every fresh
// adapter load below — which is also why the `./download` stub in `loadAdapter`
// SPREADS this module rather than replacing it.
const DOWNLOAD = require(path.join(root, "out", "alpCli", "download.js"));
const { ChecksumError } = DOWNLOAD;

const sha256 = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");
const sha256File = (file) => sha256(fs.readFileSync(file));

// ── half 1: the check, through injected deps ────────────────────────────────

const GOOD = "the real tan binary\n";
const TAMPERED = "NOT what Alp Lab published\n";

function coreDeps(overrides = {}) {
  const existing = new Set(overrides.existing ?? []);
  const bytes = new Map(Object.entries(overrides.bytes ?? {}));
  let recorded = overrides.recordedDigest;
  const calls = { download: 0, recorded: [] };
  return {
    calls,
    setBytes: (p, value) => bytes.set(p, value),
    deps: {
      cliPathSetting: "",
      platform: "linux",
      arch: "x64",
      cacheDir: "/cache/cli",
      cachedBinaryPath: "/cache/cli/tan",
      bundledBinaryPath: "/ext/bin/tan",
      bundledExists: false,
      localBuildBinaryPath: null,
      preferGlobalCli: false,
      fileExists: (p) => existing.has(p),
      commandOnPath: () => false,
      ensureDir: () => {},
      download: async (_url, destFile) => {
        calls.download++;
        existing.add(destFile);
        bytes.set(destFile, GOOD);
      },
      chmodExec: () => {},
      sha256File: (p) => (bytes.has(p) ? sha256(bytes.get(p)) : null),
      recordedCachedDigest: () => recorded,
      recordCachedDigest: async (digest) => {
        recorded = digest;
        calls.recorded.push(digest);
      },
      // Consent already granted by default — these rows are about the
      // CHECK (cached-digest verification, download wiring), not about
      // ADR 0021's consent gate, which has its own file
      // (test/alpCli.downloadConsent.test.js). A row that wants to drive the
      // refusal overrides this via `overrides.deps`.
      ensureFreshDownloadConsent: async () => true,
      ...overrides.deps,
    },
  };
}

test("cached arm: a binary whose bytes still match the recorded digest is spawned", async () => {
  const { deps, calls } = coreDeps({
    existing: ["/cache/cli/tan"],
    bytes: { "/cache/cli/tan": GOOD },
    recordedDigest: sha256(GOOD),
  });
  assert.deepEqual(await CORE.resolveAlpBinary(deps), {
    command: "/cache/cli/tan",
    source: "cached",
  });
  assert.equal(calls.download, 0, "a verified cache must not re-download");
});

test("cached arm: a binary REWRITTEN under a valid record REFUSES the spawn (#386)", async () => {
  const { deps, setBytes, calls } = coreDeps({
    existing: ["/cache/cli/tan"],
    bytes: { "/cache/cli/tan": GOOD },
    recordedDigest: sha256(GOOD),
  });
  // Exactly the case the whole feature exists for: the file on disk changed
  // after it was verified — corruption, a partial write, or anything with write
  // access to the cache directory. Deleting the `actual !== recorded`
  // comparison in `resolveAlpBinary` makes THIS test fail and no other.
  setBytes("/cache/cli/tan", TAMPERED);
  await assert.rejects(
    () => CORE.resolveAlpBinary(deps),
    (error) => {
      assert.equal(error.name, "ChecksumError");
      assert.equal(error.message, SERVICE.CACHED_CLI_MISMATCH);
      // The digests and the path are channel-only, never in the sentence.
      assert.match(error.detail, /sha256 on disk is [0-9a-f]{64}/);
      assert.match(error.detail, /recorded digest is [0-9a-f]{64}/);
      assert.doesNotMatch(error.message, /[0-9a-f]{64}/);
      assert.doesNotMatch(error.message, /\/cache\//);
      return true;
    },
  );
  assert.equal(calls.download, 0, "a refusal must not silently re-download");
});

test("cached arm: an UNREADABLE cached binary refuses rather than passing", async () => {
  // `sha256File` answers null for a file it cannot read (locked, replaced by a
  // directory). `null !== recorded`, so this refuses — the alternative is that
  // an unreadable file reads as "nothing to compare, carry on".
  const { deps } = coreDeps({
    existing: ["/cache/cli/tan"],
    bytes: {},
    recordedDigest: sha256(GOOD),
  });
  await assert.rejects(() => CORE.resolveAlpBinary(deps), {
    name: "ChecksumError",
    message: SERVICE.CACHED_CLI_MISMATCH,
  });
});

test("migration: a cached binary with NO record is re-acquired, not accepted-and-recorded", async () => {
  const { deps, calls } = coreDeps({
    existing: ["/cache/cli/tan"],
    bytes: { "/cache/cli/tan": TAMPERED },
    recordedDigest: undefined, // every machine that cached before #389
  });
  const resolved = await CORE.resolveAlpBinary(deps);
  // Routed to the DOWNLOAD arm. Recording the digest of whatever is already
  // there would launder an unverified binary into a "verified" one and
  // reproduce #386 with extra steps.
  assert.equal(resolved.source, "download");
  assert.equal(calls.download, 1);
  assert.deepEqual(calls.recorded, [sha256(GOOD)]);
  // …and the very next resolution now takes the cached arm and passes it.
  assert.deepEqual(await CORE.resolveAlpBinary(deps), {
    command: "/cache/cli/tan",
    source: "cached",
  });
  assert.equal(calls.download, 1, "the migration must happen once, not always");
});

test("migration: an offline re-acquire refuses with the migration sentence, not a generic download failure", async () => {
  const { deps } = coreDeps({
    existing: ["/cache/cli/tan"],
    bytes: { "/cache/cli/tan": GOOD },
    recordedDigest: undefined,
    deps: {
      download: async () => {
        throw new Error("getaddrinfo ENOTFOUND github.com");
      },
    },
  });
  await assert.rejects(
    () => CORE.resolveAlpBinary(deps),
    (error) => {
      assert.equal(error.name, "ChecksumError");
      assert.equal(error.message, SERVICE.CACHED_CLI_UNVERIFIED);
      // The errno rides on `detail`, which the presenter logs and never
      // renders — and the sentence must not read as "your network is down",
      // because what the customer actually needs to know is why the working
      // copy they already have stopped being used.
      assert.match(error.detail, /ENOTFOUND/);
      assert.doesNotMatch(error.message, /ENOTFOUND/);
      return true;
    },
  );
});

test("migration: a MISMATCH during the re-acquire keeps its own sentence", async () => {
  const refusal = new ChecksumError(
    "mismatch",
    "published-digest mismatch sentence",
    "d",
  );
  const { deps } = coreDeps({
    existing: ["/cache/cli/tan"],
    bytes: { "/cache/cli/tan": GOOD },
    recordedDigest: undefined,
    deps: {
      download: async () => {
        throw refusal;
      },
    },
  });
  // "The release served bytes that are not the published ones" outranks the
  // migration framing and must not be softened into "reconnect and retry" —
  // #389's lesson about not flattening distinct refusals into one sentence.
  await assert.rejects(
    () => CORE.resolveAlpBinary(deps),
    (error) => {
      assert.equal(error, refusal);
      return true;
    },
  );
});

test("migration: an UNFETCHABLE checksum during the re-acquire IS re-framed, cause kept on detail", async () => {
  const refusal = new ChecksumError(
    "unfetchable",
    "The tan CLI download was discarded: the checksum file … could not be fetched.",
    "could not fetch checksums.txt — ECONNREFUSED",
  );
  const { deps } = coreDeps({
    existing: ["/cache/cli/tan"],
    bytes: { "/cache/cli/tan": GOOD },
    recordedDigest: undefined,
    deps: {
      download: async () => {
        throw refusal;
      },
    },
  });
  // This is what OFFLINE actually looks like: the checksum file is fetched
  // first, so an unreachable network surfaces as `unfetchable`, not as a raw
  // socket error. Before this branch existed the migration sentence was
  // unreachable in the one case the whole migration wording is for.
  await assert.rejects(
    () => CORE.resolveAlpBinary(deps),
    (error) => {
      assert.equal(error.kind, "unrecorded");
      assert.equal(error.message, SERVICE.CACHED_CLI_UNVERIFIED);
      assert.match(error.detail, /ECONNREFUSED/);
      assert.match(error.detail, /could not be fetched/);
      return true;
    },
  );
});

/** A cached-but-unrecorded machine whose re-acquire throws `error`. */
function migratingDeps(error) {
  return coreDeps({
    existing: ["/cache/cli/tan"],
    bytes: { "/cache/cli/tan": GOOD },
    recordedDigest: undefined,
    deps: {
      download: async () => {
        throw error;
      },
    },
  }).deps;
}

test("migration: a user CANCEL is not re-framed as a verification refusal", async () => {
  const abort = new Error("The operation was aborted");
  abort.name = "AbortError";
  // The customer pressed Cancel, and the CALLER'S OWN signal having fired is
  // what says so — not the error's name. Both signal-passing callers
  // (`ensureTanCliProvisioned`, `updateAlpCli`) branch on their `cancelled`
  // flag before any wording, and turning this into a ChecksumError would put a
  // refusal toast in front of someone who asked for the abort.
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => CORE.downloadCli(migratingDeps(abort), controller.signal),
    (error) => {
      assert.equal(error, abort);
      return true;
    },
  );
});

test("migration: a wall-clock TIMEOUT is re-framed, because nothing downstream branches on it", async () => {
  // What `AbortSignal.timeout(WALL_CLOCK_TIMEOUT_MS)` throws and `downloadFile`
  // re-throws raw: abort-SHAPED, and a failure rather than a cancel. It used to
  // travel unchanged on the name alone. `isCancellation` (notify/service.ts)
  // requires `name === message === "Canceled"`, so no caller ever branched on
  // it — on the per-command route below it reached the toast as `spawnFailed`
  // with that plan's default "Install tan CLI" button, i.e. a one-click route onto a
  // PATH binary nothing verifies.
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  // The per-command route: `resolveAlpBinary`'s `download` arm passes NO signal.
  await assert.rejects(
    () => CORE.resolveAlpBinary(migratingDeps(timeout)),
    (error) => {
      assert.equal(error.name, "ChecksumError");
      assert.equal(error.kind, "unrecorded");
      assert.equal(error.message, SERVICE.CACHED_CLI_UNVERIFIED);
      assert.match(error.detail, /timeout/i);
      return true;
    },
  );
  // …and the same on a route that DOES pass a signal, when that signal has not
  // fired: the wall clock is the download's own, not the customer's.
  await assert.rejects(
    () =>
      CORE.downloadCli(migratingDeps(timeout), new AbortController().signal),
    { name: "ChecksumError", message: SERVICE.CACHED_CLI_UNVERIFIED },
  );
});

test("download arm: a FIRST install records the digest and says nothing about a migration", async () => {
  const { deps, calls } = coreDeps({ existing: [], bytes: {} });
  const resolved = await CORE.resolveAlpBinary(deps);
  assert.equal(resolved.source, "download");
  assert.deepEqual(calls.recorded, [sha256(GOOD)]);
  assert.equal(
    SERVICE.isUnverifiableCache(CORE.resolutionInputFromDeps(deps)),
    false,
  );
});

// ── half 2: the wiring, through the real adapter ─────────────────────────────

const BINARY = process.platform === "win32" ? "tan.exe" : "tan";

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

/** A real-on-disk extension home: a temp globalStorage + extensionPath, and a
 *  `globalState` backed by a Map so the digest record is stored and read back
 *  the way VS Code would. */
function extensionHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-cached-verify-"));
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
 * Load a FRESH copy of the real `vscodeAdapter` (fresh module state: the
 * per-window resolution memo and the hash memo), keeping the REAL `adapterCore`,
 * `service`, `download` and `fs`. Only the host seams are stubbed, plus:
 *
 *  - `releaseAsset` → `releaseAssetForTarget`, so a download can be served from
 *    127.0.0.1 instead of github.com;
 *  - `service` → any other `./service` export (a customer sentence, to prove a
 *    classification does not depend on its wording);
 *  - `transfer` → what `downloadSeam` RETURNS. `downloadSeam`, never
 *    `downloadFile`: the seam closes over the module-internal `downloadFile`,
 *    so stubbing that export is a silent no-op and a false green.
 */
function loadAdapter({
  onPath = false,
  releaseAsset,
  service,
  transfer,
  /** `"<section>.<key>"` → value, e.g. `{ "alpSdk.preferGlobalCli": true }`. */
  config = {},
} = {}) {
  const spawned = [];
  const versionProbes = [];
  const terminals = [];
  const plans = [];
  const nativeVersion = `tan ${SERVICE.SUPPORTED_CLI_VERSION}\n`;

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
      spawn: (command, args) => {
        spawned.push({ command, args });
        return {
          stdout: { setEncoding() {}, on() {} },
          stderr: { setEncoding() {}, on() {} },
          kill() {},
          on(event, handler) {
            if (event === "close") setImmediate(() => handler(0));
          },
        };
      },
      // `commandOnPath` and `checkCliVersion` both go through this.
      spawnSync: (command, args) => {
        spawned.push({ command, args, sync: true });
        return onPath
          ? { status: 0, stdout: nativeVersion, stderr: "" }
          : { status: 1, stdout: "", stderr: "" };
      },
      execFile: (command, args, _options, callback) => {
        versionProbes.push({ command, args });
        callback(null, { stdout: nativeVersion, stderr: "" });
      },
    },
    "../notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return undefined;
      },
      notifyAsync: (plan) => {
        plans.push(plan);
      },
    },
    "../project/vscodeAdapter": { collectProjectContext: () => ({}) },
    "../util": {
      log() {},
      runInTerminal: (options) => terminals.push(options),
    },
    ...(releaseAsset || service
      ? {
          "./service": {
            ...SERVICE,
            ...(releaseAsset
              ? { releaseAssetForTarget: () => releaseAsset }
              : {}),
            ...service,
          },
        }
      : {}),
    ...(transfer
      ? { "./download": { ...DOWNLOAD, downloadSeam: () => transfer } }
      : {}),
  };

  const originalLoad = Module._load;
  // `adapterCore` is reloaded too, so that when `./service` is stubbed the
  // resolver picks up the stub rather than the cached real module.
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
    // Never leave a stub-fed `adapterCore` in the cache for the next test.
    delete require.cache[CORE_PATH];
  }
  return { adapter, spawned, versionProbes, terminals, plans };
}

test("wiring: a cached binary matching the recorded digest resolves and IS spawned", async () => {
  const home = extensionHome();
  try {
    const file = home.writeCachedBinary(GOOD);
    home.store.set("alp.tanCachedBinarySha256", sha256File(file));
    const { adapter, versionProbes } = loadAdapter();

    const binary = await adapter.resolveAlpBinaryForContext(home.context);
    assert.deepEqual(binary, { command: file, source: "cached" });
    // …and the probe route really does exec it, so the "no spawn" assertions
    // below are measuring something that otherwise happens.
    assert.equal(
      await adapter.probeTanVersion(home.context),
      SERVICE.SUPPORTED_CLI_VERSION,
    );
    assert.deepEqual(
      versionProbes.map((p) => p.command),
      [file],
    );
  } finally {
    home.cleanup();
  }
});

test("wiring: a cached binary CORRUPTED on disk is refused on every route that could spawn it", async () => {
  const home = extensionHome();
  try {
    const file = home.writeCachedBinary(GOOD);
    home.store.set("alp.tanCachedBinarySha256", sha256File(file));
    // The record stays; the file changes. This is #386's live case: something
    // rewrote the binary the extension spawns on every activation.
    fs.writeFileSync(file, TAMPERED);

    const { adapter, spawned, versionProbes, terminals, plans } = loadAdapter();

    // Route 1 — the memoized resolution every command goes through.
    await assert.rejects(
      () => adapter.resolveAlpBinaryForContext(home.context),
      { name: "ChecksumError", message: SERVICE.CACHED_CLI_MISMATCH },
    );

    // Route 2 — envelope commands. Never throws; the refusal has to arrive as
    // an outcome the notification planner can present.
    const { outcome, source } = await adapter.runAlpCommand(home.context, [
      "validate",
    ]);
    assert.equal(source, "unresolved");
    assert.equal(outcome.unavailable.reason, "checksumRefused");
    assert.equal(outcome.message, SERVICE.CACHED_CLI_MISMATCH);

    // Route 3 — the terminal seam (`tan build`, `tan bootstrap`, and every
    // `alp:` task, which delegates here).
    await adapter.runAlpInTerminal(home.context, ["build"], {
      name: "alp build",
      cwd: undefined,
    });
    assert.deepEqual(terminals, [], "a refused binary reached the terminal");

    // Route 4 — the never-fetching version probe.
    assert.equal(await adapter.probeTanVersion(home.context), null);

    // Route 5 — activation-time provisioning and the version check.
    await adapter.ensureTanCliProvisioned(home.context);
    await adapter.checkCliVersion(home.context);

    // NOTHING ran the cached binary on any of them.
    assert.deepEqual(
      spawned.filter((s) => s.command === file),
      [],
      "the corrupted cached binary was spawned",
    );
    assert.deepEqual(versionProbes, [], "the corrupted binary was exec'd");

    // …and the toast the customer gets offers no way around the check. #389
    // had to remove an `openSettings → alpSdk.cliPath` button for exactly this
    // reason: that source is never verified.
    const shown = plans.filter((p) => p.message.includes("checksum"));
    assert.ok(shown.length > 0, "the refusal never reached a notification");
    for (const plan of shown) {
      assert.deepEqual(
        plan.actions.filter((a) => a.id === "openSettings"),
        [],
        "the refusal offered a settings bypass",
      );
    }
  } finally {
    home.cleanup();
  }
});

test("wiring: a cached binary with NO record is never spawned, and the probe still does not fetch", async () => {
  const home = extensionHome();
  try {
    const file = home.writeCachedBinary(GOOD);
    // No `alp.tanCachedBinarySha256` — the state of every machine that used the
    // extension before the digest was recorded.
    const { adapter, versionProbes } = loadAdapter({ onPath: true });

    // A verified-native `tan` on PATH is present, so the ladder lands there
    // rather than on the unvouched-for cache. The point is the negative: the
    // cached path is NOT what resolves.
    const binary = await adapter.resolveAlpBinaryForContext(home.context);
    assert.notEqual(binary.command, file);
    assert.equal(binary.source, "path");

    // And `probeTanVersion` keeps its "never fetch" contract: with the
    // migration decided in `decideBinarySource` it sees `path`/`download`, so
    // it can never turn a window-focus refresh into a network download.
    await adapter.probeTanVersion(home.context);
    assert.deepEqual(
      versionProbes.filter((p) => p.command === file),
      [],
      "the unverifiable cached binary was exec'd",
    );
  } finally {
    home.cleanup();
  }
});

test("wiring: the hash memo does not mask a rewrite WITHIN one window", async () => {
  const home = extensionHome();
  try {
    const file = home.writeCachedBinary(GOOD);
    home.store.set("alp.tanCachedBinarySha256", sha256File(file));
    // ONE adapter instance throughout — so the module-level hash memo is live
    // and warm from the first resolution. `resetResolvedBinary` only clears the
    // resolution memo; if the hash memo were keyed on the path alone, the
    // second resolution would re-use the first answer and accept the rewrite.
    const { adapter } = loadAdapter();
    assert.equal(
      (await adapter.resolveAlpBinaryForContext(home.context)).source,
      "cached",
    );

    // Deliberately a DIFFERENT LENGTH from GOOD: the memo key carries size as
    // well as mtime, and equal-length bodies would leave this test depending on
    // the filesystem's mtime resolution. Do not "tidy" these two constants to
    // the same length.
    assert.notEqual(GOOD.length, TAMPERED.length);
    fs.writeFileSync(file, TAMPERED);
    adapter.resetResolvedBinary();

    await assert.rejects(
      () => adapter.resolveAlpBinaryForContext(home.context),
      {
        name: "ChecksumError",
        message: SERVICE.CACHED_CLI_MISMATCH,
      },
    );
  } finally {
    home.cleanup();
  }
});

test("wiring: an offline migration at ACTIVATION says it is a one-time migration, and offers no bypass", async () => {
  const home = extensionHome();
  try {
    home.writeCachedBinary(GOOD); // present, but nothing recorded for it
    // Port 1 on loopback: refused immediately, no network, no waiting. This is
    // the offline re-acquire — and the checksum file is fetched FIRST, so the
    // failure arrives as an `unfetchable` ChecksumError rather than a raw
    // socket error, which is precisely the path that used to bypass the
    // migration wording.
    const { adapter, plans } = loadAdapter({
      releaseAsset: {
        target: "test-target",
        assetName: BINARY,
        tag: "v0.0.0-test",
        url: `http://127.0.0.1:1/${BINARY}`,
        checksumsUrl: "http://127.0.0.1:1/checksums.txt",
      },
      // `onPath` is false (default), so this row IS a fresh-install-shaped
      // consent gate now (nothing is running — see
      // `isUnverifiableCacheInUse`), which is not what this row means to
      // measure — pre-answer it, exactly like "wiring: download → record"
      // below does, so the row reaches the migration FAILURE this test is
      // actually about. Consent has its own file
      // (test/alpCli.downloadConsent.test.js).
      config: { "alpSdk.tanCliDownloadConsent": "allow" },
    });

    await adapter.ensureTanCliProvisioned(home.context);

    assert.equal(plans.length, 1, "activation raised no notification");
    const [plan] = plans;
    assert.equal(plan.message, SERVICE.CACHED_CLI_UNVERIFIED);
    // Not the generic "Couldn't download the tan CLI … or point alpSdk.cliPath
    // at a local build": this customer HAS a tan CLI, and `cliPath` is the one
    // source that is never verified.
    assert.doesNotMatch(plan.message, /Couldn't download the tan CLI/);
    assert.deepEqual(
      plan.actions.filter((a) => a.id === "openSettings"),
      [],
    );
    assert.ok(plan.actions.some((a) => a.id === "updateCli"));
    // The precise cause survives, on the channel-only field.
    assert.match(plan.detail ?? "", /checksum file/i);
  } finally {
    home.cleanup();
  }
});

test("wiring: a re-acquire that downloads but cannot RECORD still refuses, and still offers no bypass", async () => {
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    home.writeCachedBinary(TAMPERED); // present, unrecorded — the migration
    // The transfer succeeds and the record write fails. Not hypothetical
    // plumbing: this is what a globalState write error looks like, and it is
    // the ONLY failure that gets past `checksumFailurePlan` to the fallback
    // plan's own migration branch. Without a test the branch is invisible —
    // neutering it leaves the whole suite green.
    home.context.globalState.update = async () => {
      throw new Error("globalState write failed");
    };
    // Pre-answer consent (see the comment on the "offline migration" row
    // above) — "allow" returns before ever touching `globalState`, so the
    // override above stays reserved for the record write this row tests.
    const { adapter, plans } = loadAdapter({
      releaseAsset: server.asset,
      config: { "alpSdk.tanCliDownloadConsent": "allow" },
    });

    await adapter.ensureTanCliProvisioned(home.context);

    assert.equal(plans.length, 1);
    assert.equal(plans[0].message, SERVICE.CACHED_CLI_UNVERIFIED);
    assert.deepEqual(
      plans[0].actions.filter((a) => a.id === "openSettings"),
      [],
      "the re-acquire failure offered alpSdk.cliPath, which is never verified",
    );
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("wiring: download → record in globalState → verified on the next resolution", async () => {
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    // The full loop end to end, over 127.0.0.1: nothing cached, nothing
    // recorded. This is what proves `recordCachedDigest` is wired to the real
    // `globalState` — a no-op there leaves every other test in this file green
    // and the shipped extension permanently refusing its own downloads.
    //
    // `tanCliDownloadConsent: "allow"` pre-answers ADR 0021's consent gate —
    // this row is about the download-and-record WIRING, not consent, which
    // has its own file (test/alpCli.downloadConsent.test.js). Without it a
    // NON-interactive `resolveAlpBinaryForContext(context)` (no `{
    // interactive: true }`, same call this row makes) refuses a fresh
    // install with nothing on record — correctly, but not what this row
    // means to measure.
    const { adapter } = loadAdapter({
      releaseAsset: server.asset,
      config: { "alpSdk.tanCliDownloadConsent": "allow" },
    });

    const first = await adapter.resolveAlpBinaryForContext(home.context);
    assert.equal(first.source, "download");
    assert.equal(first.command, home.cachedBinaryPath);
    assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
    assert.equal(
      home.store.get("alp.tanCachedBinarySha256"),
      sha256(GOOD),
      "the download did not record the digest it verified",
    );

    // A fresh window: the record is read back and the cached arm accepts.
    const { adapter: next } = loadAdapter({ releaseAsset: server.asset });
    assert.deepEqual(await next.resolveAlpBinaryForContext(home.context), {
      command: home.cachedBinaryPath,
      source: "cached",
    });

    // Now rewrite it behind the record's back — the same window that just
    // accepted it refuses once the bytes change.
    fs.writeFileSync(home.cachedBinaryPath, TAMPERED);
    const { adapter: after } = loadAdapter({ releaseAsset: server.asset });
    await assert.rejects(() => after.resolveAlpBinaryForContext(home.context), {
      name: "ChecksumError",
      message: SERVICE.CACHED_CLI_MISMATCH,
    });
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("wiring: a STALLED re-acquire on the per-command route refuses, and its toast offers no bypass", async () => {
  const home = extensionHome();
  try {
    home.writeCachedBinary(GOOD); // present, unrecorded — the migration
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    // The whole loop for a migrating customer on a stalled link, on the route
    // that branches on nothing: activation fires `ensureTanCliProvisioned`
    // un-awaited, so a command issued before or instead of it downloads inline.
    // The transfer seam is stubbed at `downloadSeam` — NOT `downloadFile`,
    // which the seam closes over module-internally, so stubbing that export is
    // a silent no-op and a false green.
    const { adapter, plans, terminals } = loadAdapter({
      releaseAsset: {
        target: "test-target",
        assetName: BINARY,
        tag: "v0.0.0-test",
        url: `http://127.0.0.1:1/${BINARY}`,
        checksumsUrl: "http://127.0.0.1:1/checksums.txt",
      },
      transfer: async () => {
        throw timeout;
      },
      // `runAlpInTerminal` always resolves interactively, and `onPath` false
      // (default) means this row's un-digested cache is now gated on consent
      // like any fresh install (see the comment on the "offline migration"
      // row above) — pre-answer it so the row still reaches the STALLED
      // transfer this test is about, not the (correctly) unanswered dialog.
      config: { "alpSdk.tanCliDownloadConsent": "allow" },
    });

    await adapter.runAlpInTerminal(home.context, ["build"], {
      name: "alp build",
      cwd: undefined,
    });

    assert.deepEqual(
      terminals,
      [],
      "a stalled re-acquire still reached a spawn",
    );
    assert.equal(plans.length, 1);
    // The migration sentence, not "couldn't start the tan CLI".
    assert.equal(plans[0].message, SERVICE.CACHED_CLI_UNVERIFIED);
    // …and above all NO `installTanCli`. That button runs the bundled installer,
    // which puts a `tan` on PATH — and `path` is one of the four arms
    // `resolveAlpBinary` never verifies, so offering it here is a one-click
    // route onto an unverified binary. #389 removed exactly this class of
    // bypass; a raw `TimeoutError` re-introduced it through `spawnFailed`.
    for (const id of ["installTanCli", "openSettings"]) {
      assert.deepEqual(
        plans[0].actions.filter((a) => a.id === id),
        [],
        `the stalled re-acquire offered ${id}`,
      );
    }
  } finally {
    home.cleanup();
  }
});

test("wiring: a ChecksumError is classified by its TYPE, not by the word 'checksum' in its sentence", async () => {
  const home = extensionHome();
  try {
    const file = home.writeCachedBinary(GOOD);
    home.store.set("alp.tanCachedBinarySha256", sha256File(file));
    fs.writeFileSync(file, TAMPERED);

    // The same refusal, re-worded WITHOUT the word `classifyUnavailable`
    // string-sniffs for. These are customer sentences and they get edited; the
    // classification must not ride on their wording. Sniffing this text lands
    // on `spawnFailed`, whose plan hands out an "Install tan CLI" button.
    const REWORDED =
      "The tan CLI installed for this extension is not the copy that was " +
      "verified when it was downloaded, so it was not run. Reinstall the " +
      "pinned tan CLI from the command palette.";
    assert.notEqual(SERVICE.classifyUnavailable(REWORDED), "checksumRefused");

    const { adapter } = loadAdapter({
      service: { CACHED_CLI_MISMATCH: REWORDED },
    });
    const { outcome } = await adapter.runAlpCommand(home.context, ["validate"]);
    assert.equal(outcome.message, REWORDED);
    assert.equal(outcome.unavailable.reason, "checksumRefused");
  } finally {
    home.cleanup();
  }
});

// ── half 3: the migrating machine that ALSO has a global `tan` (#396) ────────
//
// The population above resolves `path`, not `download`: the un-digested cache
// is skipped, the next rung is PATH, and it is taken. Nothing prompts, nothing
// notices — a REFUSAL falling through onto an unverified arm, which is the
// zero-click version of the one-click bypass #389 removed.
//
// The fix is entirely in `shouldFetchManagedCli`'s trigger: an un-digested
// cache the ladder STEPS OVER, i.e. a resolved `path` or `download` — never a
// binary the user chose or built, which is the noise the wide version made. It
// is proven here by DRIVING every population through the real adapter, because
// the pure test cannot show the effective source snapping back, the notice,
// where its button lands, or the absence of a give-up latch.
//
// The stale-version self-heal HAS a give-up latch. This heal must not adopt it:
// its common failure is being offline, which is transient, and one latched
// activation would leave the machine on the unverified PATH binary until the
// pin moved.

/** A migrating machine: an un-digested binary in the cache, a global `tan` on
 *  PATH, and a release server (or a refused port) to heal from. */
function migratingHome() {
  const home = extensionHome();
  home.writeCachedBinary(TAMPERED); // present, unrecorded, and NOT what ships
  return home;
}

const OFFLINE_ASSET = {
  target: "test-target",
  assetName: BINARY,
  tag: "v0.0.0-test",
  // Port 1 on loopback: refused immediately. No network, no waiting.
  url: `http://127.0.0.1:1/${BINARY}`,
  checksumsUrl: "http://127.0.0.1:1/checksums.txt",
};

test("#396 migrating + ONLINE: heals the stepped-over cache, and the effective source snaps back to it", async () => {
  const home = migratingHome();
  const server = await releaseServer(GOOD);
  try {
    // Before the fix this activation did NOTHING: `decideBinarySource` answers
    // `path` (the cache is skipped), and the heal keyed on that source, so it
    // returned early at `shouldFetchManagedCli` and the window carried on
    // running the PATH binary.
    const { adapter, plans } = loadAdapter({
      onPath: true,
      releaseAsset: server.asset,
    });
    await adapter.ensureTanCliProvisioned(home.context);

    // The extension's OWN storage was replaced — nobody's choice overridden.
    assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
    assert.equal(
      home.store.get("alp.tanCachedBinarySha256"),
      sha256(GOOD),
      "the heal did not record the digest it verified",
    );
    assert.deepEqual(plans, [], "a successful heal must be silent");

    // …and precedence does the rest: with the digest recorded, `cached`
    // outranks the `path` FALLBACK again. No reordering was made anywhere.
    const { adapter: next } = loadAdapter({
      onPath: true,
      releaseAsset: server.asset,
    });
    assert.deepEqual(await next.resolveAlpBinaryForContext(home.context), {
      command: home.cachedBinaryPath,
      source: "cached",
    });
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("#396 migrating + OFFLINE: keeps working on PATH, is told which binary that is, and is NOT latched off", async () => {
  const home = migratingHome();
  try {
    const { adapter, plans } = loadAdapter({
      onPath: true,
      releaseAsset: OFFLINE_ASSET,
    });
    await adapter.ensureTanCliProvisioned(home.context);

    // The residual window, stated honestly. `CACHED_CLI_UNVERIFIED` alone says
    // only "it will not be run", which leaves the customer's actual question —
    // what IS being run — unanswered on exactly the machine where the answer is
    // an unverified binary.
    assert.equal(plans.length, 1, "activation raised no notification");
    const [plan] = plans;
    assert.equal(plan.message, SERVICE.CACHED_CLI_UNVERIFIED_ON_PATH);
    assert.match(plan.message, /PATH/);
    // The existing update action, and NOTHING that routes onto an unverified
    // binary — the same bar #389 set for the refusals themselves.
    assert.ok(plan.actions.some((a) => a.id === "updateCli"));
    for (const id of ["installTanCli", "openSettings"]) {
      assert.deepEqual(
        plan.actions.filter((a) => a.id === id),
        [],
        `the fallback notice offered ${id}`,
      );
    }
    // Still WORKING, which is the point of not reordering the ladder.
    assert.equal(
      (await adapter.resolveAlpBinaryForContext(home.context)).source,
      "path",
    );
    // A failed heal must not write the stale-version give-up marker.
    assert.equal(
      home.store.has("alp.tanSelfHealGaveUpPin"),
      false,
      "an offline heal latched itself off",
    );

    // Two more offline activations, driven rather than reasoned about. The
    // stale-pin heal's `HEAL_GAVE_UP_KEY` latch would make these silent — and
    // a machine stranded on the unverified PATH binary until the pin moved, so
    // NOT adopting it is what these rows watch. Exactly one plan each: the
    // notice repeats per activation because the state does, and `extension.ts`
    // calls `ensureTanCliProvisioned` once per window.
    for (let activation = 2; activation <= 3; activation++) {
      const { adapter: again, plans: againPlans } = loadAdapter({
        onPath: true,
        releaseAsset: OFFLINE_ASSET,
      });
      await again.ensureTanCliProvisioned(home.context);
      assert.equal(
        againPlans.length,
        1,
        `the heal went quiet on offline activation ${activation}`,
      );
      assert.equal(
        againPlans[0].message,
        SERVICE.CACHED_CLI_UNVERIFIED_ON_PATH,
      );
      assert.equal(home.store.has("alp.tanSelfHealGaveUpPin"), false);
    }

    // Driven, not inferred: the NEXT activation, back online, heals.
    const server = await releaseServer(GOOD);
    try {
      const { adapter: online, plans: onlinePlans } = loadAdapter({
        onPath: true,
        releaseAsset: server.asset,
      });
      await online.ensureTanCliProvisioned(home.context);
      assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
      assert.deepEqual(onlinePlans, []);
      assert.equal(
        (await online.resolveAlpBinaryForContext(home.context)).source,
        "cached",
      );
    } finally {
      await server.close();
    }
  } finally {
    home.cleanup();
  }
});

test("#396 preferGlobalCli ON is left ENTIRELY alone: no toast, no fetch — and the cache heals the moment the flag goes off", async () => {
  // Rung 2 is a user/build-owned source by the same rule that excludes
  // `cliPath` / `localBuild` / `bundled`, and gets the same treatment. Healing
  // under the flag changes nothing about what runs — resolution still answers
  // `path` afterwards — so online it was a ~3 MB fetch of dead weight, and
  // offline it was an error toast PER ACTIVATION saying the extension's copy
  // "will not be run. Downloading it once more settles this for good", about a
  // copy this user opted out of running. On the base commit they got neither.
  //
  // Three activations, because "every activation" is the complaint, and
  // OFFLINE_ASSET is the measurement: any fetch at all hits a refused port and
  // surfaces as a plan, so an empty `plans` is a real assertion.
  const home = migratingHome();
  const config = { "alpSdk.preferGlobalCli": true };
  try {
    for (let activation = 0; activation < 3; activation++) {
      const { adapter, plans } = loadAdapter({
        onPath: true,
        releaseAsset: OFFLINE_ASSET,
        config,
      });
      await adapter.ensureTanCliProvisioned(home.context);
      assert.deepEqual(
        plans,
        [],
        `an opted-in user was disturbed on activation ${activation + 1}`,
      );
      assert.equal(
        (await adapter.resolveAlpBinaryForContext(home.context)).source,
        "path",
      );
    }
    // Untouched: not re-downloaded, and no digest invented for it either.
    assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), TAMPERED);
    assert.equal(home.store.has("alp.tanCachedBinarySha256"), false);

    // Online, still opted in: silent, and STILL no fetch. This is the row that
    // reds if the heal is narrowed only in the notice and not in the trigger —
    // the toast would be gone but the ~3 MB would not.
    const server = await releaseServer(GOOD);
    try {
      const { adapter: online, plans: onlinePlans } = loadAdapter({
        onPath: true,
        releaseAsset: server.asset,
        config,
      });
      await online.ensureTanCliProvisioned(home.context);
      assert.deepEqual(onlinePlans, []);
      assert.equal(
        fs.readFileSync(home.cachedBinaryPath, "utf8"),
        TAMPERED,
        "an opted-in user was made to download a copy they never run",
      );
      assert.equal(home.store.has("alp.tanCachedBinarySha256"), false);

      // Nothing is lost by leaving them alone — the same promise the other
      // three owned sources get. Stop insisting and the ladder reaches the
      // rung-6 fallback, where the heal fires on the very next activation.
      const { adapter: off, plans: offPlans } = loadAdapter({
        onPath: true,
        releaseAsset: server.asset,
      });
      await off.ensureTanCliProvisioned(home.context);
      assert.deepEqual(offPlans, [], "a successful heal must be silent");
      assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
      assert.equal(home.store.get("alp.tanCachedBinarySha256"), sha256(GOOD));
      assert.equal(
        (await off.resolveAlpBinaryForContext(home.context)).source,
        "cached",
      );
    } finally {
      await server.close();
    }
  } finally {
    home.cleanup();
  }
});

test("#396 the heal is NARROW: cliPath / localBuild / bundled keep an un-digested cache and are never disturbed", async () => {
  // The noise the wide trigger produced, driven. Each of these resolves a
  // binary the USER chose or built, with an un-digested copy still sitting in
  // our cache underneath it. Firing there told them "this extension's copy …
  // will not be run" on EVERY activation and, online, fetched ~3 MB they never
  // asked for — while their commands ran fine the whole time.
  //
  // OFFLINE_ASSET is the guard: any fetch at all hits a refused port and
  // surfaces as a plan, so `plans` staying empty is a real measurement, not an
  // absence of assertions. Three consecutive activations because "every
  // activation, forever" is the actual complaint.
  const populations = {
    cliPath: (home) => {
      const chosen = path.join(home.dir, "chosen-tan");
      fs.writeFileSync(chosen, GOOD);
      return { config: { "alpSdk.cliPath": chosen } };
    },
    localBuild: (home) => {
      const dir = path.join(home.dir, "tan-cli", "target", "release");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, BINARY), GOOD);
      return {};
    },
    bundled: (home) => {
      const dir = path.join(home.dir, "ext", "bin");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, BINARY), GOOD);
      return {};
    },
  };

  for (const [source, setup] of Object.entries(populations)) {
    const home = migratingHome(); // un-digested cache present the whole time
    try {
      const extra = setup(home);
      for (let activation = 0; activation < 3; activation++) {
        const { adapter, plans } = loadAdapter({
          onPath: true,
          releaseAsset: OFFLINE_ASSET,
          ...extra,
        });
        await adapter.ensureTanCliProvisioned(home.context);
        assert.deepEqual(
          plans,
          [],
          `${source} was disturbed on activation ${activation + 1}`,
        );
        assert.equal(
          (await adapter.resolveAlpBinaryForContext(home.context)).source,
          source,
        );
      }
      // Untouched: not re-downloaded, and no digest invented for it either.
      assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), TAMPERED);
      assert.equal(home.store.has("alp.tanCachedBinarySha256"), false);
    } finally {
      home.cleanup();
    }
  }
});

test("#396 no prebuilt for this host: the re-acquire that cannot even START still says so", async () => {
  // `releaseAssetForTarget` is null on a host tan-cli publishes no binary for,
  // and the fetch used to `return` bare — AFTER `shouldFetchManagedCli` said
  // yes and after the fall-through was computed. Un-digested cache, `tan` on
  // PATH, nothing to download ever: the extension ran the unverified PATH
  // binary and said nothing, every activation, forever. Narrow, permanent, and
  // exactly the defect this branch exists to close, so it may not stay silent.
  //
  // And it may not say "reconnect and retry" while it is at it. That is the one
  // instruction this host can never act on: `releaseAssetForTarget` is null
  // FOREVER here, so reconnecting settles nothing and the same toast returns on
  // every activation. The remedy that does exist is `alpSdk.cliPath` — the
  // setting the two "reconnect" sentences withhold, because there it is an
  // escape from a checksum refusal onto an unverified binary while a verified
  // one is a download away. Here no verified binary is obtainable at all, so it
  // is not an escape from verification, it is the only way to have a `tan`.
  const home = migratingHome();
  try {
    const { adapter, plans } = loadAdapter({
      onPath: true,
      service: { releaseAssetForTarget: () => null },
    });
    await adapter.ensureTanCliProvisioned(home.context);

    assert.equal(plans.length, 1, "the no-asset host stayed silent");
    const [plan] = plans;
    assert.equal(
      plan.message,
      SERVICE.CACHED_CLI_UNVERIFIED_NO_PREBUILT_ON_PATH,
    );
    assert.match(plan.message, /PATH/);
    assert.doesNotMatch(plan.message, /reconnect|retry/i);
    // No Retry: `alp.updateCli` re-enters `downloadCli`, which throws on this
    // same missing asset — a dead button, which is exactly why the sentence may
    // not tell them to press one. The remedy is named AND clickable.
    assert.deepEqual(
      plan.actions.map((a) => a.id),
      ["openSettings"],
    );
    assert.equal(plan.actions[0].arg, "alpSdk.cliPath");
    // FOLLOW THE BUTTON, same as the Retry below: the presenter's table is what
    // makes it land on the setting the sentence names, and an `arg` asserted
    // against nothing is how a dead button ships.
    assert.match(
      fs.readFileSync(
        path.join(root, "out", "notify", "vscodeAdapter.js"),
        "utf8",
      ),
      /openSettings:[\s\S]{0,400}?executeCommand\(\s*"workbench\.action\.openSettings"/,
    );
    // The host string is not lost by naming a remedy: the presenter writes
    // `detail` to the channel whether or not a button opens it.
    assert.match(plan.detail ?? "", /no prebuilt tan CLI for /);
    // Still working, on the binary the notice names.
    assert.equal(
      (await adapter.resolveAlpBinaryForContext(home.context)).source,
      "path",
    );
  } finally {
    home.cleanup();
  }

  // The same host with NO global `tan`: the un-digested cache is skipped and
  // nothing is left, so the source is `download` and the fall-through clause
  // would be a lie. It reached this branch through `CACHED_CLI_UNVERIFIED`,
  // which carries the same dead "reconnect and retry".
  const stranded = migratingHome();
  try {
    const { adapter, plans } = loadAdapter({
      service: { releaseAssetForTarget: () => null },
    });
    await adapter.ensureTanCliProvisioned(stranded.context);
    assert.equal(plans.length, 1, "the no-asset host stayed silent");
    assert.equal(
      plans[0].message,
      SERVICE.CACHED_CLI_UNVERIFIED_NO_PREBUILT,
      "a machine with no PATH tan was told commands fall back to one",
    );
    assert.doesNotMatch(plans[0].message, /PATH/);
    assert.doesNotMatch(plans[0].message, /reconnect|retry/i);
  } finally {
    stranded.cleanup();
  }

  // The guard reds: the SAME host on a FRESH install must keep skipping
  // silently (a command surfaces the "set alpSdk.cliPath" guidance if one is
  // ever invoked). No cache and no PATH `tan`, so the source is `download` and
  // this really does reach the guard above — with `onPath` it would return at
  // `shouldFetchManagedCli` instead and prove nothing. Make that notice
  // unconditional and this row starts raising a plan.
  const fresh = extensionHome();
  try {
    const { adapter, plans } = loadAdapter({
      service: { releaseAssetForTarget: () => null },
    });
    await adapter.ensureTanCliProvisioned(fresh.context);
    assert.deepEqual(plans, [], "a fresh install on a no-asset host was told");
  } finally {
    fresh.cleanup();
  }
});

test("#396 the notice's Retry lands on a DOWNLOAD, not back on alpSdk.cliPath", async () => {
  // The dead end, driven end to end. `alpSdk.cliPath` pointing at a path that
  // no longer exists (moved checkout, synced settings) does NOT resolve, so the
  // ladder skips it, skips the un-digested cache, and takes PATH — the notice
  // fires. Its only action is `updateCli`, and `updateAlpCli` gated on the
  // setting being NON-EMPTY rather than existing, so the button answered
  // "alpSdk.cliPath is set …" with `openSettings → alpSdk.cliPath`: two clicks
  // from a verification refusal onto the one arm nothing verifies, which is the
  // button #389 removed.
  const home = migratingHome();
  const server = await releaseServer(GOOD);
  try {
    const config = {
      "alpSdk.cliPath": path.join(home.dir, "gone", "tan"), // never created
    };
    const { adapter, plans } = loadAdapter({
      onPath: true,
      releaseAsset: OFFLINE_ASSET,
      config,
    });
    await adapter.ensureTanCliProvisioned(home.context);
    assert.equal(
      (await adapter.resolveAlpBinaryForContext(home.context)).source,
      "path",
    );
    assert.equal(plans.length, 1);
    assert.equal(plans[0].message, SERVICE.CACHED_CLI_UNVERIFIED_ON_PATH);
    assert.ok(plans[0].actions.some((a) => a.id === "updateCli"));

    // FOLLOW THE BUTTON — the hop the old test never crossed, which is how the
    // dead end shipped: it inspected the plan's own `actions` and stopped. Both
    // links pinned from the compiled sources, then the destination is driven.
    const wiring = (file) =>
      fs.readFileSync(path.join(root, "out", file), "utf8");
    assert.match(
      wiring(path.join("notify", "vscodeAdapter.js")),
      /updateCli:[\s\S]{0,400}?executeCommand\("alp\.updateCli"\)/,
    );
    assert.match(
      wiring("extension.js"),
      /registerCommand\("alp\.updateCli",[\s\S]{0,160}?updateAlpCli/,
    );

    const { adapter: retry, plans: retryPlans } = loadAdapter({
      onPath: true,
      releaseAsset: server.asset,
      config,
    });
    await retry.updateAlpCli(home.context);

    // It DOWNLOADED, and nothing sent the customer to the unverified arm.
    assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
    assert.equal(home.store.get("alp.tanCachedBinarySha256"), sha256(GOOD));
    for (const plan of retryPlans) {
      assert.deepEqual(
        plan.actions.filter((a) => a.id === "openSettings"),
        [],
        "the retry routed back to alpSdk.cliPath",
      );
      assert.doesNotMatch(plan.message, /alpSdk\.cliPath/);
    }
    // …and the machine is healed: the cache outranks the PATH fallback again.
    const { adapter: next } = loadAdapter({
      onPath: true,
      releaseAsset: server.asset,
      config,
    });
    assert.equal(
      (await next.resolveAlpBinaryForContext(home.context)).source,
      "cached",
    );

    // The guard reds: a cliPath that DOES exist still refuses the download, and
    // says so — that refusal is true, because the ladder really would take it.
    const chosen = path.join(home.dir, "chosen-tan");
    fs.writeFileSync(chosen, GOOD);
    const { adapter: honest, plans: honestPlans } = loadAdapter({
      onPath: true,
      releaseAsset: server.asset,
      config: { "alpSdk.cliPath": chosen },
    });
    await honest.updateAlpCli(home.context);
    assert.equal(honestPlans.length, 1);
    assert.match(honestPlans[0].message, /alpSdk\.cliPath is set/);
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("#396 Retry pressed while STILL offline keeps the honest sentence, one hop along", async () => {
  // The route this branch created, followed one click further. Activation
  // raises "commands are falling back to the tan on your PATH, which nothing
  // here verified"; the user presses its only button while still offline, and
  // `updateAlpCli` worded the SAME refusal — same machine, same un-digested
  // cache, same PATH binary running — as "Downloading it once more settles this
  // for good", dropping the one fact activation had just corrected.
  //
  // `ensureTanCliProvisioned` passed `migrationCause` into `checksumFailurePlan`
  // and `updateAlpCli` did not. Not a routing hole; a wording regression.
  const home = migratingHome();
  try {
    const { adapter, plans } = loadAdapter({
      onPath: true,
      releaseAsset: OFFLINE_ASSET,
    });
    await adapter.ensureTanCliProvisioned(home.context);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].message, SERVICE.CACHED_CLI_UNVERIFIED_ON_PATH);

    const { adapter: retry, plans: retryPlans } = loadAdapter({
      onPath: true,
      releaseAsset: OFFLINE_ASSET,
    });
    await retry.updateAlpCli(home.context);
    assert.equal(retryPlans.length, 1);
    assert.equal(retryPlans[0].message, SERVICE.CACHED_CLI_UNVERIFIED_ON_PATH);
    assert.notEqual(
      retryPlans[0].message,
      SERVICE.CACHED_CLI_UNVERIFIED,
      "Retry reverted to the wording activation just corrected",
    );
    // Still offerable, and still nothing that routes onto an unverified arm.
    assert.ok(retryPlans[0].actions.some((a) => a.id === "updateCli"));
    assert.deepEqual(
      retryPlans[0].actions.filter((a) => a.id === "openSettings"),
      [],
    );

    // The guard reds: a DIGESTED cache is not this state at all, so
    // `unverifiedCacheCause` answers `undefined` and the failure keeps its OWN
    // sentence — here the checksum file that could not be fetched, which says
    // something the migration framing would bury. Make the substitution
    // unconditional and this row starts claiming a PATH fall-through to a
    // machine that is not falling through to anything.
    home.store.set("alp.tanCachedBinarySha256", sha256(TAMPERED));
    const { adapter: digested, plans: digestedPlans } = loadAdapter({
      onPath: true,
      releaseAsset: OFFLINE_ASSET,
    });
    await digested.updateAlpCli(home.context);
    assert.equal(digestedPlans.length, 1);
    assert.match(digestedPlans[0].message, /checksum file that vouches for it/);
    for (const sentence of [
      SERVICE.CACHED_CLI_UNVERIFIED,
      SERVICE.CACHED_CLI_UNVERIFIED_ON_PATH,
    ]) {
      assert.notEqual(digestedPlans[0].message, sentence);
    }
  } finally {
    home.cleanup();
  }
});

test("#396 nothing to heal: a fresh install and a localBuild developer are unchanged", async () => {
  // Each guard broken in turn. The trigger is `cachedExists &&
  // !cachedDigestRecorded`; drop either half and one of these starts fetching.

  // No cache at all, `tan` on PATH — a fresh install on a machine that already
  // has a global tan. Nothing is re-acquired.
  //
  // It is no longer SILENT, and that is #393 rather than a heal: this machine
  // is the rung-6 PATH fallback with no managed copy, so it gets exactly one
  // informational notice naming the binary it is running. What this row watches
  // survives that, because the fetch it forbids would be a SECOND plan —
  // OFFLINE_ASSET makes any fetch fail loudly. So the assertion is tightened to
  // the exact message list rather than relaxed to "no download plan": drop
  // either half of `isUnverifiableCache` from the trigger and a download failure
  // joins the notice here.
  const fresh = extensionHome();
  try {
    const { adapter, plans } = loadAdapter({
      onPath: true,
      releaseAsset: OFFLINE_ASSET,
    });
    await adapter.ensureTanCliProvisioned(fresh.context);
    assert.deepEqual(
      plans.map((plan) => plan.message),
      [SERVICE.UNVERIFIED_PATH_IN_USE],
      "a fresh install with a PATH tan was made to fetch",
    );
    assert.equal(fs.existsSync(fresh.cachedBinaryPath), false);
    assert.equal(
      (await adapter.resolveAlpBinaryForContext(fresh.context)).source,
      "path",
    );
  } finally {
    fresh.cleanup();
  }

  // A developer running from a source checkout with a sibling `tan-cli` build
  // and no cache: `localBuild` resolves, and it is theirs, not ours.
  const dev = extensionHome();
  try {
    const localBuild = path.join(dev.dir, "tan-cli", "target", "release");
    fs.mkdirSync(localBuild, { recursive: true });
    fs.writeFileSync(path.join(localBuild, BINARY), GOOD);
    const { adapter, plans } = loadAdapter({ releaseAsset: OFFLINE_ASSET });
    await adapter.ensureTanCliProvisioned(dev.context);
    assert.deepEqual(plans, [], "a localBuild developer was disturbed");
    assert.equal(fs.existsSync(dev.cachedBinaryPath), false);
    assert.equal(
      (await adapter.resolveAlpBinaryForContext(dev.context)).source,
      "localBuild",
    );
  } finally {
    dev.cleanup();
  }
});

test("wiring: `alp.updateCli` records the digest, so the remedy the mismatch names actually ends", async () => {
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    home.writeCachedBinary(TAMPERED);
    // A record that matches neither what is on disk nor what will be
    // downloaded — otherwise a `recordCachedDigest` that writes NOTHING leaves
    // the right value behind by luck and this test proves nothing.
    home.store.set("alp.tanCachedBinarySha256", sha256("an older binary\n"));
    const { adapter } = loadAdapter({ releaseAsset: server.asset });

    // What the customer is looking at, and `CACHED_CLI_MISMATCH` names exactly
    // one escape from it: reinstall the pinned CLI from the command palette.
    await assert.rejects(
      () => adapter.resolveAlpBinaryForContext(home.context),
      { name: "ChecksumError", message: SERVICE.CACHED_CLI_MISMATCH },
    );

    await adapter.updateAlpCli(home.context);

    assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
    assert.equal(
      home.store.get("alp.tanCachedBinarySha256"),
      sha256(GOOD),
      "the reinstall did not record the digest it verified",
    );
    // The point of the record: the NEXT resolution reaches a verified cache.
    // With the write neutered the reinstall downloads a good binary, records
    // nothing, and every later resolution refuses again on the stale record —
    // fail-closed, but the one documented way out is bricked.
    const { adapter: next } = loadAdapter({ releaseAsset: server.asset });
    assert.deepEqual(await next.resolveAlpBinaryForContext(home.context), {
      command: home.cachedBinaryPath,
      source: "cached",
    });
  } finally {
    await server.close();
    home.cleanup();
  }
});

test("#396 preferGlobalCli ON still reaches unverifiedCacheCause through the PALETTE, and gets the plain sentence there", async () => {
  // The coverage gap review found. `shouldFetchManagedCli` excludes rung 2, so
  // ACTIVATION never raises anything for a `preferGlobalCli` user — proved by
  // the test above. But `updateAlpCli`'s catch calls `unverifiedCacheCause`
  // UNCONDITIONALLY, so the palette command "Alp: Reinstall the pinned tan CLI"
  // reaches it with the flag on.
  //
  // That is correct and deliberate: the user asked for a reinstall, so a
  // refusal owes them a reason. It must be the PLAIN sentence, not the ON_PATH
  // one — "commands are falling back to the tan on your PATH" would be telling
  // a rung-2 user their own explicit choice is a fallback.
  //
  // Without this, mutating `!input.preferGlobalCli` inside `unverifiedCacheCause`
  // reddens only a pure test, and nothing proves the adapter route behaves.
  const home = migratingHome();
  try {
    const { adapter, plans } = loadAdapter({
      onPath: true,
      config: { "alpSdk.preferGlobalCli": true },
      releaseAsset: OFFLINE_ASSET,
    });
    await adapter.updateAlpCli(home.context);

    assert.equal(plans.length, 1);
    assert.equal(plans[0].message, SERVICE.CACHED_CLI_UNVERIFIED);
    assert.notEqual(
      plans[0].message,
      SERVICE.CACHED_CLI_UNVERIFIED_ON_PATH,
      "a rung-2 user was told their own explicit choice is a fallback",
    );
    assert.deepEqual(
      plans[0].actions.filter((a) => a.id === "openSettings"),
      [],
    );
  } finally {
    home.cleanup();
  }
});

test("#445 the palette's update command on a host this release has no asset for explains it, and offers no dead Retry", async () => {
  // The ONE route that reaches `downloadCli` without an `!asset` early return:
  // `ensureTanCliProvisioned` checks the asset itself and returns, so the
  // palette command is where a host with no published binary actually hits the
  // resolver's throw. It used to land on the generic "The tan CLI update
  // failed." with a Retry — a button that re-enters the same download and
  // throws on the same absent asset, forever, while the sentence naming the
  // host and the release sat in the output channel.
  //
  // Driven with `releaseAssetForTarget` stubbed to null because that is the
  // state BOTH shapes of "no asset" reduce to: a host absent from TARGETS, and
  // a host the pinned release publishes nothing for
  // (`HOSTS_WITHOUT_RELEASE_ASSET`, empty until a Python tan is pinned).
  const home = extensionHome();
  try {
    const { adapter, plans } = loadAdapter({
      service: { releaseAssetForTarget: () => null },
    });
    await adapter.updateAlpCli(home.context);

    assert.equal(plans.length, 1);
    const [plan] = plans;
    // The customer sentence itself, not "The tan CLI update failed."
    assert.equal(
      plan.message,
      SERVICE.noPrebuiltMessage(process.platform, process.arch),
    );
    assert.match(plan.message, new RegExp(`${process.platform}/`));
    assert.match(plan.message, /rather than a broken install/);
    // The only remedy that can work here, and NOT a retry of a download that
    // this release can never satisfy.
    assert.deepEqual(
      plan.actions.map((a) => a.id),
      ["openSettings"],
    );
    assert.equal(plan.actions[0].arg, "alpSdk.cliPath");
    // Nothing was written: no cache, no digest record, no half-installed file.
    assert.equal(fs.existsSync(home.cachedBinaryPath), false);
    assert.equal(home.store.has("alp.tanCachedBinarySha256"), false);
  } finally {
    home.cleanup();
  }
});
