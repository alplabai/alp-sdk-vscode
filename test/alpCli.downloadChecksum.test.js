// SPDX-License-Identifier: Apache-2.0
//
// checksums.txt verification for the managed `tan` download (#378), driven
// through the REAL `downloadFile` against a local release server.
//
// Why this file exists: the extension downloads a binary from a GitHub release
// and then EXECUTES it. "The transfer completed" was the only bar it had to
// clear — a byte count and a `content-length`, both of which a substituted
// binary satisfies perfectly. So the load-bearing test here is the MUTATED one:
// an assertion that a correct digest passes would still pass with the
// comparison deleted, and would prove nothing at all.
//
// The three refusals are asserted to read DIFFERENTLY on purpose, the same
// discipline `scripts/fetch-tan-contract.mjs` was written with: a customer who
// cannot tell "the bytes were wrong" from "we could not find out whether they
// were" has no idea what to do next.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ChecksumError,
  downloadFile,
  downloadSeam,
} = require("../out/alpCli/download.js");
// The real planner the adapter feeds this rejection to. Imported (not mimicked)
// so "the customer reads this sentence" is asserted by the code that decides
// it — `planFailure` demotes a `cause` carrying an errno or an absolute path
// into the output channel and toasts a generic "<operation> failed." instead.
const { planFailure } = require("../out/notify/service.js");

/** The exact asset name for one of the eight targets tan-cli publishes. */
const ASSET_NAME = "tan-x86_64-unknown-linux-musl";

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** Start a server on 127.0.0.1:0, run `fn(baseUrl)`, and always close it after
 *  (so a rejected download never leaves a listening handle around). */
async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function tmpDest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-sum-test-"));
  return { dir, dest: path.join(dir, "tan") };
}

/** The rejection itself, not just the fact of one — these tests assert on the
 *  type, the sentence and the channel-only detail. */
async function rejectionOf(promise) {
  return promise.then(
    () => undefined,
    (error) => error,
  );
}

/** A `checksums.txt` in the producer's exact format: `<64 hex>` + TWO spaces +
 *  filename + `\n`, byte-checked against the published tan v0.4.0 file. */
function manifestFor(entries) {
  return entries.map(([digest, name]) => `${digest}  ${name}\n`).join("");
}

/** Serve a release: the binary at `/asset`, the manifest at `/checksums.txt`. */
function serveRelease({ body, manifest = "", checksumsStatus = 200 }) {
  return (req, res) => {
    if (req.url === "/checksums.txt") {
      if (checksumsStatus !== 200) {
        res.writeHead(checksumsStatus);
        res.end("no manifest here");
        return;
      }
      res.writeHead(200, {
        "content-length": String(Buffer.byteLength(manifest)),
      });
      res.end(manifest);
      return;
    }
    res.writeHead(200, { "content-length": String(body.length) });
    res.end(body);
  };
}

const verifySpec = (baseUrl) => ({
  assetName: ASSET_NAME,
  checksumsUrl: `${baseUrl}/checksums.txt`,
});

const fetchAsset = (baseUrl, dest) =>
  downloadFile(`${baseUrl}/asset`, dest, verifySpec(baseUrl));

test("downloadFile: bytes matching the published digest install normally", async () => {
  const body = Buffer.from("the real tan binary\n");
  await withServer(
    serveRelease({
      body,
      manifest: manifestFor([
        [sha256(Buffer.from("another asset")), "envelope-contract.json"],
        [sha256(body), ASSET_NAME],
      ]),
    }),
    async (baseUrl) => {
      const { dir, dest } = tmpDest();
      await fetchAsset(baseUrl, dest);
      assert.deepEqual(fs.readFileSync(dest), body);
      assert.deepEqual(fs.readdirSync(dir), [path.basename(dest)]);
    },
  );
});

test("downloadFile: ONE mutated byte is REFUSED, and nothing is installed", async () => {
  const published = Buffer.from("the real tan binary\n");
  // Same length, one bit of one byte flipped: the transfer completes and
  // `content-length` agrees, so the digest is the ONLY thing that can catch it.
  const tampered = Buffer.from(published);
  tampered[4] ^= 0x01;
  assert.equal(tampered.length, published.length);
  assert.notDeepEqual(tampered, published);

  await withServer(
    serveRelease({
      body: tampered,
      manifest: manifestFor([[sha256(published), ASSET_NAME]]),
    }),
    async (baseUrl) => {
      const { dir, dest } = tmpDest();
      const rejection = await rejectionOf(fetchAsset(baseUrl, dest));
      assert.ok(rejection, "a mutated binary must NOT resolve successfully");
      assert.ok(
        rejection instanceof ChecksumError,
        `expected a ChecksumError, got ${rejection.name}: ${rejection.message}`,
      );
      assert.match(
        rejection.message,
        /does not match the checksum/,
        "the refusal has to SAY it was a checksum, not a network hiccup",
      );
      assert.doesNotMatch(
        rejection.message,
        /back online/,
        "a mismatch is not an outage and must never be worded like one",
      );
      // The assertion this whole change exists for: no unverified binary is
      // left at the destination, which is `cachedBinaryPath` in production —
      // where the resolver's "cached" source would spawn it on the very next
      // command without ever asking again.
      assert.ok(
        !fs.existsSync(dest),
        "the rejected binary must not be installed",
      );
      assert.deepEqual(
        fs.readdirSync(dir),
        [],
        "and no temp file survives either",
      );
      // Both digests are channel-only; neither may appear in the sentence.
      assert.match(rejection.detail, new RegExp(sha256(published)));
      assert.match(rejection.detail, new RegExp(sha256(tampered)));
      assert.doesNotMatch(rejection.message, /[0-9a-f]{64}/);
    },
  );
});

test("downloadFile: a refused download leaves an already-installed binary untouched", async () => {
  const published = Buffer.from("the real tan binary\n");
  await withServer(
    serveRelease({
      body: Buffer.from("a substituted tan binary\n"),
      manifest: manifestFor([[sha256(published), ASSET_NAME]]),
    }),
    async (baseUrl) => {
      const { dir, dest } = tmpDest();
      fs.writeFileSync(dest, "the previously verified tan binary");
      const rejection = await rejectionOf(fetchAsset(baseUrl, dest));
      assert.ok(rejection instanceof ChecksumError);
      // Verification runs BEFORE `moveAside`, so a working binary is never
      // renamed out from under the customer on account of bytes that got
      // rejected — they keep a CLI that works.
      assert.equal(
        fs.readFileSync(dest, "utf8"),
        "the previously verified tan binary",
      );
      assert.deepEqual(fs.readdirSync(dir), [path.basename(dest)]);
    },
  );
});

test("downloadFile: a checksums.txt that will not fetch is REFUSED", async () => {
  await withServer(
    serveRelease({
      body: Buffer.from("the real tan binary\n"),
      checksumsStatus: 404,
    }),
    async (baseUrl) => {
      const { dir, dest } = tmpDest();
      const rejection = await rejectionOf(fetchAsset(baseUrl, dest));
      assert.ok(
        rejection instanceof ChecksumError,
        "an unfetchable checksum file must not fail OPEN",
      );
      assert.match(rejection.message, /could not be fetched/);
      assert.ok(
        !fs.existsSync(dest),
        "an unverifiable binary is not installed",
      );
      assert.deepEqual(fs.readdirSync(dir), []);
      assert.match(
        rejection.detail,
        /404/,
        "the status belongs on the channel",
      );
    },
  );
});

test("downloadFile: a checksums.txt with no line for this asset is REFUSED", async () => {
  const body = Buffer.from("the real tan binary\n");
  await withServer(
    serveRelease({
      body,
      // Well-formed, and vouches for every asset EXCEPT the one being fetched.
      manifest: manifestFor([
        [sha256(body), "tan-aarch64-apple-darwin"],
        [sha256(body), "envelope-contract.json"],
      ]),
    }),
    async (baseUrl) => {
      const { dir, dest } = tmpDest();
      const rejection = await rejectionOf(fetchAsset(baseUrl, dest));
      assert.ok(
        rejection instanceof ChecksumError,
        "a digest for a DIFFERENT asset does not vouch for this one",
      );
      assert.match(rejection.message, /does not list this binary/);
      assert.ok(!fs.existsSync(dest));
      assert.deepEqual(fs.readdirSync(dir), []);
      assert.match(rejection.detail, new RegExp(ASSET_NAME));
    },
  );
});

test("downloadFile: the three refusals never read the same", async () => {
  const published = Buffer.from("the real tan binary\n");
  const messages = [];
  const collect = async (release) => {
    await withServer(serveRelease(release), async (baseUrl) => {
      const { dest } = tmpDest();
      const rejection = await rejectionOf(fetchAsset(baseUrl, dest));
      assert.ok(rejection instanceof ChecksumError, "all three must refuse");
      messages.push(rejection.message);
    });
  };

  // MISMATCH — the bytes are not what the producer published.
  await collect({
    body: Buffer.from("not the published bytes\n"),
    manifest: manifestFor([[sha256(published), ASSET_NAME]]),
  });
  // COULD NOT FETCH — a different fact, and not evidence about the bytes.
  await collect({ body: published, checksumsStatus: 500 });
  // NO ENTRY — the release does not vouch for the file it just served.
  await collect({
    body: published,
    manifest: manifestFor([[sha256(published), "tan-aarch64-apple-darwin"]]),
  });

  assert.equal(
    new Set(messages).size,
    3,
    `three different facts must produce three different sentences:\n${messages.join("\n")}`,
  );
});

test("downloadFile: the refusal reaches the TOAST; the digests stay on the channel", async () => {
  const published = Buffer.from("the real tan binary\n");
  await withServer(
    serveRelease({
      body: Buffer.from("substituted binary\n"),
      manifest: manifestFor([[sha256(published), ASSET_NAME]]),
    }),
    async (baseUrl) => {
      const { dest } = tmpDest();
      const rejection = await rejectionOf(fetchAsset(baseUrl, dest));
      // The end of the wire: exactly what `checksumFailurePlan` builds. If the
      // sentence does not survive `planFailure`, the customer reads "Updating
      // the tan CLI failed." and the fact that a binary was REFUSED is behind
      // a Show Output click — the defect this assertion pins shut.
      const plan = planFailure({
        operation: "Updating the tan CLI",
        cause: rejection.message,
        detail: rejection.detail,
        actions: [{ id: "updateCli", title: "Retry" }],
      });
      assert.equal(
        plan.message,
        rejection.message,
        "a refused binary must be stated in the toast, not buried in the channel",
      );
      assert.match(
        plan.detail,
        /[0-9a-f]{64}/,
        "the digests still reach the output channel",
      );
    },
  );
});

test("downloadSeam: the seam the extension actually injects REFUSES a tampered binary", async () => {
  // The seam `vscodeAdapter.ts` injects, exercised end to end. It is a named
  // export rather than an inline arrow because `vscodeAdapter.ts` imports
  // `vscode` and no unit test can load it; the arrow's body would go untested.
  //
  // The provider hole this pins used to be reachable. Making `verify` required
  // on `ResolveDeps.download` guards the CALLER — dropping the 4th argument in
  // `downloadCli` is a TS2554 — but NOT the provider: TypeScript's function
  // assignability accepts a 3-parameter implementation for a 4-parameter type,
  // so
  //
  //     download: (url, dest, signal) =>
  //       downloadFile(url, dest, signal, proxySettings()),
  //
  // typechecked clean, `verify` arrived `undefined`, and the extension was
  // silently back to installing and executing unverified bytes on a fully
  // green board. What refuses that edit today is `downloadFile`'s parameter
  // ORDER, not this test: `verify` is its 3rd and required parameter, so an
  // `AbortSignal` in that position is a TS2345 wherever the arrow is written.
  // This test covers the other half — that the seam really does verify, rather
  // than merely being handed a spec it ignores.
  const published = Buffer.from("the real tan binary\n");
  const tampered = Buffer.from(published);
  tampered[4] ^= 0x01;
  let proxyReads = 0;
  const seam = downloadSeam(() => {
    proxyReads += 1;
    return {};
  });
  await withServer(
    serveRelease({
      body: tampered,
      manifest: manifestFor([[sha256(published), ASSET_NAME]]),
    }),
    async (baseUrl) => {
      const { dir, dest } = tmpDest();
      const rejection = await rejectionOf(
        seam(`${baseUrl}/asset`, dest, undefined, verifySpec(baseUrl)),
      );
      assert.ok(
        rejection instanceof ChecksumError,
        "the injected seam dropped `verify` — it installed bytes that do not " +
          "match the published digest, which is issue #378 back again",
      );
      assert.ok(!fs.existsSync(dest), "nothing may be installed");
      assert.deepEqual(fs.readdirSync(dir), []);
    },
  );
  // Read per call, not memoized: changing `http.proxy` has to take effect on
  // the next download without a window reload.
  assert.equal(proxyReads, 1, "the proxy settings must be read per download");
});

test("downloadSeam: bytes matching the published digest install through it", async () => {
  const body = Buffer.from("the real tan binary\n");
  await withServer(
    serveRelease({ body, manifest: manifestFor([[sha256(body), ASSET_NAME]]) }),
    async (baseUrl) => {
      const { dest } = tmpDest();
      await downloadSeam(() => ({}))(
        `${baseUrl}/asset`,
        dest,
        undefined,
        verifySpec(baseUrl),
      );
      assert.deepEqual(fs.readFileSync(dest), body);
    },
  );
});

test("downloadFile: an oversized checksums.txt is REFUSED, not buffered", async () => {
  // `checksums.txt` is read whole into memory (849 bytes at tan v0.4.0) and a
  // hostile origin is precisely this change's threat model. Without a cap the
  // read is bounded only by the 120 s wall clock — two minutes of unbounded
  // growth in the extension host's heap. Refusing (rather than truncating) is
  // load-bearing too: a truncated manifest could be missing the digest line and
  // would then read as "the release does not list this asset".
  const body = Buffer.from("the real tan binary\n");
  const oversized = `${"#".repeat(70 * 1024)}\n${sha256(body)}  ${ASSET_NAME}\n`;
  await withServer(
    serveRelease({ body, manifest: oversized }),
    async (baseUrl) => {
      const { dir, dest } = tmpDest();
      const rejection = await rejectionOf(fetchAsset(baseUrl, dest));
      assert.ok(
        rejection instanceof ChecksumError,
        "an unbounded manifest body must not be swallowed whole",
      );
      assert.match(rejection.message, /could not be fetched/);
      assert.match(rejection.detail, /exceeded 65536 bytes/);
      assert.ok(!fs.existsSync(dest), "and nothing is installed");
      assert.deepEqual(fs.readdirSync(dir), []);
    },
  );
});

test("downloadFile: a real-sized checksums.txt is comfortably under the cap", async () => {
  // The cap must not be so tight that a genuine release trips it. tan publishes
  // eight targets plus the envelope contract; this is a generous multiple.
  const body = Buffer.from("the real tan binary\n");
  const entries = Array.from({ length: 200 }, (_unused, i) => [
    sha256(Buffer.from(`asset ${i}`)),
    `tan-target-number-${i}-with-a-long-triple-name`,
  ]);
  entries.push([sha256(body), ASSET_NAME]);
  await withServer(
    serveRelease({ body, manifest: manifestFor(entries) }),
    async (baseUrl) => {
      const { dest } = tmpDest();
      await fetchAsset(baseUrl, dest);
      assert.deepEqual(fs.readFileSync(dest), body);
    },
  );
});

test("downloadFile: an unverified transfer must be asked for by name", async () => {
  // `verify` is REQUIRED, so this branch is not reachable by forgetting: the
  // literal `null` below is the only way in, and it greps. It exists for the
  // transfer-mechanics tests, which serve bodies no release ever published a
  // digest for. No production caller passes it — `downloadCli` builds the spec
  // from `releaseAssetForTarget`, which types the field as non-optional, and
  // `ResolveDeps.download` requires it of the seam too. This test pins that
  // `null` still means "transfer without verifying", so the tests that rely on
  // it are exercising the real code path and not a stub.
  const body = Buffer.from("no manifest for this one\n");
  await withServer(serveRelease({ body }), async (baseUrl) => {
    const { dest } = tmpDest();
    await downloadFile(`${baseUrl}/asset`, dest, null);
    assert.deepEqual(fs.readFileSync(dest), body);
  });
});
