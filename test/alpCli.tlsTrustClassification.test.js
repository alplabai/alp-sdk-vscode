// SPDX-License-Identifier: Apache-2.0
//
// Which failures inside the proxy tunnel mean "the TLS peer was not trusted".
//
// This classification decides which of two remedies the customer is handed, and
// they are not interchangeable:
//
//   trusted-failure  -> "install that certificate, or turn off the
//                        http.proxyStrictSSL setting to accept it"
//   everything else  -> "Couldn't reach the proxy <addr> — ... check the
//                        http.proxy setting"
//
// Getting it wrong sends someone behind a working TLS-inspecting proxy to
// debug their http.proxy value. That is exactly what happened: the classifier
// tested `error.code` against /CERT|SSL|TLS/ and nothing else, and Node spells
// ONE condition three ways. Two of the three have no CERT, SSL or TLS substring
// in the code at all, so they took the wrong branch — intermittently for the
// alert (#511's flake) and every single time for the chain error.
//
// The table below is the record of which spellings exist. It is a unit test
// because the CHAIN verdicts cannot be produced end to end: reaching
// UNABLE_TO_VERIFY_LEAF_SIGNATURE or UNSPECIFIED for real needs a live TLS
// server with an untrusted certificate, and there is no certificate fixture in
// this repo. (The two alert spellings ARE reachable, and both have an
// end-to-end test in alpCli.downloadProxy.test.js.)

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isTlsTrustFailure,
  isNonTlsTunnelAnswer,
} = require("../out/alpCli/download.js");

/** An error shaped the way Node hands one to a `request.on("error")` listener. */
function nodeError(code, message) {
  const error = new Error(message);
  if (code !== null) error.code = code;
  return error;
}

// The OpenSSL text Node puts in the message when the alert is discovered while
// completing the client's own pending write. Kept verbatim from a captured
// failure: the code says EPROTO and ONLY the message says TLS.
const EPROTO_MESSAGE =
  "write EPROTO 80DD7AF601000000:error:0A000410:SSL routines:ssl3_read_bytes:" +
  "ssl/tls alert handshake failure:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:918:" +
  "SSL alert number 40";

const TRUSTED_FAILURES = [
  [
    "ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE",
    "the READ path — the alert arrived as its own readable event",
  ],
  ["EPROTO", "the WRITE path — same alert, discovered completing a write"],
  [
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "an incomplete chain — the classic TLS-inspecting proxy, and the one " +
      "OpenSSL verify code with no CERT/SSL/TLS substring in it",
  ],
  ["SELF_SIGNED_CERT_IN_CHAIN", "a private CA"],
  ["DEPTH_ZERO_SELF_SIGNED_CERT", "a bare self-signed leaf"],
  ["CERT_HAS_EXPIRED", "an expired re-signing certificate"],
  ["ERR_TLS_CERT_ALTNAME_INVALID", "the re-signed name does not match"],
  ["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "the issuer is not installed here"],
  // Verify verdicts that carry no CERT/SSL/TLS substring, so a code-substring
  // test cannot see them. Each is a chain judgement a re-signing appliance
  // provokes — a CA certificate without `basicConstraints CA:TRUE`, a leaf
  // without the `serverAuth` EKU, a pathlen violation — and installing the
  // proxy's certificate is the remedy for each.
  ["INVALID_CA", "the re-signing certificate is not a valid CA"],
  ["INVALID_PURPOSE", "the certificate is not valid for server auth"],
  ["PATH_LENGTH_EXCEEDED", "the re-signed chain is longer than pathlen allows"],
  ["HOSTNAME_MISMATCH", "the re-signed name does not match, OpenSSL spelling"],
  ["UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY", "a malformed issuer key"],
  // OpenSSL's catch-all, and NOT a corner case: a CA still signing with SHA-1
  // arrives here with "CA signature digest algorithm too weak". An allowlist
  // written from the interesting-looking names missed it, and a real chain
  // built for review proved the miss — the reader got sent to debug
  // http.proxy for an out-of-date corporate CA.
  ["UNSPECIFIED", "OpenSSL's catch-all, e.g. a SHA-1 signed CA"],
];

for (const [code, why] of TRUSTED_FAILURES) {
  test(`${code} is a trust failure — ${why}`, () => {
    const message = code === "EPROTO" ? EPROTO_MESSAGE : `some ${code} text`;
    assert.equal(isTlsTrustFailure(nodeError(code, message)), true);
  });
}

// The other direction matters just as much, and it is the direction with teeth:
// the remedy this branch unlocks is "turn off http.proxyStrictSSL". Handing
// that to someone whose proxy is simply down or unreachable tells them to
// loosen TLS verification to fix a problem it has nothing to do with.
const NOT_TRUST_FAILURES = [
  ["ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:8080", "the proxy is down"],
  ["ENOTFOUND", "getaddrinfo ENOTFOUND proxy.invalid", "the name is wrong"],
  ["ECONNRESET", "socket hang up", "the peer went away mid-flight"],
  ["EPIPE", "write EPIPE", "we wrote to a closed socket"],
  [
    "ETIMEDOUT",
    "Timed out downloading https://example.com/tan.tar.gz",
    "the idle timer fired",
  ],
  [
    null,
    "Timed out downloading https://example.com/tan.tar.gz",
    "a code-less timeout must not be read as a certificate problem either",
  ],
];

for (const [code, message, why] of NOT_TRUST_FAILURES) {
  test(`${code ?? "(no code)"} is NOT a trust failure — ${why}`, () => {
    assert.equal(isTlsTrustFailure(nodeError(code, message)), false);
  });
}

test("a message mentioning a certificate does not override a transport errno", () => {
  // The message check is deliberately reachable only when the code says
  // nothing useful (EPROTO, or absent). A proxy whose HOSTNAME happens to
  // contain the word "certificate" must not talk us into the cert branch.
  assert.equal(
    isTlsTrustFailure(
      nodeError("ECONNREFUSED", "connect ECONNREFUSED certificate-proxy.corp"),
    ),
    false,
  );
});

test("the same gate holds in the other direction", () => {
  // The mirror of the case above, and the one that was missing: a transport
  // errno whose message happens to carry a non-TLS-answer phrase. Ungated, the
  // message arm would fire first and route a dead proxy — or worse, a real
  // certificate verdict — into the "TLS layer failed" sentence.
  assert.equal(
    isNonTlsTunnelAnswer(
      nodeError("ECONNREFUSED", "connect ECONNREFUSED bad-record-mac.corp"),
    ),
    false,
  );
  assert.equal(
    isNonTlsTunnelAnswer(
      nodeError("CERT_HAS_EXPIRED", "certificate has expired: bad record mac"),
    ),
    false,
    "an explicit certificate verdict must not be overridden by its own prose",
  );
  assert.equal(
    isTlsTrustFailure(
      nodeError("CERT_HAS_EXPIRED", "certificate has expired: bad record mac"),
    ),
    true,
  );
});

// ── The tunnel answered, but not in TLS ─────────────────────────────────────
//
// A TLS-LAYER failure is not a verdict on a certificate, and conflating the two
// produces advice that is both useless and unsafe. A proxy that opens the
// tunnel and then puts you through to a plain-http listener — or a filtering
// appliance that answers in the origin's place — makes the handshake fail with
// `ERR_SSL_WRONG_VERSION_NUMBER`, which contains `SSL` and so lands on the
// certificate branch. `rejectUnauthorized: false` cannot make a peer that is
// not speaking TLS speak it, so "turn off http.proxyStrictSSL" fixes nothing —
// and `http.proxyStrictSSL` is a GLOBAL VS Code setting, so a user who follows
// that advice, still fails, and leaves it off has loosened every extension's
// traffic for a problem it never touched.
//
// FOUR of these were already on the wrong branch before the classifier was
// extracted — every `ERR_SSL_*` row carries `SSL`, so the old
// `/CERT|SSL|TLS/.test(code)` claimed them all. Only the `EPROTO` + "wrong
// version number" row was new, introduced by the message check, and this table
// is what caught it.
const NOT_TLS_TUNNEL_ANSWERS = [
  [
    "ERR_SSL_WRONG_VERSION_NUMBER",
    "wrong version number",
    "a plain-http listener answered the handshake",
  ],
  [
    "EPROTO",
    "write EPROTO ...:SSL routines:ssl3_get_record:wrong version number:...",
    "the same thing, discovered completing the ClientHello write",
  ],
  [
    "ERR_SSL_UNSUPPORTED_PROTOCOL",
    "unsupported protocol",
    "an appliance too old to speak our TLS version",
  ],
  [
    "ERR_SSL_PACKET_LENGTH_TOO_LONG",
    "packet length too long",
    "HTTP bytes parsed as a TLS record",
  ],
  [
    "ERR_SSL_BAD_RECORD_MAC",
    "bad record mac",
    "a broken interceptor corrupting the stream",
  ],
];

for (const [code, message, why] of NOT_TLS_TUNNEL_ANSWERS) {
  test(`${code} (${message.slice(0, 24)}…) is a non-TLS tunnel answer — ${why}`, () => {
    const error = nodeError(code, message);
    assert.equal(isNonTlsTunnelAnswer(error), true);
    // And it must NOT also read as a trust failure: that is the branch that
    // tells someone to turn off certificate verification.
    assert.equal(
      isTlsTrustFailure(error),
      false,
      "a TLS-layer failure is not a certificate verdict",
    );
  });
}

test("a real certificate verdict is not mistaken for a non-TLS answer", () => {
  // The carve-out must not swallow the branch it was carved out of.
  for (const [code] of TRUSTED_FAILURES) {
    const message = code === "EPROTO" ? EPROTO_MESSAGE : `some ${code} text`;
    assert.equal(
      isNonTlsTunnelAnswer(nodeError(code, message)),
      false,
      `${code} is a certificate verdict, not a non-TLS answer`,
    );
  }
});

test("a transport failure is neither", () => {
  for (const [code, message] of NOT_TRUST_FAILURES) {
    const error = nodeError(code, message);
    assert.equal(isNonTlsTunnelAnswer(error), false, `${code}`);
    assert.equal(isTlsTrustFailure(error), false, `${code}`);
  }
});

test("a non-Error rejection is classified, not thrown on", () => {
  assert.equal(isNonTlsTunnelAnswer("just a string"), false);
  assert.equal(isNonTlsTunnelAnswer(null), false);
  assert.equal(isNonTlsTunnelAnswer(undefined), false);
  // `request.on("error")` is typed as Error, but nothing enforces it at
  // runtime, and a classifier that throws would replace a bad message with a
  // crash in the middle of a failed download.
  assert.equal(isTlsTrustFailure("just a string"), false);
  assert.equal(isTlsTrustFailure(null), false);
  assert.equal(isTlsTrustFailure(undefined), false);
});
