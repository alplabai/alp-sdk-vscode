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
function loadAdapter({ onPath = false, releaseAsset, service, transfer } = {}) {
  const spawned = [];
  const versionProbes = [];
  const terminals = [];
  const plans = [];
  const nativeVersion = `tan ${SERVICE.SUPPORTED_CLI_VERSION}\n`;

  const stubs = {
    vscode: {
      Uri: { file: (p) => ({ fsPath: p }) },
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
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
    const { adapter, plans } = loadAdapter({ releaseAsset: server.asset });

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
    const { adapter } = loadAdapter({ releaseAsset: server.asset });

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
