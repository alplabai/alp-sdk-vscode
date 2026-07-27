// SPDX-License-Identifier: Apache-2.0
//
// Atomic, completeness-checked HTTP(S) download for the managed `tan` binary.
// No `vscode` import — unit-testable under `node --test` against a local http
// server.
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
import * as path from "path";
import { pipeline } from "stream/promises";

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

const MAX_REDIRECTS = 5;
// Resets on every byte received — catches a connection that goes silent
// mid-transfer (the "progress notification spins forever" symptom).
const IDLE_TIMEOUT_MS = 30_000;
// Does NOT reset on activity — catches a connection that stays alive but
// dribbles bytes slowly enough to keep beating the idle timeout forever.
const WALL_CLOCK_TIMEOUT_MS = 120_000;

/** GET `url`, following redirects (capped) and enforcing an idle timeout.
 *  `signal` (the caller's cancellation, if any) is combined with the wall-clock
 *  timeout rather than replacing it, so a user cancel and a stalled server both
 *  abort the same in-flight request. */
function get(url: string, signal?: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const wallClock = AbortSignal.timeout(WALL_CLOCK_TIMEOUT_MS);
    const request = client.get(
      url,
      { signal: signal ? AbortSignal.any([wallClock, signal]) : wallClock },
      resolve,
    );
    request.setTimeout(IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error(`Timed out downloading ${url}`));
    });
    request.on("error", reject);
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
  signal?: AbortSignal,
): Promise<void> {
  const response = await get(url, signal);
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
    return attempt(next, destFile, requireHttps, redirectsLeft - 1, signal);
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
 */
export function downloadFile(
  url: string,
  destFile: string,
  signal?: AbortSignal,
): Promise<void> {
  sweepLeftovers(destFile);
  return attempt(
    url,
    destFile,
    url.startsWith("https:"),
    MAX_REDIRECTS,
    signal,
  );
}
