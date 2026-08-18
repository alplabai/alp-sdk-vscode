// SPDX-License-Identifier: Apache-2.0
//
// #393: the ladder's RUNG-6 `path` fallback says, once, that the binary being
// run is the one the shell resolves and is not one this extension verified.
//
// The population is the residual one #396 left behind, and it is not a
// migration: a machine with a global `tan` and NO managed copy never acquires a
// verified binary at all. That is the steady state for anyone who has ever run
// the "Install tan CLI (global)" button — which itself downloads a release asset
// with no checksum (`media/tan-install/install.{sh,ps1}`, vendored from tan's
// own installer; filed upstream as alplabai/tan-cli#176).
//
// WHAT IS DRIVEN, and why through the REAL adapter rather than the pure rule:
// the pure test next door proves the decision, and proves nothing about the
// rung the shipped extension actually lands on, whether a toast is raised, what
// its button does, or whether the record survives a second activation. Every
// row below therefore runs real `decideBinarySource` against real files on
// disk, with only the host seams stubbed.
//
// THE CONSTRAINT THIS FILE EXISTS TO HOLD: `alpSdk.preferGlobalCli` (rung 2)
// must keep winning SILENTLY — no toast, no log nag, no fetch. #396 shipped the
// near-miss at this same rung: its `!preferGlobalCli` gate withheld the SENTENCE
// but not the FETCH, so an opted-in user got a recurring error about a copy they
// had opted out of running, plus a ~3 MB download resolution then ignored. Every
// silent row below is measured with an OFFLINE asset for that reason: any fetch
// at all hits a refused port and surfaces as a plan, so an empty `plans` array
// is a real assertion and not an absence of one.
//
// NO NETWORK. The one row that downloads is served from 127.0.0.1.

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
const DOWNLOAD = require(path.join(root, "out", "alpCli", "download.js"));

const BINARY = process.platform === "win32" ? "tan.exe" : "tan";
const GOOD = "the real tan binary\n";
const sha256 = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");
/** #464: the recorded digest now covers the installed TREE (`sha256Tree` in
 *  vscodeAdapter.ts), not the launcher's content alone — mirrors that exact
 *  formula so a seeded/asserted `globalState` record matches what the
 *  shipped code actually computes. Every row here writes ONLY the launcher
 *  (no `_internal/`), so the tree is always the single entry `BINARY`. */
const treeDigest = (content) => sha256(`${BINARY}\0${sha256(content)}\n`);

/** globalState key the adapter marks once the notice has been shown. */
const PATH_NOTICED_KEY = "alp.tanUnverifiedPathNoticed";

/** A `ReleaseAsset`-shaped fixture (#463: two candidates, not one flat
 *  `assetName`/`url`) whose raw candidate is `BINARY` at `base`. */
function testAsset(base, { target = "test-target", tag = "v0.0.0-test" } = {}) {
  return {
    target,
    tag,
    checksumsUrl: `${base}/checksums.txt`,
    candidates: [
      { assetName: BINARY, url: `${base}/${BINARY}` },
      {
        assetName: `${BINARY}.archive-unused`,
        url: `${base}/${BINARY}.archive-unused`,
      },
    ],
  };
}

/** A release that publishes nothing reachable: port 1 on loopback is refused
 *  immediately, so a fetch is instant, offline, and LOUD (it raises a plan). */
const OFFLINE_ASSET = testAsset("http://127.0.0.1:1");

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
    asset: testAsset(base),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** A real-on-disk extension home: temp globalStorage + extensionPath, and a
 *  `globalState` over a Map so the notice's record is written and read back the
 *  way VS Code would — which is what makes "once per INSTALL, not per window"
 *  testable at all. */
function extensionHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-path-notice-"));
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
    /** A file at `segments` under the home, created with its parents. */
    write(body, ...segments) {
      const file = path.join(dir, ...segments);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      return file;
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
 * One activation: a FRESH copy of the real `vscodeAdapter` (fresh module state,
 * so the per-window resolution memo does not leak between rows), keeping the
 * REAL `adapterCore`, `service`, `download` and `fs`. Only host seams are
 * stubbed, plus `releaseAssetForTarget` so a fetch can be pointed at loopback.
 */
function loadAdapter({ onPath = false, releaseAsset, config = {} } = {}) {
  const plans = [];
  const logLines = [];
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
      // `commandOnPath` goes through this: a native version line is what makes
      // the PATH rung reachable at all.
      spawnSync: () =>
        onPath
          ? { status: 0, stdout: nativeVersion, stderr: "" }
          : { status: 1, stdout: "", stderr: "" },
      spawn: () => {
        throw new Error("nothing here should run an envelope command");
      },
      execFile: (command, args, _options, callback) => {
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
    "../util": { log: (line) => logLines.push(line), runInTerminal: () => {} },
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
  // `adapterCore` is reloaded too, so a stubbed `./service` reaches the resolver
  // rather than the cached real module.
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
  return { adapter, plans, logLines };
}

test("rung 6: the PATH fallback is told once, as a note rather than a failure", async () => {
  const home = extensionHome();
  try {
    // Nothing managed anywhere — no cache, no bundle, no local build, no
    // cliPath — and a verified-native `tan` on PATH. This is row C.
    const { adapter, plans, logLines } = loadAdapter({
      onPath: true,
      releaseAsset: OFFLINE_ASSET,
    });
    await adapter.ensureTanCliProvisioned(home.context);

    // Real resolution really is on the fallback rung, and stays there: the
    // notice must not change what runs.
    assert.equal(
      (await adapter.resolveAlpBinaryForContext(home.context)).source,
      "path",
    );
    assert.equal(
      fs.existsSync(home.cachedBinaryPath),
      false,
      "the notice demoted the customer onto a download they never asked for",
    );

    assert.equal(plans.length, 1, "the fallback rung said nothing");
    const [plan] = plans;
    assert.equal(plan.message, SERVICE.UNVERIFIED_PATH_IN_USE);
    // INFO. Nothing failed, so an error/warning toast would send the customer
    // hunting for a break that is not there — and `planFailure` demoting the
    // sentence into the channel would replace it with "… failed.", which would
    // be a lie as well as a loss.
    assert.equal(plan.severity, "info");
    assert.equal(plan.channel, "toast");
    // The offer, and only the offer. `alpSdk.cliPath` is the one arm with no
    // checksum path at all (#389), and "Install tan CLI (global)" would install
    // another unverified PATH binary — the very state being reported.
    assert.deepEqual(plan.actions, [
      { id: "updateCli", title: "Use the managed copy" },
    ]);
    for (const id of ["openSettings", "installTanCli"]) {
      assert.deepEqual(
        plan.actions.filter((a) => a.id === id),
        [],
        `the notice offered ${id}`,
      );
    }
    // The channel line carries the rung, so a support thread can tell which of
    // the two `path` rungs this was.
    assert.ok(
      logLines.some((line) => line.includes("rung-6")),
      "the silence-vs-notice decision is unexplainable in the channel",
    );
    assert.equal(home.store.get(PATH_NOTICED_KEY), true);

    // A SECOND ACTIVATION — a fresh window sharing the same globalState. The
    // state being reported is permanent, so without the persisted record this
    // is a toast on every window forever.
    const { adapter: again, plans: againPlans } = loadAdapter({
      onPath: true,
      releaseAsset: OFFLINE_ASSET,
    });
    await again.ensureTanCliProvisioned(home.context);
    assert.deepEqual(againPlans, [], "the notice repeated on a second window");
    assert.equal(
      (await again.resolveAlpBinaryForContext(home.context)).source,
      "path",
    );
  } finally {
    home.cleanup();
  }
});

test("rung 2 (preferGlobalCli) is left ENTIRELY alone: no toast, no log nag, no fetch", async () => {
  // The constraint that has already been got wrong once at this rung. Three
  // activations, because "every window" is the complaint; OFFLINE_ASSET is the
  // measurement, since any fetch would surface as a plan.
  const home = extensionHome();
  const config = { "alpSdk.preferGlobalCli": true };
  try {
    for (let activation = 1; activation <= 3; activation++) {
      const { adapter, plans, logLines } = loadAdapter({
        onPath: true,
        releaseAsset: OFFLINE_ASSET,
        config,
      });
      await adapter.ensureTanCliProvisioned(home.context);
      assert.deepEqual(
        plans,
        [],
        `an opted-in user was disturbed on activation ${activation}`,
      );
      assert.deepEqual(
        logLines.filter((line) => line.includes("rung-6")),
        [],
        "rung 2 was logged as the unchosen fallback",
      );
      assert.equal(
        (await adapter.resolveAlpBinaryForContext(home.context)).source,
        "path",
      );
    }
    // Nothing fetched, and nothing recorded either — a marker written here
    // would silence the notice for this machine if the flag were ever cleared.
    assert.equal(fs.existsSync(home.cachedBinaryPath), false);
    assert.equal(home.store.has(PATH_NOTICED_KEY), false);

    // …and the guard reds: clear the flag and the SAME machine is rung 6, so it
    // is told. Drop `!preferGlobalCli` from the rule and the loop above starts
    // raising plans; drop the rule entirely and this row stops being reached.
    const { adapter: off, plans: offPlans } = loadAdapter({
      onPath: true,
      releaseAsset: OFFLINE_ASSET,
    });
    await off.ensureTanCliProvisioned(home.context);
    assert.equal(offPlans.length, 1);
    assert.equal(offPlans[0].message, SERVICE.UNVERIFIED_PATH_IN_USE);
  } finally {
    home.cleanup();
  }
});

test("every other arm is silent: cliPath, localBuild, bundled, cached, download", async () => {
  // Each population resolves something that is NOT the rung-6 fallback, with a
  // verified-native `tan` on PATH underneath it in every case — so a rule that
  // keyed on `onPath` instead of the resolved rung would light all five up.
  const populations = {
    cliPath: (home) => ({
      config: { "alpSdk.cliPath": home.write(GOOD, "chosen-tan") },
      onPath: true,
    }),
    localBuild: (home) => {
      home.write(GOOD, "tan-cli", "python", "dist", "tan", BINARY);
      return { onPath: true };
    },
    bundled: (home) => {
      home.write(GOOD, "ext", "bin", BINARY);
      return { onPath: true };
    },
    cached: (home) => {
      home.store.set("alp.tanCachedBinarySha256", treeDigest(GOOD));
      home.writeCachedBinary(GOOD);
      return { onPath: true };
    },
    // No PATH `tan` and nothing managed: the ladder falls off the end. There is
    // no binary to say anything about yet, and the fetch below is the ordinary
    // first-install download (offline here, so it raises its own plan — which
    // is precisely why this row asserts on the NOTICE and not on `plans`).
    download: () => ({ onPath: false }),
  };

  for (const [source, setup] of Object.entries(populations)) {
    const home = extensionHome();
    try {
      const extra = setup(home);
      const { adapter, plans } = loadAdapter({
        releaseAsset: OFFLINE_ASSET,
        ...extra,
      });
      await adapter.ensureTanCliProvisioned(home.context);
      if (source === "download") {
        // Resolving on this arm would FETCH — that IS the arm — so it is pinned
        // with the probe that must never fetch instead: `probeTanVersion`
        // returns null exactly when `decideBinarySource` answers `download`,
        // and a real version on every other arm.
        assert.equal(await adapter.probeTanVersion(home.context), null);
      } else {
        assert.equal(
          (await adapter.resolveAlpBinaryForContext(home.context)).source,
          source,
        );
        assert.equal(
          await adapter.probeTanVersion(home.context),
          SERVICE.SUPPORTED_CLI_VERSION,
        );
      }
      assert.deepEqual(
        plans.filter((p) => p.message === SERVICE.UNVERIFIED_PATH_IN_USE),
        [],
        `${source} was told it is running an unverified PATH binary`,
      );
      assert.equal(
        home.store.has(PATH_NOTICED_KEY),
        false,
        `${source} recorded a notice it never showed`,
      );
    } finally {
      home.cleanup();
    }
  }
});

test("the migrating machine keeps #396's sentence, and is not told twice", async () => {
  // An UN-DIGESTED cache with a global `tan`: rung 6 by `decideBinarySource`,
  // but #396 owns it. Activation re-acquires that cache through the verified
  // channel, so the PATH binary is not what this machine goes on running — and
  // when the re-acquire fails (offline, here), CACHED_CLI_UNVERIFIED_ON_PATH
  // already says what this notice would say, plus the fact that a verified copy
  // is one reconnection away. Two notices, one of them about to be false, is
  // worse than either alone.
  const home = extensionHome();
  try {
    home.writeCachedBinary(GOOD); // present, nothing recorded for it
    const { adapter, plans } = loadAdapter({
      onPath: true,
      releaseAsset: OFFLINE_ASSET,
    });
    await adapter.ensureTanCliProvisioned(home.context);

    assert.equal(plans.length, 1, "the migrating machine was told twice");
    assert.equal(plans[0].message, SERVICE.CACHED_CLI_UNVERIFIED_ON_PATH);
    assert.equal(home.store.has(PATH_NOTICED_KEY), false);

    // The guard reds: heal it (record a digest for what is on disk) and the
    // cache outranks the fallback, so this machine leaves both populations.
    home.store.set("alp.tanCachedBinarySha256", treeDigest(GOOD));
    const { adapter: healed, plans: healedPlans } = loadAdapter({
      onPath: true,
      releaseAsset: OFFLINE_ASSET,
    });
    await healed.ensureTanCliProvisioned(home.context);
    assert.deepEqual(healedPlans, []);
    assert.equal(
      (await healed.resolveAlpBinaryForContext(home.context)).source,
      "cached",
    );
  } finally {
    home.cleanup();
  }
});

test("the notice's button ends the state it reports", async () => {
  // FOLLOW THE BUTTON. "Use the managed copy" is a promise about what happens
  // next, and a promise the ladder has to keep: `alp.updateCli` downloads the
  // pinned binary into the extension's own storage, and with `preferGlobalCli`
  // off a digested `cached` copy outranks the rung-6 fallback. If it did not,
  // the notice would be a dead end dressed as a remedy.
  const home = extensionHome();
  const server = await releaseServer(GOOD);
  try {
    const { adapter, plans } = loadAdapter({
      onPath: true,
      releaseAsset: server.asset,
    });
    await adapter.ensureTanCliProvisioned(home.context);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].message, SERVICE.UNVERIFIED_PATH_IN_USE);
    assert.equal(plans[0].actions[0].id, "updateCli");

    // Both links pinned from the compiled sources — the button's id has to
    // reach the command, and the command has to reach `updateAlpCli` — then the
    // destination is DRIVEN. Asserting the plan's own `actions` and stopping is
    // how a dead button ships (#396's Retry).
    const wiring = (file) => fs.readFileSync(path.join(root, "out", file), "utf8"); // prettier-ignore
    assert.match(
      wiring(path.join("notify", "vscodeAdapter.js")),
      /updateCli:[\s\S]{0,400}?executeCommand\("alp\.updateCli"\)/,
    );
    assert.match(
      wiring("extension.js"),
      /registerCommand\("alp\.updateCli",[\s\S]{0,160}?updateAlpCli/,
    );

    const { adapter: pressed } = loadAdapter({
      onPath: true,
      releaseAsset: server.asset,
    });
    await pressed.updateAlpCli(home.context);
    assert.equal(fs.readFileSync(home.cachedBinaryPath, "utf8"), GOOD);
    assert.equal(home.store.get("alp.tanCachedBinarySha256"), treeDigest(GOOD));

    // The next window runs the verified copy, and says nothing further.
    const { adapter: next, plans: nextPlans } = loadAdapter({
      onPath: true,
      releaseAsset: server.asset,
    });
    await next.ensureTanCliProvisioned(home.context);
    assert.deepEqual(nextPlans, []);
    assert.equal(
      (await next.resolveAlpBinaryForContext(home.context)).source,
      "cached",
    );
  } finally {
    await server.close();
    home.cleanup();
  }
});
