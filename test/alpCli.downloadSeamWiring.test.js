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
// test can load it. That is false — four test files on this branch already load
// `out/alpCli/vscodeAdapter.js` behind a `Module._load` stub, two of them added
// on this branch, and one of them (alpCli.spawnProxyEnv.test.js) states this
// exact threat model for the `env` one-token edit in the same function.
//
// So: capture the deps object `resolveAlpBinaryForContext` actually builds, and
// drive its `download` against a release server that serves a tampered body
// with a correct manifest. The seam must refuse and leave nothing behind.

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

/** Load a fresh copy of the real adapter and hand back the `ResolveDeps` that
 *  `resolveAlpBinaryForContext` builds — the object the shipped extension
 *  actually uses, not one assembled by this test. */
function captureResolveDeps() {
  delete require.cache[ADAPTER];
  let captured = null;
  const stubs = {
    vscode: {
      Uri: { file: (p) => ({ fsPath: p }) },
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      },
      window: { showErrorMessage: async () => undefined },
    },
    child_process: {
      spawn: () => ({
        stdout: { setEncoding() {}, on() {} },
        stderr: { setEncoding() {}, on() {} },
        kill() {},
        on() {},
      }),
      spawnSync: () => ({ status: 1, stdout: "", stderr: "" }),
      execFile: () => {},
    },
    "./adapterCore": {
      ...REAL_ADAPTER_CORE,
      // The one seam replaced. Everything upstream of it — including
      // `buildResolveDeps`, the function under test — is the real one.
      resolveAlpBinary: async (deps) => {
        captured = deps;
        return { command: "tan", source: "cached" };
      },
    },
    "../notify/vscodeAdapter": {
      notify: async () => undefined,
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
  return { adapter, deps: () => captured };
}

const fakeContext = (dir) => ({
  globalStorageUri: { fsPath: dir },
  extensionPath: path.join(dir, "ext"),
  globalState: { get: () => undefined, update: async () => undefined },
  subscriptions: [],
});

test("the download seam the adapter injects REFUSES a tampered binary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-seam-wiring-"));
  const server = await releaseServer(TAMPERED_BODY);
  try {
    const { adapter, deps } = captureResolveDeps();
    await adapter.resolveAlpBinaryForContext(fakeContext(dir));

    const injected = deps();
    assert.ok(injected, "resolveAlpBinary was never called with a deps object");
    assert.equal(typeof injected.download, "function");

    const dest = path.join(dir, "tan");
    await assert.rejects(
      // The 4th argument is the checksum spec `downloadCli` passes. A seam that
      // ignores it — by taking three parameters, or by hard-coding `null` —
      // resolves here instead of rejecting, and that is the whole point.
      () => injected.download(server.assetUrl, dest, undefined, server.spec),
      /checksum/i,
      "the injected seam accepted bytes that do not match the published digest",
    );
    assert.equal(
      fs.existsSync(dest),
      false,
      "a refused download left a binary at the cached path",
    );
    assert.deepEqual(
      fs.readdirSync(dir).filter((entry) => entry.startsWith("tan")),
      [],
      "a refused download left a temp file behind",
    );
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the same seam ACCEPTS the published bytes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-seam-wiring-ok-"));
  const server = await releaseServer(REAL_BODY);
  try {
    const { adapter, deps } = captureResolveDeps();
    await adapter.resolveAlpBinaryForContext(fakeContext(dir));

    const dest = path.join(dir, "tan");
    await deps().download(server.assetUrl, dest, undefined, server.spec);
    assert.equal(fs.readFileSync(dest, "utf8"), REAL_BODY);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
