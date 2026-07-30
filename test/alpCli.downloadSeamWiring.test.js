// SPDX-License-Identifier: Apache-2.0
//
// The WIRING half of the checksum fix: that the `download` seam
// `buildResolveDeps` actually injects is one that VERIFIES.
//
// Why this file exists as well as the `downloadSeam` tests in
// alpCli.downloadChecksum.test.js: `downloadSeam` can be perfect and the fix
// still be entirely absent from the shipped extension. `downloadFile`'s
// signature stops an arrow from reaching the transfer WITHOUT SAYING what it
// wants — `downloadFile(url, dest, signal, proxySettings())` is TS2345 and
// omitting the argument is TS2554 — but it cannot stop an arrow from saying
// `null`:
//
//   download: (url, dest, signal) =>
//     downloadFile(url, dest, null, { signal, proxy: proxySettings() }),
//
// That compiles, typechecks, passes prettier, and ships arbitrary bytes to
// `cachedBinaryPath` where `resolveAlpBinary`'s `"cached"` source spawns them
// without asking again. Reviewed twice, and each time the reason given for
// having no test here was that `vscodeAdapter.ts` imports `vscode` and no unit
// test can load it. That is false — `alpCli.aheadWarning.test.js`,
// `alpCli.checksumRefusal.test.js` and `alpCli.spawnProxyEnv.test.js` all load
// `out/alpCli/vscodeAdapter.js` behind a `Module._load` stub, the last two added
// on this branch, and `alpCli.spawnProxyEnv.test.js` states this exact threat
// model for the `env` one-token edit in the same function.
//
// THREE routes are covered, because `buildResolveDeps` returns a plain object
// and every caller can spread-override it after the fact:
//
//   const deps = { ...buildResolveDeps(context), download: <the null arrow> };
//
// The first version of this file watched only `resolveAlpBinary` and missed
// both DIRECT `downloadCli` callers — `ensureTanCliProvisioned` and
// `updateAlpCli`, the "Update the tan CLI" command. That override shipped a
// payload to disk with the full suite green, which is how this file came to
// exist in its current shape.
//
// So the routes are enumerated in ROUTES below and each is driven for real. Two
// capture points are needed and neither is redundant: `downloadCli` catches the
// direct callers, and `resolveAlpBinary` catches its own arm — because
// `resolveAlpBinary` calls `downloadCli` as a module-internal reference, which
// stubbing the export cannot intercept.
//
// For each route: take the deps that route actually built, drive its `download`
// against a release server serving a tampered body under a correct manifest,
// and require a refusal that leaves nothing behind.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const ADAPTER = require.resolve(
  path.join(root, "out", "alpCli", "vscodeAdapter.js"),
);
const REAL_ADAPTER_CORE = require(
  path.join(root, "out", "alpCli", "adapterCore.js"),
);

const REAL_BODY = "the real tan binary\n";
const TAMPERED_BODY = "NOT what Alp Lab published\n";
const ASSET_NAME = "tan-x86_64-unknown-linux-gnu";

/** A release server that serves `body` as the asset while its `checksums.txt`
 *  still vouches for REAL_BODY — i.e. exactly the substitution the digest
 *  exists to catch. */
async function releaseServer(body) {
  const digest = crypto.createHash("sha256").update(REAL_BODY).digest("hex");
  const server = http.createServer((req, res) => {
    if (req.url === "/checksums.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`${digest}  ${ASSET_NAME}\n`);
      return;
    }
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    assetUrl: `${base}/${ASSET_NAME}`,
    spec: { assetName: ASSET_NAME, checksumsUrl: `${base}/checksums.txt` },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Load a fresh copy of the real adapter, capturing every `ResolveDeps` that
 *  reaches `downloadCli` — the objects the shipped extension actually uses, not
 *  ones assembled by this test. */
function loadAdapterCapturingDownloadCli() {
  delete require.cache[ADAPTER];
  const captured = [];
  const stubs = {
    vscode: {
      Uri: { file: (p) => ({ fsPath: p }) },
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      },
      window: {
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined,
        // Run the task body directly; the progress UI is not what is under test.
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
        on() {},
      }),
      // status 1 = nothing named `tan` resolves on PATH, so the resolution
      // ladder reaches its `download` arm rather than short-circuiting.
      spawnSync: () => ({ status: 1, stdout: "", stderr: "" }),
      execFile: () => {},
    },
    "./adapterCore": {
      ...REAL_ADAPTER_CORE,
      // BOTH entry points into a transfer are captured, and it has to be both.
      //
      // `downloadCli` is the choke point for the two DIRECT callers in
      // `vscodeAdapter.ts` — `ensureTanCliProvisioned` and `updateAlpCli` —
      // which is what a `resolveAlpBinary`-only capture missed.
      //
      // It cannot cover the third route: `resolveAlpBinary` calls `downloadCli`
      // as a module-internal reference, so replacing the EXPORT does not
      // intercept it (leave it out and that route quietly attempts a real
      // github.com download instead of failing — a ~2.4 s tell, and a test that
      // would then be asserting nothing about the seam). So that route is
      // captured at `resolveAlpBinary` instead.
      //
      // Everything upstream of both — `buildResolveDeps`, and any caller's
      // spread over its result — is the real thing.
      downloadCli: async (deps) => {
        captured.push(deps);
      },
      resolveAlpBinary: async (deps) => {
        captured.push(deps);
        return { command: "tan", source: "cached" };
      },
    },
    "../notify/vscodeAdapter": {
      // `ensureTanCliProvisioned`'s fresh-install consent gate awaits this
      // for exactly one plan (the confirm dialog) before it ever reaches
      // `downloadCli`. Answering with the dialog's own (sole) action
      // simulates the user clicking through — this file is about the
      // download SEAM, not consent, so it must not be blocked by a stub
      // that always declines.
      notify: async (plan) => plan.actions[0]?.id,
      notifyAsync() {},
    },
    "../util": { log() {}, runInTerminal() {} },
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
  return { adapter, captured };
}

/** Drive one captured `download` against a tampered release and require it to
 *  refuse, leaving neither a binary nor a temp file behind. */
async function assertSeamRefuses(download, where) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-seam-drive-"));
  const server = await releaseServer(TAMPERED_BODY);
  try {
    const dest = path.join(dir, "tan");
    await assert.rejects(
      // The 4th argument is the checksum spec `downloadCli` passes. A seam that
      // ignores it — three parameters, a hard-coded `null`, a cast — resolves
      // here instead of rejecting, and that is the whole point.
      () => download(server.assetUrl, dest, undefined, server.spec),
      /checksum/i,
      `${where}: the injected seam accepted bytes that do not match the published digest`,
    );
    assert.equal(
      fs.existsSync(dest),
      false,
      `${where}: a refused download left a binary at the cached path`,
    );
    assert.deepEqual(
      fs.readdirSync(dir).filter((entry) => entry.startsWith("tan")),
      [],
      `${where}: a refused download left a temp file behind`,
    );
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const fakeContext = (dir) => ({
  globalStorageUri: { fsPath: dir },
  extensionPath: path.join(dir, "ext"),
  globalState: { get: () => undefined, update: async () => undefined },
  subscriptions: [],
});

// Each entry point that can build a `ResolveDeps` and hand it to a transfer.
// `resolveAlpBinaryForContext` throws after the stubbed `downloadCli` returns
// without producing a binary — expected, and irrelevant: the deps object was
// already captured by then.
const ROUTES = [
  {
    name: "resolveAlpBinaryForContext",
    run: (adapter, context) => adapter.resolveAlpBinaryForContext(context),
  },
  {
    name: "ensureTanCliProvisioned",
    run: (adapter, context) => adapter.ensureTanCliProvisioned(context),
  },
  {
    name: "updateAlpCli",
    run: (adapter, context) => adapter.updateAlpCli(context),
  },
];

for (const route of ROUTES) {
  test(`${route.name}: the download seam it builds REFUSES a tampered binary`, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "alp-seam-wiring-"));
    try {
      const { adapter, captured } = loadAdapterCapturingDownloadCli();
      await route.run(adapter, fakeContext(home));

      assert.ok(
        captured.length > 0,
        `${route.name} never reached downloadCli — the route changed, so this ` +
          "guard is no longer watching it",
      );
      for (const deps of captured) {
        assert.equal(typeof deps.download, "function");
        await assertSeamRefuses(deps.download, route.name);
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
}

test("the same seam ACCEPTS the published bytes", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "alp-seam-wiring-ok-"));
  const server = await releaseServer(REAL_BODY);
  try {
    const { adapter, captured } = loadAdapterCapturingDownloadCli();
    await adapter
      .resolveAlpBinaryForContext(fakeContext(home))
      .catch(() => undefined);
    assert.ok(captured.length > 0, "no deps captured");

    const dest = path.join(home, "tan");
    await captured[0].download(server.assetUrl, dest, undefined, server.spec);
    assert.equal(fs.readFileSync(dest, "utf8"), REAL_BODY);
  } finally {
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
