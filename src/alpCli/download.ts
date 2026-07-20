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

const MAX_REDIRECTS = 5;
// Resets on every byte received — catches a connection that goes silent
// mid-transfer (the "progress notification spins forever" symptom).
const IDLE_TIMEOUT_MS = 30_000;
// Does NOT reset on activity — catches a connection that stays alive but
// dribbles bytes slowly enough to keep beating the idle timeout forever.
const WALL_CLOCK_TIMEOUT_MS = 120_000;

/** GET `url`, following redirects (capped) and enforcing an idle timeout. */
function get(url: string): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(
      url,
      { signal: AbortSignal.timeout(WALL_CLOCK_TIMEOUT_MS) },
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
 *  the previous binary was still running. Never throws — a leftover that's
 *  still locked just survives to the next sweep. */
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
      fs.rmSync(path.join(dir, entry), { force: true });
    }
  }
}

async function attempt(
  url: string,
  destFile: string,
  requireHttps: boolean,
  redirectsLeft: number,
): Promise<void> {
  const response = await get(url);
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
    return attempt(next, destFile, requireHttps, redirectsLeft - 1);
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
    try {
      // Move any existing binary aside instead of overwriting it in place.
      // On Windows, renaming a running executable's file IS permitted (the
      // running process keeps its handle on the renamed file); overwriting
      // it directly is not — that's the EPERM `runAlpInTerminal` mid-build +
      // "Update the tan CLI" collision this exists to avoid. A missing
      // destFile (first-ever download) is expected and ignored.
      fs.renameSync(destFile, `${destFile}.old`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
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
 * existing `destFile` is moved aside (`.old`) rather than overwritten in
 * place, so this is safe even while the previous binary is still running.
 */
export function downloadFile(url: string, destFile: string): Promise<void> {
  sweepLeftovers(destFile);
  return attempt(url, destFile, url.startsWith("https:"), MAX_REDIRECTS);
}
