// SPDX-License-Identifier: Apache-2.0
//
// `probeAsset` decides whether the tan release named by `SUPPORTED_CLI_VERSION`
// really publishes an asset — and #510 is what happens when it decides wrong.
//
// On a CSS-only PR the gate printed, verbatim:
//
//   MISSING  v0.6.0-rc1 tan-x86_64-pc-windows-msvc.exe / tan-x86_64-pc-windows-msvc.zip
//   MISSING  v0.6.0-rc1 tan-aarch64-apple-darwin / tan-aarch64-apple-darwin.tar.gz
//   SUPPORTED_CLI_VERSION is 0.6.0-rc1, and the release above is not published (or is incomplete).
//
// Both assets existed and had not been touched since 2026-08-14T20:14:02Z;
// `curl -I -L` returned 200 from a dev machine, and re-running the job with no
// change passed. WHY the runner saw a 404 is still not established — transient
// 404, rate limit and CDN edge glitch all fit, and this file does not claim to
// know. What IS established is the asymmetry that turned one sample into a
// verdict: `5xx`/`429` were retried, a `404` returned immediately.
//
// That asymmetry is the expensive direction. `missing` reds EVERY PR, and its
// message tells the reader to lower the pin or add a
// `HOSTS_WITHOUT_RELEASE_ASSET` entry — the second of which silently stops
// covering a host that IS published. `unknown` prints `skipped` and fails
// nothing. So absence has to survive every attempt before it is claimed.
//
// A real rate limit cannot be ordered on demand, so the gate here is a local
// `node:http` server with a scripted status sequence per path. It nails the
// BEHAVIOUR — one 404 among successes is not absence — rather than any
// particular cause.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

/** The module is ESM and the suite is CommonJS; import once, lazily. */
let probeAssetPromise;
function loadProbeAsset() {
  probeAssetPromise ??= import("../scripts/lib/probe-asset.mjs").then(
    (m) => m.probeAsset,
  );
  return probeAssetPromise;
}

/**
 * A server that answers each path with the next status in its script, then
 * repeats the last one forever. `/always-404` with `[404]` answers 404 to every
 * request; `/flaky` with `[404, 200]` answers 404 once and 200 from then on.
 *
 * It also counts the requests it received, so a test can assert that a probe
 * really did try again rather than passing for some other reason.
 */
async function scriptedServer(script) {
  const seen = Object.fromEntries(Object.keys(script).map((p) => [p, 0]));
  const server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    const statuses = script[path];
    if (!statuses) {
      res.writeHead(404).end();
      return;
    }
    const i = seen[path];
    seen[path] += 1;
    res.writeHead(statuses[Math.min(i, statuses.length - 1)]).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    requests: (path) => seen[path],
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** CI's real values are 3 attempts and a 1 000 ms pause; the pause is the only
 *  thing worth shortening, and the attempt count must stay at the real one. */
const FAST = { retryDelayMs: 5, timeoutMs: 2_000 };

async function probe(server, path, options = {}) {
  const probeAsset = await loadProbeAsset();
  return probeAsset(server.url(path), { ...FAST, ...options });
}

test("an asset that answers 200 is present on the first attempt", async () => {
  const server = await scriptedServer({ "/ok": [200] });
  try {
    const result = await probe(server, "/ok");
    assert.equal(result.state, "present");
    assert.equal(
      server.requests("/ok"),
      1,
      "a 200 must not cost a retry — the gate probes 12 URLs on every PR",
    );
  } finally {
    await server.close();
  }
});

test("an asset that 404s on EVERY attempt is missing", async () => {
  // The regression guard on the fix below: a release that really is not
  // published still has to red the gate. Softening `missing` into `unknown`
  // would reintroduce the defect this whole script exists to catch — a pin
  // raised to an unreleased version, green CI, and every user's activation
  // retrying a 404 forever.
  const server = await scriptedServer({ "/gone": [404] });
  try {
    const result = await probe(server, "/gone");
    assert.equal(result.state, "missing");
    assert.equal(
      server.requests("/gone"),
      3,
      "absence is only claimed after every attempt agrees",
    );
  } finally {
    await server.close();
  }
});

test("a 404 followed by a 200 is PRESENT, not missing", async () => {
  // #510 itself. The asset was there the whole time; one probe saw a 404 and
  // the gate reported the release as unpublished.
  const server = await scriptedServer({ "/flaky": [404, 200] });
  try {
    const result = await probe(server, "/flaky");
    assert.equal(
      result.state,
      "present",
      `a single 404 among successes is not absence (detail: ${result.detail})`,
    );
    assert.equal(server.requests("/flaky"), 2);
  } finally {
    await server.close();
  }
});

test("a 404 on the first two attempts still resolves on the third", async () => {
  // The retry budget is spent, not sampled: the last attempt counts as much as
  // the first.
  const server = await scriptedServer({ "/late": [404, 404, 200] });
  try {
    const result = await probe(server, "/late");
    assert.equal(result.state, "present");
    assert.equal(server.requests("/late"), 3);
  } finally {
    await server.close();
  }
});

test("a 404 mixed with a 5xx is unknown, never missing", async () => {
  // Two different failures across three attempts means we do not know what we
  // are looking at, and `unknown` prints `skipped` rather than failing the PR.
  // Reporting `missing` here would be claiming absence from a server that
  // never gave a consistent answer.
  const server = await scriptedServer({ "/mixed": [404, 503, 404] });
  try {
    const result = await probe(server, "/mixed");
    assert.equal(result.state, "unknown");
    assert.equal(server.requests("/mixed"), 3);
  } finally {
    await server.close();
  }
});

test("an asset that 503s on every attempt is unknown, not missing", async () => {
  // Unchanged behaviour, asserted so the fix cannot collapse the three states
  // into two.
  const server = await scriptedServer({ "/down": [503] });
  try {
    const result = await probe(server, "/down");
    assert.equal(result.state, "unknown");
    assert.equal(server.requests("/down"), 3);
  } finally {
    await server.close();
  }
});

test("a failed probe reports what it saw and how many times", async () => {
  // The #510 message stated absence without saying what it observed, so
  // reading the CI log told you nothing the failure line had not already
  // claimed. Both failing states carry the observed statuses and the attempt
  // count now.
  const server = await scriptedServer({ "/gone": [404], "/down": [503] });
  try {
    const missing = await probe(server, "/gone");
    assert.equal(missing.state, "missing");
    assert.equal(missing.attempts, 3);
    assert.deepEqual(missing.seen, ["404", "404", "404"]);
    assert.match(missing.detail, /404/);
    assert.match(missing.detail, /3/);

    const unknown = await probe(server, "/down");
    assert.equal(unknown.state, "unknown");
    assert.equal(unknown.attempts, 3);
    assert.deepEqual(unknown.seen, ["503", "503", "503"]);
    assert.match(unknown.detail, /503/);
  } finally {
    await server.close();
  }
});

test("a connection that never lands is unknown, and says why", async () => {
  // A network error is not a 404. It has to stay out of `missing` for the same
  // reason a 503 does, and the reason has to reach the log.
  const server = await scriptedServer({ "/ok": [200] });
  const url = server.url("/ok");
  await server.close(); // nothing is listening any more
  const probeAsset = await loadProbeAsset();
  const result = await probeAsset(url, FAST);
  assert.equal(result.state, "unknown");
  assert.equal(result.attempts, 3);
  assert.ok(
    result.detail.length > 0,
    "an empty detail is what made #510 unreadable",
  );
});

test("the gate prints the probe detail on a MISSING line", async () => {
  // `probeAsset` can carry all the detail it likes and the reader still never
  // sees it if the failure branch drops it. Source-level because the branch
  // only runs against a real release; the assertion is narrow on purpose —
  // that the MISSING line interpolates `detail`.
  const fs = require("node:fs");
  const path = require("node:path");
  const gate = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "check-cli-pin.mjs"),
    "utf8",
  );
  const missingLine = gate
    .split("\n")
    .find((line) => line.includes("MISSING") && line.includes("${label}"));
  assert.ok(missingLine, "the MISSING output line moved or was renamed");
  assert.match(
    missingLine,
    /\$\{detail\}/,
    "the MISSING line must say what the probe actually observed",
  );
});
