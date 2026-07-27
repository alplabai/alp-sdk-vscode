// SPDX-License-Identifier: Apache-2.0
//
// Atomic, completeness-checked HTTP(S) download for the managed `tan` binary,
// proxy-aware (Node is not — see `ProxyConfig`). No `vscode` import —
// unit-testable under `node --test` against a local http server, including a
// local proxy stub. VS Code settings therefore arrive as a plain object from
// `vscodeAdapter.ts`; only `process.env` is read directly.
//
// An interrupted transfer must never leave a truncated binary at the final
// destination: `resolveAlpBinary` trusts whatever already exists there (the
// "cached" source), so a half-written file would spawn a dead binary forever
// with no self-heal. The body is written to a unique temp file beside the
// destination and only renamed into place once the byte count is non-zero and
// agrees with `content-length` (when the server sends one). That proves the
// transfer completed, not that the bytes are the right binary — there's no
// checksum/signature check here (the `.tar.gz` flow this replaced had an
// implicit gzip CRC and nothing replaces that either; tan-cli publishing a
// checksum is tracked separately, alplabai/tan-cli#7).

import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as path from "path";
import { pipeline } from "stream/promises";
import * as tls from "tls";

/**
 * The installed binary could not be moved aside under ANY name, so the update
 * cannot land: a live process is holding it open.
 *
 * A distinct type rather than a string the caller sniffs, because the caller
 * must present this one BACKWARDS from every other download failure — nothing
 * changes until the holder exits, so "Retry" re-runs the identical rename for
 * the identical result (see `src/alpCli/vscodeAdapter.ts`).
 *
 * `message` is the CUSTOMER sentence and stays clean on purpose: `planFailure`
 * (`src/notify/service.ts`) demotes a `cause` carrying an errno or an absolute
 * path into the channel and replaces the toast with a generic
 * "<operation> failed." — which is exactly the toast this type exists to
 * prevent. The raw errno rides on `detail`, which the caller passes to
 * `planFailure.detail` (channel only).
 */
export class CliInUseError extends Error {
  /** Raw `EBUSY: resource busy or locked, rename …` text — channel only. */
  readonly detail: string;

  constructor(detail: string) {
    super(
      "The tan CLI that's already installed is in use, so it can't be replaced. " +
        "Close any other VS Code windows using it, let any running build finish, " +
        "then reload this window.",
    );
    this.name = "CliInUseError";
    this.detail = detail;
  }
}

/**
 * The download never reached the release host: a proxy sits in the way and the
 * hop to (or through) it failed.
 *
 * A distinct type for exactly the reason `CliInUseError` is one — the caller
 * (`src/alpCli/vscodeAdapter.ts`) has to present it differently. Every other
 * download failure funnels into "Couldn't download the tan CLI … retry when
 * you're back online", which on a corporate-proxy machine sends the customer to
 * check their Wi-Fi for a problem their proxy caused, and reads as "the tan CLI
 * is broken".
 *
 * `message` is the CUSTOMER sentence. It names the proxy's `host:port` and
 * NEVER its `user:password@` (see `redactProxy`), and it carries no errno and
 * no scheme-bearing URL: `planFailure` (`src/notify/service.ts`) demotes a
 * `cause` containing either into the output channel and replaces the toast with
 * a generic "<operation> failed." — and its absolute-path guard reads the `p:/`
 * inside `http://` as a path, so a bare `http://host` in the sentence is enough
 * to lose the whole message. The raw errno/status rides on `detail`, which the
 * caller passes to `planFailure.detail` (channel only).
 */
export class ProxyError extends Error {
  /** Raw errno / CONNECT status — channel only. Credential-free by
   *  construction: the userinfo is only ever put in a request header. */
  readonly detail: string;

  constructor(message: string, detail: string) {
    super(message);
    this.name = "ProxyError";
    this.detail = detail;
  }
}

/**
 * Proxy configuration for one download.
 *
 * VS Code's own settings (`http.proxy`, `http.proxyStrictSSL`) are read in the
 * ADAPTER (`src/alpCli/vscodeAdapter.ts`) and passed in, because this file must
 * not import `vscode` — see the header. The proxy ENVIRONMENT variables are
 * read HERE instead, straight from `process.env`, which is not `vscode` and so
 * costs nothing to keep local; `env` exists only so the tests can drive that
 * resolution without mutating the process.
 */
export interface ProxyConfig {
  /** VS Code `http.proxy`. Wins over the environment when non-empty: a user
   *  who set it did so deliberately. */
  proxy?: string;
  /** VS Code `http.proxyStrictSSL` (default true) → TLS `rejectUnauthorized`. */
  strictSSL?: boolean;
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

const MAX_REDIRECTS = 5;
// Resets on every byte received — catches a connection that goes silent
// mid-transfer (the "progress notification spins forever" symptom).
const IDLE_TIMEOUT_MS = 30_000;
// Does NOT reset on activity — catches a connection that stays alive but
// dribbles bytes slowly enough to keep beating the idle timeout forever.
const WALL_CLOCK_TIMEOUT_MS = 120_000;

/** A proxy's `host:port`, with any `user:password@` stripped AND without the
 *  scheme. Every user-visible mention of a proxy goes through this: the output
 *  channel is something customers paste into issue reports, so the credential
 *  must never reach a message, a throw, or a log line. The scheme is dropped
 *  too because `planFailure`'s raw-text guard reads the `p:/` of `http://` as
 *  an absolute path and would demote the whole sentence into the channel. */
function redactProxy(proxy: URL): string {
  return proxy.host;
}

/** `NO_PROXY` / `no_proxy`. Comma- or whitespace-separated; `*` bypasses
 *  everything; a leading dot is a suffix match (`.example.com` also matches
 *  `example.com`); an entry may carry an explicit `:port` that must match.
 *  Applied whichever source the proxy came from — a host the user excluded is
 *  excluded, which is what curl, git and pip all do. */
function bypassesProxy(target: URL, noProxy: string): boolean {
  const host = target.hostname.toLowerCase();
  const port = target.port || (target.protocol === "https:" ? "443" : "80");
  return noProxy
    .split(/[,\s]+/)
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      let pattern = entry.toLowerCase();
      const colon = pattern.lastIndexOf(":");
      if (colon > 0 && /^\d+$/.test(pattern.slice(colon + 1))) {
        if (pattern.slice(colon + 1) !== port) return false;
        pattern = pattern.slice(0, colon);
      }
      pattern = pattern.replace(/^\./, "");
      return (
        pattern !== "" && (host === pattern || host.endsWith(`.${pattern}`))
      );
    });
}

/** The proxy to route `target` through, or null for a direct connection.
 *
 *  Throws when a proxy IS configured but unparseable: going direct instead
 *  would fail (or hang) with a message that never mentions the proxy, which is
 *  the whole defect this exists to fix. The offending value is NOT echoed — it
 *  may carry credentials. */
function proxyForUrl(target: URL, config: ProxyConfig): URL | null {
  const env = config.env ?? process.env;
  const fromEnv =
    target.protocol === "https:"
      ? (env.HTTPS_PROXY ?? env.https_proxy)
      : (env.HTTP_PROXY ?? env.http_proxy);
  // Trim BEFORE choosing, not after: a whitespace-only `http.proxy` is truthy,
  // so trimming afterwards would let it beat a real HTTPS_PROXY and then
  // resolve to "no proxy at all".
  const raw = config.proxy?.trim() || fromEnv?.trim() || "";
  if (!raw) return null;
  if (bypassesProxy(target, env.NO_PROXY ?? env.no_proxy ?? "")) return null;
  try {
    // A bare `host:port` with no scheme is a common spelling in both the
    // setting and the environment; default it to http, as every other client
    // does.
    return new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`,
    );
  } catch {
    throw new ProxyError(
      "The configured proxy is not a valid URL, so the tan CLI can't be " +
        "downloaded. Fix the http.proxy setting, or the HTTPS_PROXY / " +
        "HTTP_PROXY environment variable.",
      "unparseable proxy URL — value withheld, it may carry credentials",
    );
  }
}

/** Transport for the hop TO the proxy. An `https://` proxy means that hop is
 *  itself TLS; the tunnel carried inside it is unaffected. */
function proxyTransport(proxy: URL): typeof http | typeof https {
  return proxy.protocol === "https:" ? https : http;
}

function proxyPort(proxy: URL): number {
  return Number(proxy.port || (proxy.protocol === "https:" ? 443 : 80));
}

/** `Proxy-Authorization` for a `user:password@` proxy URL. This header is the
 *  ONLY place the credential is ever allowed to appear. */
function proxyAuthHeader(proxy: URL): Record<string, string> {
  if (!proxy.username && !proxy.password) return {};
  const raw = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return {
    "proxy-authorization": `Basic ${Buffer.from(raw).toString("base64")}`,
  };
}

/** A cancel (user) or a timeout (wall clock) must travel unchanged — the caller
 *  branches on it, and neither is a proxy fault. */
function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/** A transport failure on the hop to the proxy. Names the proxy so the failure
 *  cannot read as "the tan CLI is broken"; the errno stays off the sentence and
 *  travels on `detail`. */
function proxyUnreachable(error: unknown, proxy: URL): Error {
  // Already classified — a `request.destroy(new ProxyError(…))` comes back
  // through the request's own "error" event, and re-wrapping it would replace
  // a precise sentence with a generic one.
  if (isAbort(error) || error instanceof ProxyError) return error as Error;
  const code = String((error as NodeJS.ErrnoException)?.code ?? "");
  const why =
    code === "ENOTFOUND"
      ? "its host name could not be resolved"
      : code === "ECONNREFUSED"
        ? "it refused the connection"
        : code === "ETIMEDOUT" ||
            code === "EHOSTUNREACH" ||
            code === "ENETUNREACH"
          ? "it did not respond"
          : "the connection to it failed";
  return new ProxyError(
    `Couldn't reach the proxy ${redactProxy(proxy)} — ${why}. The tan CLI ` +
      `download is routed through it, so check the http.proxy setting, or ` +
      `the HTTPS_PROXY / HTTP_PROXY environment variable.`,
    `${code || "proxy transport failure"}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** The proxy answered the CONNECT with a non-2xx: it reached us, and refused.
 *  407 gets its own sentence because "proxy authentication required" is the
 *  single most common corporate cause and the remedy is completely different
 *  from a retry. */
function connectRefused(status: number, proxy: URL): ProxyError {
  const at = redactProxy(proxy);
  if (status === 407) {
    return new ProxyError(
      `The proxy ${at} requires authentication and refused the tan CLI ` +
        `download with HTTP 407. Give it credentials by writing the proxy as ` +
        `user:password@host:port in the http.proxy setting, or ask whoever ` +
        `runs the proxy to allow this host.`,
      `CONNECT returned HTTP 407 from ${at}`,
    );
  }
  return new ProxyError(
    `The proxy ${at} refused the tan CLI download with HTTP ${status}. Ask ` +
      `whoever runs the proxy to allow this host, or point the http.proxy ` +
      `setting at a proxy that permits it.`,
    `CONNECT returned HTTP ${status} from ${at}`,
  );
}

/** A failure on the tunnelled request. It happened INSIDE the proxy's tunnel,
 *  so it is reported as a proxy failure — but a certificate rejection gets its
 *  own remedy, because a TLS-inspecting proxy is the common cause and
 *  `http.proxyStrictSSL` is the switch that accepts it. */
function tunnelFailure(error: unknown, proxy: URL): Error {
  if (isAbort(error) || error instanceof ProxyError) return error as Error;
  const code = String((error as NodeJS.ErrnoException)?.code ?? "");
  if (/CERT|SSL|TLS/.test(code)) {
    return new ProxyError(
      `The secure connection through the proxy ${redactProxy(proxy)} was ` +
        `rejected: the certificate it served isn't trusted here. A ` +
        `TLS-inspecting proxy re-signs traffic with its own certificate — ` +
        `install that certificate on this machine, or turn off the ` +
        `http.proxyStrictSSL setting to accept it.`,
      `${code}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return proxyUnreachable(error, proxy);
}

/** Idle-timeout arming, shared by every request shape below. */
function armIdleTimeout(request: http.ClientRequest, what: string): void {
  request.setTimeout(IDLE_TIMEOUT_MS, () => {
    request.destroy(new Error(`Timed out downloading ${what}`));
  });
}

/** CONNECT through `proxy`, then run the real https GET over the tunnelled
 *  socket. No proxy-agent dependency: `http.request({ method: "CONNECT" })`
 *  hands back the raw socket, `tls.connect({ socket })` wraps it, and
 *  `createConnection` (valid ONLY when no `agent` is passed — with `agent:
 *  false` Node builds a fresh Agent and ignores it) hands that to https. */
function tunnelledGet(
  url: string,
  target: URL,
  proxy: URL,
  config: ProxyConfig,
  signal: AbortSignal,
): Promise<http.IncomingMessage> {
  const authority = `${target.hostname}:${target.port || 443}`;
  return new Promise((resolve, reject) => {
    const connect = proxyTransport(proxy).request({
      host: proxy.hostname,
      port: proxyPort(proxy),
      method: "CONNECT",
      path: authority,
      headers: { host: authority, ...proxyAuthHeader(proxy) },
      rejectUnauthorized: config.strictSSL !== false,
      signal,
    });
    // A proxy that accepts the TCP connection and then never answers the
    // CONNECT is still a proxy failure, and has to say so — the generic
    // "Couldn't download the tan CLI" is what this whole path exists to avoid.
    connect.setTimeout(IDLE_TIMEOUT_MS, () => {
      connect.destroy(
        new ProxyError(
          `The proxy ${redactProxy(proxy)} accepted the connection but never ` +
            `answered, so the tan CLI download stalled. Check the http.proxy ` +
            `setting, or the HTTPS_PROXY / HTTP_PROXY environment variable.`,
          `no CONNECT response within ${IDLE_TIMEOUT_MS} ms`,
        ),
      );
    });
    connect.on("error", (error) => reject(proxyUnreachable(error, proxy)));
    // Node marks EVERY response to a CONNECT as an upgrade, so a 407 arrives
    // here too rather than on "response" — the status check is what catches it.
    connect.on("connect", (response, socket, head) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status > 299) {
        socket.destroy();
        reject(connectRefused(status, proxy));
        return;
      }
      // Anything that arrived in the same segment as the "200 Connection
      // Established" was consumed as `head` by the http parser — it is the
      // tunnel's first bytes, not part of the response, so it has to go back
      // on the stream or the TLS handshake sits waiting for a ServerHello it
      // has already been sent.
      if (head && head.length > 0) {
        socket.unshift(head);
      }
      // Drop the CONNECT's idle timer: the socket now belongs to the tunnel,
      // and the inner request arms its own.
      socket.setTimeout(0);
      const request = https.request(
        url,
        {
          signal,
          createConnection: () =>
            tls.connect({
              socket,
              // `host` is what the certificate is checked AGAINST, and it is
              // not optional here: with no `host` and no `servername`,
              // `tls.connect` falls back to the wrapped socket's own `_host`
              // — which is the PROXY. The origin's certificate would then be
              // verified against the proxy's hostname, so every legitimate
              // proxied download fails the name check.
              host: target.hostname,
              // SNI, separately, must be a DNS name — Node THROWS
              // ERR_INVALID_ARG_VALUE for an IP literal, so an IP-hosted
              // release URL would crash the download instead of fetching it.
              ...(net.isIP(target.hostname)
                ? {}
                : { servername: target.hostname }),
              // Scoped to the tunnel on purpose. `http.proxyStrictSSL` is
              // about trusting a TLS-inspecting proxy; the DIRECT download
              // keeps full verification either way, because this transfer has
              // no checksum or signature of its own (see the header) and TLS
              // is the only thing vouching for the bytes.
              rejectUnauthorized: config.strictSSL !== false,
            }),
        },
        resolve,
      );
      armIdleTimeout(request, url);
      request.on("error", (error) => {
        // Explicitly, not via the TLS socket's own teardown: this is the RAW
        // socket the proxy handed back, and nothing else owns it. Leaking it
        // holds a half-open connection to the proxy for the life of the
        // window (and hangs any server waiting on it, which is how the tests
        // find a regression here).
        socket.destroy();
        reject(tunnelFailure(error, proxy));
      });
      request.end();
    });
    connect.end();
  });
}

/** GET `url`, following redirects (capped) and enforcing an idle timeout, via
 *  the proxy `config` resolves to for THIS url (so a redirect that lands on a
 *  NO_PROXY host correctly goes direct).
 *  `signal` (the caller's cancellation, if any) is combined with the wall-clock
 *  timeout rather than replacing it, so a user cancel and a stalled server both
 *  abort the same in-flight request. */
function get(
  url: string,
  config: ProxyConfig,
  signal?: AbortSignal,
): Promise<http.IncomingMessage> {
  const target = new URL(url);
  const proxy = proxyForUrl(target, config);
  const wallClock = AbortSignal.timeout(WALL_CLOCK_TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([wallClock, signal]) : wallClock;

  if (!proxy) {
    return new Promise((resolve, reject) => {
      const client = target.protocol === "https:" ? https : http;
      const request = client.get(url, { signal: abort }, resolve);
      armIdleTimeout(request, url);
      request.on("error", reject);
    });
  }
  if (target.protocol === "https:") {
    return tunnelledGet(url, target, proxy, config, abort);
  }
  // Plain http through a proxy needs no tunnel: the proxy takes the request
  // itself, with the absolute-form request URI that tells it where to forward.
  return new Promise((resolve, reject) => {
    const request = proxyTransport(proxy).get(
      {
        host: proxy.hostname,
        port: proxyPort(proxy),
        path: url,
        headers: { host: target.host, ...proxyAuthHeader(proxy) },
        rejectUnauthorized: config.strictSSL !== false,
        signal: abort,
      },
      resolve,
    );
    armIdleTimeout(request, url);
    request.on("error", (error) => reject(proxyUnreachable(error, proxy)));
  });
}

/** Best-effort removal of stale artifacts next to `destFile`: a `*.tmp` left
 *  by an interrupted download (extension host killed mid-transfer), or a
 *  `*.old` left by the rename-aside below when it couldn't be deleted because
 *  the previous binary was still running.
 *
 *  Never throws, per entry: on Windows `rmSync` raises EPERM/EBUSY on a file
 *  that is still running or still has an open handle, and `force` does not
 *  cover that (it only swallows ENOENT). `maxRetries` doesn't help either —
 *  the sharing violation lasts as long as the holder lives, it isn't a race.
 *  This sweep runs before a single byte is fetched, so letting one locked
 *  leftover escape would kill the whole upgrade; it survives to the next
 *  sweep instead. */
function sweepLeftovers(destFile: string): void {
  const dir = path.dirname(destFile);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const prefix = path.basename(destFile);
  for (const entry of entries) {
    if (
      entry.startsWith(prefix) &&
      (entry.endsWith(".tmp") || entry.endsWith(".old"))
    ) {
      try {
        fs.rmSync(path.join(dir, entry), { force: true });
      } catch {
        // Still locked. Leave it; the next sweep gets it.
      }
    }
  }
}

/** Move an existing `destFile` out of the way so the fresh binary can be
 *  renamed into its place.
 *
 *  On Windows, renaming a running executable's file IS permitted — the running
 *  process keeps its handle on the renamed file — so the *source* is never the
 *  problem. The *destination* is: if `<dest>.old` from an earlier update is
 *  itself running (or otherwise held open), the rename fails with a sharing
 *  violation (EBUSY in the field, EPERM in a controlled repro; don't key on the
 *  errno). That is what overwriting in place would hit too, and is the
 *  "EBUSY: resource busy or locked, rename 'tan.exe' -> 'tan.exe.old'" that
 *  blocked upgrades. It is NOT transient while the holder lives, so retrying
 *  the same name is pointless — retry once with a unique name, which no live
 *  process can be holding. `sweepLeftovers` collects it on a later run.
 *
 *  A missing `destFile` (ENOENT) is the first-ever download: expected, silent,
 *  and not a reason to create a uniquely-named nothing. */
function moveAside(destFile: string): void {
  try {
    fs.renameSync(destFile, `${destFile}.old`);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
  }
  try {
    fs.renameSync(destFile, `${destFile}.${process.pid}.${Date.now()}.old`);
  } catch (error) {
    // Genuinely stuck: the binary we're replacing can't be moved at all. Fail
    // loudly rather than silently leaving the customer on the old CLI — and
    // TAGGED, so the caller can drop the useless "Retry" instead of matching
    // on this sentence. The errno stays off the sentence and on `detail`.
    throw new CliInUseError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function attempt(
  url: string,
  destFile: string,
  requireHttps: boolean,
  redirectsLeft: number,
  config: ProxyConfig,
  signal?: AbortSignal,
): Promise<void> {
  const response = await get(url, config, signal);
  const status = response.statusCode ?? 0;

  if (status >= 300 && status < 400 && response.headers.location) {
    response.resume();
    if (redirectsLeft <= 0) {
      throw new Error(`Too many redirects downloading ${url}`);
    }
    const next = new URL(response.headers.location, url).toString();
    if (requireHttps && !next.startsWith("https:")) {
      throw new Error(
        `Refusing to follow an https redirect to a non-https URL: ${next}`,
      );
    }
    return attempt(
      next,
      destFile,
      requireHttps,
      redirectsLeft - 1,
      config,
      signal,
    );
  }

  if (status !== 200) {
    response.resume();
    throw new Error(`Download failed (HTTP ${status}) for ${url}`);
  }

  const expectedLength = response.headers["content-length"]
    ? Number(response.headers["content-length"])
    : null;
  // Unique per-process/per-attempt name so two windows racing on the same
  // destination never share a temp file.
  const tmpFile = `${destFile}.${process.pid}.${Date.now()}.tmp`;
  let received = 0;
  response.on("data", (chunk: Buffer) => {
    received += chunk.length;
  });

  try {
    // `pipeline` destroys both streams and rejects (ERR_STREAM_PREMATURE_CLOSE)
    // if the connection drops before the response ends — this is what catches
    // a server that advertises `content-length` and then closes the socket.
    await pipeline(response, fs.createWriteStream(tmpFile));
    if (received === 0) {
      throw new Error(`Downloaded 0 bytes for ${url}`);
    }
    if (expectedLength !== null && received !== expectedLength) {
      throw new Error(
        `Downloaded ${received} of ${expectedLength} expected bytes for ${url}`,
      );
    }
    if (process.platform !== "win32") {
      // Before the rename, not after: closes the window where the freshly
      // renamed `destFile` briefly exists non-executable and a concurrent
      // window resolving "cached" spawns it and gets EACCES.
      fs.chmodSync(tmpFile, 0o755);
    }
    // Move any existing binary aside instead of overwriting it in place —
    // overwriting a running executable is the EPERM `runAlpInTerminal`
    // mid-build + "Update the tan CLI" collision this exists to avoid.
    moveAside(destFile);
    fs.renameSync(tmpFile, destFile);
  } catch (error) {
    fs.rmSync(tmpFile, { force: true });
    throw error;
  }
}

/**
 * Download `url` to `destFile`. Rejects on a non-200 response, a redirect
 * loop deeper than 5 hops, an https→non-https redirect downgrade, a
 * connection drop mid-transfer, an idle or wall-clock timeout, a byte count
 * that disagrees with `content-length`, or a 0-byte body. Never leaves a
 * partial file at `destFile` — every failure path removes its temp file. Any
 * existing `destFile` is moved aside (`.old`, or a uniquely-suffixed `.old`
 * when that name is locked) rather than overwritten in place, so this is safe
 * even while the previous binary is still running. It rejects with a
 * `CliInUseError` only if both moves fail, which means the installed CLI is
 * genuinely pinned open — the old binary is left working and the message says
 * what to close.
 *
 * Pass `signal` (bridged from a progress notification's CancellationToken) to
 * make the download abortable: the request is destroyed, `pipeline` rejects,
 * and the temp file is removed on the way out, so a cancel leaves no partial
 * binary behind — the same cleanup path every other failure takes.
 *
 * Pass `proxy` (VS Code's `http.proxy` / `http.proxyStrictSSL`, read by the
 * adapter) to route the transfer through a proxy; the `HTTPS_PROXY` /
 * `HTTP_PROXY` / `NO_PROXY` environment variables are honoured with or without
 * it. Node does NOT do this natively, so before this parameter existed a
 * corporate-proxy machine could never download the CLI at all. Anything that
 * fails at the proxy rejects with a `ProxyError` whose sentence says so.
 */
export function downloadFile(
  url: string,
  destFile: string,
  signal?: AbortSignal,
  proxy: ProxyConfig = {},
): Promise<void> {
  sweepLeftovers(destFile);
  return attempt(
    url,
    destFile,
    url.startsWith("https:"),
    MAX_REDIRECTS,
    proxy,
    signal,
  );
}
