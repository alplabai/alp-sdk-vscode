// SPDX-License-Identifier: Apache-2.0
//
// Proxy routing for the managed `tan` download, driven through the REAL
// `downloadFile` against a local origin server and a local forward-proxy stub.
//
// Why this file exists: Node honours no proxy variable of its own, so before
// `ProxyConfig` a corporate-proxy machine could never fetch the CLI at all and
// was told "Couldn't download the tan CLI … retry when you're back online" —
// advice for an outage that wasn't happening. Every assertion here is either
// "the proxy really saw the request" or "the failure says PROXY and leaks no
// credential"; the second is a security property, not a wording preference,
// because the output channel is what customers paste into issue reports.
//
// `env` is passed explicitly in every test: this suite must not depend on
// whatever HTTPS_PROXY the machine running it happens to export.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const tls = require("node:tls");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ProxyError, downloadFile } = require("../out/alpCli/download.js");
// The real planner the adapter feeds this rejection to. Imported (not mimicked)
// so "the customer reads this sentence" is asserted by the code that decides
// it — `planFailure` demotes a `cause` carrying an errno, an exit code or an
// absolute path into the channel and toasts a generic "<operation> failed."
const { planFailure } = require("../out/notify/service.js");

const BODY = Buffer.from("the tan-cli release asset\n");

/** A fatal TLS alert record (handshake_failure) — the shortest well-formed
 *  thing a peer can say to make an OpenSSL handshake give up at once, which is
 *  how the tunnel test provokes a TLS failure without shipping a private key. */
const TLS_FATAL_ALERT = Buffer.from([0x15, 0x03, 0x03, 0x00, 0x02, 0x02, 0x28]);

function tmpDest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-proxy-test-"));
  return { dir, dest: path.join(dir, "tan.exe") };
}

/**
 * Run `fn(baseUrl, …)` against a listening `server`, then always shut it down.
 *
 * The sockets are tracked and destroyed BY HAND. `server.close()` waits for
 * every connection to drain, and neither the global agent's keep-alive sockets
 * nor — crucially — a socket hijacked by a CONNECT come back on their own:
 * `closeAllConnections()` does not reach a hijacked one, so a plain close()
 * here hangs the test forever instead of failing it. The no-op `error` listener
 * is for the same hijack: `http.Server` removes its own when it hands the
 * socket over, so the client's RST would otherwise be an uncaught exception.
 */
async function serving(server, fn) {
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** A plain origin server that serves BODY at any path. */
function withOrigin(fn) {
  return serving(
    http.createServer((req, res) => {
      res.writeHead(200, { "content-length": String(BODY.length) });
      res.end(BODY);
    }),
    fn,
  );
}

/**
 * A forward-proxy stub that RECORDS what it was asked for. `handlers.request`
 * answers an absolute-form plain-http request; `handlers.connect` answers a
 * CONNECT. Both default to "the proxy was not supposed to be used", which is
 * how the direct-connection tests prove they went direct.
 */
function withProxy(handlers, fn) {
  const seen = { requests: [], connects: [], auth: [] };
  const record = (req) => seen.auth.push(req.headers["proxy-authorization"]);
  const server = http.createServer((req, res) => {
    seen.requests.push(req.url);
    record(req);
    (handlers.request ?? (() => res.destroy()))(req, res);
  });
  server.on("connect", (req, socket, head) => {
    seen.connects.push(req.url);
    record(req);
    (handlers.connect ?? ((_r, s) => s.destroy()))(req, socket, head);
  });
  return serving(server, (baseUrl) => fn(baseUrl, seen));
}

/** A TCP port with nothing listening on it — the https "origin" the tunnel
 *  tests aim at, so that a request which did NOT go through the tunnel fails
 *  with a visibly different error (ECONNREFUSED) than one that did. */
async function closedPort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** The proxy is there but must not be used. */
const NEVER = {
  request: (req, res) => {
    res.writeHead(500);
    res.end("the proxy should not have been used");
  },
};

test("no proxy configured: the download goes direct and the proxy never sees it", async () => {
  await withOrigin(async (origin) => {
    await withProxy(NEVER, async (_proxyUrl, seen) => {
      const { dest } = tmpDest();
      await downloadFile(`${origin}/asset`, dest, null, { proxy: { env: {} } });
      assert.deepEqual(fs.readFileSync(dest), BODY);
      assert.deepEqual(seen.requests, [], "nothing may reach the proxy");
      assert.deepEqual(seen.connects, []);
    });
  });
});

test("HTTP_PROXY routes a plain-http download through the proxy in absolute form", async () => {
  await withOrigin(async (origin) => {
    await withProxy(
      {
        request: (req, res) => {
          res.writeHead(200, { "content-length": String(BODY.length) });
          res.end(BODY);
        },
      },
      async (proxyUrl, seen) => {
        const { dest } = tmpDest();
        await downloadFile(`${origin}/asset`, dest, null, {
          proxy: { env: { HTTP_PROXY: proxyUrl } },
        });
        assert.deepEqual(fs.readFileSync(dest), BODY);
        // The absolute-form request URI is the whole point: it is how the
        // proxy learns where to forward. A relative "/asset" would mean the
        // request was aimed at the proxy as if it were the origin.
        assert.deepEqual(seen.requests, [`${origin}/asset`]);
      },
    );
  });
});

test("http.proxy (the VS Code setting) wins over the environment", async () => {
  await withOrigin(async (origin) => {
    await withProxy(
      {
        request: (req, res) => {
          res.writeHead(200, { "content-length": String(BODY.length) });
          res.end(BODY);
        },
      },
      async (chosen, seen) => {
        await withProxy(NEVER, async (fromEnv, ignored) => {
          const { dest } = tmpDest();
          await downloadFile(`${origin}/asset`, dest, null, {
            proxy: { proxy: chosen, env: { HTTP_PROXY: fromEnv } },
          });
          assert.deepEqual(fs.readFileSync(dest), BODY);
          assert.deepEqual(seen.requests, [`${origin}/asset`]);
          assert.deepEqual(
            ignored.requests,
            [],
            "a user who set http.proxy meant it — the environment loses",
          );
        });
      },
    );
  });
});

test("NO_PROXY bypasses a configured proxy entirely", async () => {
  await withOrigin(async (origin) => {
    await withProxy(NEVER, async (proxyUrl, seen) => {
      const { dest } = tmpDest();
      await downloadFile(`${origin}/asset`, dest, null, {
        proxy: {
          // Set BOTH sources, so the bypass is proven against the stronger one.
          proxy: proxyUrl,
          env: { HTTP_PROXY: proxyUrl, NO_PROXY: "example.com,127.0.0.1" },
        },
      });
      assert.deepEqual(fs.readFileSync(dest), BODY);
      assert.deepEqual(seen.requests, [], "NO_PROXY must win over http.proxy");
    });
  });
});

test("an https download is tunnelled with CONNECT through the proxy", async () => {
  const dead = await closedPort();
  await withProxy(
    {
      connect: (_req, socket) => {
        // Tunnel established, then a fatal TLS alert instead of a ServerHello.
        // Two things are pinned by this, both of which broke while it was
        // written:
        //  - the TLS attempt runs over THIS socket. `createConnection` is only
        //    honoured when no `agent` is passed (`agent: false` silently
        //    builds a fresh Agent and drops it); if it were ignored, https
        //    would open its own socket straight to the dead port and the
        //    failure would say ECONNREFUSED instead;
        //  - the alert lands in the CONNECT response's `head` (it shares a
        //    segment with the 200), so it only reaches the handshake if those
        //    bytes are unshifted back onto the socket. Without that the
        //    handshake waits for a ServerHello it has already been sent.
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        socket.write(TLS_FATAL_ALERT);
      },
    },
    async (proxyUrl, seen) => {
      const { dest } = tmpDest();
      const rejection = await downloadFile(
        `https://127.0.0.1:${dead}/asset`,
        dest,
        null,
        { proxy: { proxy: proxyUrl, env: {} } },
      ).then(
        () => null,
        (error) => error,
      );
      assert.ok(rejection, "a bad tunnel must not resolve");
      assert.deepEqual(
        seen.connects,
        [`127.0.0.1:${dead}`],
        "the proxy must be asked to CONNECT to the target authority",
      );
      assert.ok(rejection instanceof ProxyError, `got ${rejection.name}`);
      assert.match(
        rejection.message,
        /http\.proxyStrictSSL/,
        "a TLS failure INSIDE the tunnel names the setting that accepts it",
      );
      assert.doesNotMatch(
        rejection.message,
        /refused the connection/,
        "that wording would mean the request bypassed the tunnel",
      );
    },
  );
});

test("an unparseable proxy fails loudly and never echoes the value back", async () => {
  const { dest } = tmpDest();
  const rejection = await downloadFile(
    "https://example.invalid/asset",
    dest,
    null,
    // Credentials are the reason this value is not echoed: a typo'd proxy URL
    // is usually a typo in a URL that carries a password.
    { proxy: { proxy: "http://", env: {} } },
  ).then(
    () => null,
    (error) => error,
  );
  // Silently going direct would fail later with a message that never mentions
  // the proxy — the exact confusion this whole path exists to remove.
  assert.ok(rejection instanceof ProxyError, `got ${rejection?.name}`);
  assert.match(rejection.message, /proxy is not a valid URL/);
  assert.match(rejection.message, /http\.proxy/);
});

test("a proxy that cannot be reached names the proxy, not the download", async () => {
  const deadProxy = await closedPort();
  const { dest } = tmpDest();
  const rejection = await downloadFile(
    "https://example.invalid/asset",
    dest,
    null,
    { proxy: { proxy: `http://127.0.0.1:${deadProxy}`, env: {} } },
  ).then(
    () => null,
    (error) => error,
  );
  assert.ok(rejection instanceof ProxyError, `got ${rejection?.name}`);
  assert.match(rejection.message, /proxy 127\.0\.0\.1:/);
  assert.match(rejection.message, /refused the connection/);
  // The errno is the channel's business; in the sentence it makes `planFailure`
  // throw the whole message away.
  assert.doesNotMatch(rejection.message, /\bECONNREFUSED\b/);
  assert.match(rejection.detail, /ECONNREFUSED/);
});

test("a 407 from a credentialed proxy says proxy and never leaks the password", async () => {
  const dead = await closedPort();
  await withProxy(
    {
      connect: (_req, socket) => {
        socket.write(
          "HTTP/1.1 407 Proxy Authentication Required\r\n" +
            'Proxy-Authenticate: Basic realm="corp"\r\n' +
            "Content-Length: 0\r\n\r\n",
        );
      },
    },
    async (proxyUrl, seen) => {
      const { dest } = tmpDest();
      const credentialed = proxyUrl.replace("http://", "http://alice:hunter2@");
      const rejection = await downloadFile(
        `https://127.0.0.1:${dead}/asset`,
        dest,
        null,
        { proxy: { proxy: credentialed, env: {} } },
      ).then(
        () => null,
        (error) => error,
      );
      assert.ok(rejection instanceof ProxyError, `got ${rejection?.name}`);

      // 1. It says PROXY, and says which one, and says what it answered. The
      //    previous behaviour funnelled this into "Couldn't download the tan
      //    CLI", which reads as "the CLI is broken".
      assert.match(rejection.message, /\bproxy\b/i);
      assert.match(rejection.message, /407/);
      assert.match(rejection.message, /127\.0\.0\.1:/);

      // 2. THE security property. The userinfo must not survive into anything
      //    user-visible — not the toast, not the output-channel detail. This
      //    assertion is the one that must exist.
      const everythingUserVisible = `${rejection.message}\n${rejection.detail}`;
      assert.doesNotMatch(everythingUserVisible, /hunter2/);
      assert.doesNotMatch(everythingUserVisible, /alice/);

      // 3. …and the credential is not merely dropped: it went to the proxy,
      //    on the one header that is allowed to carry it.
      assert.equal(
        seen.auth[0],
        `Basic ${Buffer.from("alice:hunter2").toString("base64")}`,
      );

      // 4. The end of the wire: the sentence has to survive `planFailure`
      //    intact. An errno, an exit code or a scheme-bearing URL in `cause`
      //    silently replaces the toast with "Updating the tan CLI failed." and
      //    buries the proxy explanation behind a Show Output click — which is
      //    exactly the #368 defect this test pins shut.
      const plan = planFailure({
        operation: "Updating the tan CLI",
        cause: rejection.message,
        detail: rejection.detail,
        actions: [{ id: "openSettings", arg: "http.proxy" }],
      });
      assert.equal(plan.message, rejection.message);
      assert.doesNotMatch(`${plan.message}\n${plan.detail}`, /hunter2/);
    },
  );
});

// ---------------------------------------------------------------------------
// #380 — the three proxy defects, and the one the issue got wrong.
//
// Urgency: since tan-cli#176 the managed download makes TWO proxied fetches —
// `checksums.txt` from the resolved tag first, then the binary — and REFUSES
// the install if the checksum fetch fails. A proxy defect that used to degrade
// one fetch now blocks the install outright, on a corporate host, on first
// contact, before a byte of the binary moves. (Order asserted below, where the
// recorded request paths must come back `[checksums.txt, asset]`.)
// ---------------------------------------------------------------------------

const rejectionOf = (promise) =>
  promise.then(
    () => undefined,
    (error) => error,
  );

/** A target that must never reach a real network: `.invalid` is reserved and
 *  never resolves, so a routing decision gone wrong fails fast instead of
 *  fetching something. */
const UNREACHABLE = "https://tan-release.invalid/asset";

// --- Defect 1: an unsupported proxy scheme is diagnosed as one --------------

// All five parse as URLs today, which is exactly why they reached `CONNECT`:
// `new URL("socks5://h:1080").protocol` is "socks5:", `proxyTransport` mapped
// every non-https scheme to http, and the code then spoke HTTP at a SOCKS
// listener. The category ("proxy") was right and the sub-diagnosis ("the
// connection to it failed") was wrong, which sends the customer to fix a proxy
// that is working perfectly — worse than saying nothing.
for (const scheme of ["socks", "socks4", "socks4a", "socks5", "socks5h"]) {
  test(`a ${scheme} proxy is refused by scheme, not misreported as unreachable`, async () => {
    const { dest } = tmpDest();
    const rejection = await rejectionOf(
      downloadFile(UNREACHABLE, dest, null, {
        proxy: { proxy: `${scheme}://proxy.invalid:1080`, env: {} },
      }),
    );
    assert.ok(rejection instanceof ProxyError, `got ${rejection?.name}`);
    // It names the thing the customer actually has to change.
    assert.match(rejection.message, new RegExp(`\\b${scheme}\\b`));
    assert.match(rejection.message, /http\.proxy/);
    assert.match(rejection.message, /http and https proxies only/);
    // And it is not either of the two wrong sentences it used to be.
    assert.doesNotMatch(rejection.message, /connection to it failed/);
    assert.doesNotMatch(rejection.message, /not a valid URL/);
  });
}

test("an unsupported proxy scheme leaks no credential and survives planFailure", async () => {
  const { dest } = tmpDest();
  const rejection = await rejectionOf(
    downloadFile(UNREACHABLE, dest, null, {
      proxy: { proxy: "socks5://alice:hunter2@proxy.invalid:1080", env: {} },
    }),
  );
  assert.ok(rejection instanceof ProxyError, `got ${rejection?.name}`);
  // THE security property, same as the 407 case: the userinfo must not survive
  // into anything user-visible. `redactProxy` is what keeps it out of `detail`.
  const everythingUserVisible = `${rejection.message}\n${rejection.detail}`;
  assert.doesNotMatch(everythingUserVisible, /hunter2/);
  assert.doesNotMatch(everythingUserVisible, /alice/);
  // The sentence has to reach the toast intact. `planFailure`'s absolute-path
  // guard reads the `s:/` of a bare `socks://` as a drive letter and would
  // demote the whole message into the output channel, so the scheme is named
  // WITHOUT its slashes — this is what pins that.
  const plan = planFailure({
    operation: "Updating the tan CLI",
    cause: rejection.message,
    detail: rejection.detail,
  });
  assert.equal(plan.message, rejection.message);
});

test("the scheme check is an allow-list: an unknown scheme is refused, not defaulted to http", async () => {
  const { dest } = tmpDest();
  const rejection = await rejectionOf(
    downloadFile(UNREACHABLE, dest, null, {
      proxy: { proxy: "ftp://proxy.invalid:2121", env: {} },
    }),
  );
  // A socks-only deny-list would fix the five spellings and send the next
  // scheme somebody configures down the identical wrong diagnosis. The property
  // that decides it is "can an HTTP CONNECT be spoken here", and only http and
  // https can, so the list of what passes is the one that cannot go stale.
  assert.ok(rejection instanceof ProxyError, `got ${rejection?.name}`);
  assert.match(rejection.message, /\bftp\b/);
  assert.match(rejection.message, /http and https proxies only/);
});

test("a scheme-less proxy value still works after the allow-list", async () => {
  await withOrigin(async (origin) => {
    await withProxy(
      {
        request: (req, res) => {
          res.writeHead(200, { "content-length": String(BODY.length) });
          res.end(BODY);
        },
      },
      async (proxyUrl, seen) => {
        const { dest } = tmpDest();
        // Written bare, so the `http://${raw}` default is covered by the
        // allow-list too and not only the spelled-out form.
        await downloadFile(`${origin}/asset`, dest, null, {
          proxy: { proxy: proxyUrl.replace("http://", ""), env: {} },
        });
        assert.deepEqual(fs.readFileSync(dest), BODY);
        assert.deepEqual(seen.requests, [`${origin}/asset`]);
      },
    );
  });
});

test("a bare IPv6 proxy is still refused, but the sentence now names the brackets", async () => {
  const { dest } = tmpDest();
  const rejection = await rejectionOf(
    downloadFile(UNREACHABLE, dest, null, {
      // `::2:9999` cannot be split into host and port without guessing — it is
      // itself a valid IPv6 address — so the throw stays, exactly as curl
      // requires the brackets. What changed is that the sentence says which
      // part is wrong instead of leaving the customer to find it.
      proxy: { proxy: "::2:9999", env: {} },
    }),
  );
  assert.ok(rejection instanceof ProxyError, `got ${rejection?.name}`);
  assert.match(rejection.message, /not a valid URL/);
  assert.match(rejection.message, /brackets/);
  assert.match(rejection.message, /\[::1\]:8080/, "the remedy is spelled out");
  // The example is the extension's, not the customer's: the offending value is
  // still never echoed, because a typo'd proxy URL usually carries a password.
  assert.doesNotMatch(`${rejection.message}\n${rejection.detail}`, /9999/);
});

test("a bracketed IPv6 proxy parses and is routed to", async () => {
  const { dest } = tmpDest();
  const rejection = await rejectionOf(
    downloadFile(UNREACHABLE, dest, null, {
      // Nothing is listening, so this fails — but as a REACHABILITY failure,
      // which is what proves the value parsed and was used rather than rejected.
      proxy: { proxy: "[::1]:9", env: {} },
    }),
  );
  assert.ok(rejection instanceof ProxyError, `got ${rejection?.name}`);
  assert.doesNotMatch(rejection.message, /not a valid URL/);
  assert.match(rejection.message, /Couldn't reach the proxy/);
});

// --- Defect 2: NO_PROXY and IPv6 -------------------------------------------

/**
 * Route ONE https download and report whether the proxy was asked to tunnel.
 *
 * The target never has to be reachable and no IPv6 stack has to work: a
 * bypassed request fails on its own (a DNS refusal, a dead port, no route) and
 * the proxy simply records nothing, so `connects` is the whole verdict either
 * way. The signal caps a direct attempt that a routable-looking address could
 * make HANG on a host with global IPv6 — a proxied CONNECT is recorded in
 * about a millisecond, so it can never be the thing this cuts short.
 */
async function connectsFor(target, noProxy) {
  return withProxy({}, async (proxyUrl, seen) => {
    const { dest } = tmpDest();
    await rejectionOf(
      downloadFile(target, dest, null, {
        signal: AbortSignal.timeout(5000),
        proxy: { proxy: proxyUrl, env: { NO_PROXY: noProxy } },
      }),
    );
    return seen.connects;
  });
}

test("NO_PROXY matches an IPv6 host in either spelling, with or without a port", async () => {
  // The defect, two causes stacked: `URL.hostname` is "[::1]" while the
  // customer's NO_PROXY entry says "::1", and `lastIndexOf(':')` read the
  // trailing `1` of `::1` as a port number. So a customer who excluded their
  // IPv6 host was proxied anyway — silently, until tan-cli#176 turned that into
  // a refused install rather than a slow one. Only loopback appears here: a
  // bypass is observed as "no CONNECT", which means the direct attempt really
  // runs, and `::1` is the one address guaranteed to refuse it instantly.
  for (const [noProxy, target] of [
    ["::1", "https://[::1]:9/asset"],
    ["[::1]", "https://[::1]:9/asset"],
    ["[::1]:9", "https://[::1]:9/asset"],
    ["[::1]:443", "https://[::1]/asset"],
  ]) {
    assert.deepEqual(
      await connectsFor(target, noProxy),
      [],
      `NO_PROXY=${noProxy} must bypass ${target}`,
    );
  }
});

test("an IPv6 target NO_PROXY does not cover is tunnelled, with a BRACKETED authority", async () => {
  // Two claims, and the second is the one #380 got wrong: the report said the
  // tunnel authority comes out unbracketed, as `::1:9`. It does not — WHATWG
  // `URL.hostname` returns an IPv6 literal WITH its brackets — so `download.ts`
  // was already correct there and was deliberately left alone. Pinned here so
  // nobody "fixes" it into a real defect.
  assert.deepEqual(await connectsFor("https://[::1]:9/asset", "::2"), [
    "[::1]:9",
  ]);
  assert.deepEqual(await connectsFor("https://[2001:db8::1]/asset", ""), [
    "[2001:db8::1]:443",
  ]);
  // `::1:443` is itself a valid IPv6 address, so an entry spelled that way is
  // taken WHOLE rather than split into host `::1` plus port 443. Guessing
  // either reading would be a coin flip; brackets are how a port is expressed.
  assert.deepEqual(await connectsFor("https://[::1]:443/asset", "::1:443"), [
    "[::1]:443",
  ]);
});

test("the NO_PROXY controls the IPv6 fix must not regress", async () => {
  for (const [noProxy, target] of [
    ["example.invalid", "https://example.invalid/asset"],
    ["example.invalid", "https://a.example.invalid/asset"],
    [".example.invalid", "https://example.invalid/asset"],
    [".example.invalid", "https://a.example.invalid/asset"],
    ["example.invalid:443", "https://example.invalid/asset"],
    ["127.0.0.1", "https://127.0.0.1:9/asset"],
    ["*", "https://example.invalid/asset"],
  ]) {
    assert.deepEqual(
      await connectsFor(target, noProxy),
      [],
      `NO_PROXY=${noProxy} must still bypass ${target}`,
    );
  }
  for (const [noProxy, target] of [
    ["example.invalid", "https://notexample.invalid/asset"],
    ["example.invalid:443", "https://example.invalid:8443/asset"],
    ["", "https://example.invalid/asset"],
  ]) {
    assert.equal(
      (await connectsFor(target, noProxy)).length,
      1,
      `NO_PROXY=${noProxy} must NOT bypass ${target}`,
    );
  }
});

// --- Defect 3: the CONNECT tunnel's `host:` was unfalsifiable ---------------

/**
 * Capture the options `download.ts` hands `tls.connect` for the tunnelled
 * request.
 *
 * No certificate anywhere, on purpose. The property under test — "the origin's
 * certificate is checked against the TARGET's name, not the proxy's" — only
 * becomes observable end-to-end once chain verification PASSES, which needs a
 * trusted CA and therefore a committed private key with an expiry date on it.
 * The option is the same fact one step earlier, and it is the step this file
 * owns.
 *
 * FAILS CLOSED. If this patch ever stopped being visible to the module under
 * test, nothing is recorded and the caller's `assert.ok(options)` throws — it
 * cannot decay into a test that passes with the header and without it, which is
 * the failure mode #380 was filed about.
 */
async function tlsOptionsForTunnel(target, proxyHostname) {
  const seen = [];
  const original = tls.connect;
  tls.connect = function (options, ...rest) {
    seen.push(options);
    return original.call(this, options, ...rest);
  };
  try {
    await withProxy(
      {
        connect: (_req, socket) => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          socket.write(TLS_FATAL_ALERT);
        },
      },
      async (proxyUrl) => {
        const { dest } = tmpDest();
        const { port } = new URL(proxyUrl);
        await rejectionOf(
          downloadFile(target, dest, null, {
            signal: AbortSignal.timeout(5000),
            proxy: { proxy: `http://${proxyHostname}:${port}`, env: {} },
          }),
        );
      },
    );
  } finally {
    tls.connect = original;
  }
  return seen[0];
}

test("the tunnelled TLS connect is given the TARGET's host, never the proxy's", async () => {
  // `host:` is what the certificate is checked against, and it is load-bearing
  // exactly where the `net.isIP` guard withholds `servername`: an IP-literal
  // target. The proxy is reached as `localhost` here while the target is
  // `127.0.0.1`, so the two names differ and a fallback to the socket's would
  // be visible rather than coincidentally identical.
  //
  // What this test pins is the OPTIONS handed to `tls.connect`, not a
  // verification outcome — asserting the latter would need a real certificate
  // chain. The narrower reading of how Node resolves `host` against
  // `servername` came from reviewing #377 (driven there on Node 26.5.0, not
  // re-driven here); treat it as the reason this test exists, not as something
  // this file establishes.
  const options = await tlsOptionsForTunnel(
    "https://127.0.0.1:9/asset",
    "localhost",
  );
  assert.ok(options, "tls.connect was never reached");
  assert.equal(options.host, "127.0.0.1");
  assert.notEqual(
    options.host,
    "localhost",
    "the origin's certificate must not be verified against the proxy's name",
  );
  // The other half of the same call: SNI is WITHHELD for an IP literal, because
  // Node throws ERR_INVALID_ARG_VALUE for one — that would crash the download
  // rather than fetch it.
  assert.equal(options.servername, undefined);
});

test("a DNS-named tunnel target gets SNI as well as host", async () => {
  const options = await tlsOptionsForTunnel(
    "https://tan-release.invalid/asset",
    "localhost",
  );
  assert.ok(options, "tls.connect was never reached");
  assert.equal(options.host, "tan-release.invalid");
  assert.equal(options.servername, "tan-release.invalid");
});

// --- The two-fetch claim: checksums.txt goes through the proxy too ---------

test("the checksums fetch is routed through the proxy, not only the binary", async () => {
  // Since tan-cli#176 the install REFUSES if `checksums.txt` cannot be fetched.
  // If that fetch ever stopped sharing the binary's ProxyConfig, a corporate
  // host would download the binary fine and then refuse to install it, blaming
  // a network that was only half-used. `download.ts` asserts this in a comment;
  // this is the gate underneath it.
  const asset = Buffer.from("the real tan binary\n");
  const digest = crypto.createHash("sha256").update(asset).digest("hex");
  const manifest = `${digest}  tan-x86_64.exe\n`;
  await withOrigin(async (origin) => {
    await withProxy(
      {
        request: (req, res) => {
          const body = req.url.endsWith("/checksums.txt")
            ? Buffer.from(manifest)
            : asset;
          res.writeHead(200, { "content-length": String(body.length) });
          res.end(body);
        },
      },
      async (proxyUrl, seen) => {
        const { dest } = tmpDest();
        await downloadFile(
          `${origin}/asset`,
          dest,
          {
            assetName: "tan-x86_64.exe",
            checksumsUrl: `${origin}/checksums.txt`,
          },
          { proxy: { proxy: proxyUrl, env: {} } },
        );
        assert.deepEqual(fs.readFileSync(dest), asset);
        // BOTH fetches went through the proxy, and the checksums one came
        // FIRST — a release with no usable checksum costs no transfer at all.
        assert.deepEqual(seen.requests, [
          `${origin}/checksums.txt`,
          `${origin}/asset`,
        ]);
      },
    );
  });
});
