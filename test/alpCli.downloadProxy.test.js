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
