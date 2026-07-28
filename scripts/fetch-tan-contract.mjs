#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Fetch tan's published envelope contract for the version this extension pins,
// so `test/tanContract.test.js` can diff against the PRODUCER's artefact rather
// than a fixture hand-copied into this repo. A hand-copied corpus drifts in
// exactly the way the thing it is testing drifts, which is why this fetches.
//
// The artefact does not exist yet, though the producer does: `alplabai/tan-cli#106`
// is MERGED and `release.yml` attaches `envelope-contract.json` to every tagged
// release. The missing piece is a TAG -- no tan release has been cut since #106
// landed, and the newest one (v0.3.1) predates it. So the 404 path is the normal
// path today, and the one thing it must never do is look like a pass. FOUR outcomes, four messages, and
// the log must never let two of them read the same:
//
//   * 404            → `::warning::` naming the pin, the URL and the issue,
//                      exit 0. NOT PUBLISHED — a known state of the world. The
//                      test then SKIPS with the same three facts in its reason,
//                      so a green CI run still says out loud that this gate
//                      checked nothing.
//   * 403/408/429,   → a DISTINCT `::warning::`, exit 0. COULD NOT CHECK — a
//     any 5xx, a         failure to find out, which is a different fact from
//     network error,     "nothing is published" and must not be worded like it.
//     a timeout          Exit 0 because a GitHub rate-limit or outage is not a
//                      defect in this repo, and reddening every PR on a gate
//                      that today cannot verify anything trains people to
//                      ignore it. (`check-extension-deps.mjs` tolerates
//                      registry downtime for the same reason.)
//   * any other      → `::error::`, exit 1. A 400 or a 451 on a public
//     non-OK status      release-asset URL is neither "not published" nor
//                      "GitHub was busy", and sweeping it into either warning
//                      would file it as a fact it is not.
//   * 200, not JSON  → `::error::`, exit 1. That is a real contract violation:
//                      the asset exists and is malformed. Availability had
//                      nothing to do with it.
//
// (A pin that cannot be resolved out of `src/alpCli/service.ts` at all is a
// fifth `::error::`, below — it means this script's own assumption about the
// repo broke, not anything about tan.)
//
// Not a `node --test` file on purpose: this is the only part that touches the
// network, and keeping it out of the test run leaves `test/tanContract.test.js`
// pure and offline.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO = "alplabai/tan-cli";
const ASSET = "envelope-contract.json";
const ISSUE = `${REPO}#106`;
// Anchored to this file, never to the CWD: a CWD-relative path throws an
// uncaught ENOENT the moment the script runs from anywhere but the repo root,
// which reaches the developer BEFORE — and instead of — the `::error::` below.
const ROOT = path.join(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "test", "golden", "tan-contract");
const TIMEOUT_MS = 15_000;

// The same grep release-vsix.yml uses to resolve the pin (its "Resolve pinned
// CLI version" step). Deliberately re-derived from the source of truth instead
// of duplicated into a second constant that could drift from it.
const PIN_SOURCE = path.join(ROOT, "src", "alpCli", "service.ts");
const pin = /SUPPORTED_CLI_VERSION = "([0-9]+\.[0-9]+\.[0-9]+)"/.exec(
  readFileSync(PIN_SOURCE, "utf8"),
)?.[1];
if (!pin) {
  console.error(
    `::error::Could not resolve SUPPORTED_CLI_VERSION from ${PIN_SOURCE}`,
  );
  process.exit(1);
}

const url = `https://github.com/${REPO}/releases/download/v${pin}/${ASSET}`;
const why = (error) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * COULD NOT CHECK. Deliberately worded so it cannot be misread as the 404's
 * "not published": those are different facts, and a log that conflates them
 * turns a rate-limit into evidence that no release publishes the asset. Exit 0 -- see the
 * header. Any corpus already on disk is LEFT ALONE, because the right corpus
 * for this pin surviving an outage is the good case; the VERSION stamp test
 * reds if it belongs to a different pin.
 */
function couldNotCheck(what) {
  console.warn(
    `::warning::COULD NOT CHECK tan's envelope contract for the pinned v${pin}: ${what}. ` +
      `This is NOT "no contract is published" — that answer is a 404 and says so — it is a ` +
      `failure to find out at all, at ${url}. The envelope-contract test will SKIP, so ` +
      `nothing verified that tan still emits the envelope this extension parses. Re-run ` +
      `\`pnpm run contract:fetch\` when the network settles.`,
  );
  console.log(
    `envelope contract: could not check v${pin} (${what}). Gate skipped, not passed.`,
  );
  process.exit(0);
}

let response;
try {
  response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
} catch (error) {
  couldNotCheck(`could not reach it — ${why(error)}`);
}

if (response.status === 404) {
  // Drop any corpus left from an earlier pin. Keeping it would leave the test
  // asserting a contract belonging to a DIFFERENT tan than the one pinned now —
  // a red that reads like drift when the real fact is "nothing is published for
  // this pin". CI checks out fresh (the directory is gitignored), so this only
  // ever fires on a developer machine after a pin bump.
  rmSync(OUT_DIR, { recursive: true, force: true });
  console.warn(
    `::warning::No ${ASSET} published for the pinned tan v${pin} (404 at ${url}). ` +
      `The producer (${ISSUE}) is MERGED and publishes it on every tagged release; no tan ` +
      `release has been cut since. The envelope-contract test will SKIP, ` +
      `so nothing verified that tan still emits the envelope this extension parses.`,
  );
  console.log(
    `envelope contract: not published for v${pin} — see ${ISSUE}. Gate skipped, not passed.`,
  );
  process.exit(0);
}

// GitHub rate-limits unauthenticated downloads (403/429) and has outages (5xx).
// None of those says anything about the contract, so none of them may red a PR.
if ([403, 408, 429].includes(response.status) || response.status >= 500) {
  couldNotCheck(`HTTP ${response.status} ${response.statusText}`);
}

// Everything else non-OK is genuinely unexpected on a public release-asset URL
// (a 400, a 451), so it keeps its red rather than being swept into either
// warning: neither "not published" nor "GitHub was busy" would be true.
if (!response.ok) {
  console.error(
    `::error::${url} returned an unexpected HTTP ${response.status} ${response.statusText}. ` +
      `A 404 means "not published yet" and 403/408/429/5xx mean "could not check"; this is ` +
      `neither, and must not be filed as either.`,
  );
  process.exit(1);
}

let body;
try {
  // The signal above bounds the BODY read too, not just the headers — driven
  // against a server that sends headers then stalls, this rejects at
  // TIMEOUT_MS. Caught rather than left to reject uncaught: a stalled body is
  // availability, and an uncaught stack trace is neither of the two warnings.
  body = await response.text();
} catch (error) {
  couldNotCheck(`the response body never finished — ${why(error)}`);
}

try {
  JSON.parse(body);
} catch (error) {
  // A hard red, like the unexpected-status branch above and unlike the three
  // that warn: the asset EXISTS and is malformed. That is a contract violation,
  // and availability had nothing to do with it.
  console.error(
    `::error::${url} returned HTTP 200 but the body is not JSON: ${why(error)}. ` +
      `The asset is published and malformed — that is a contract violation, not an ` +
      `availability problem, so it fails the build rather than warning.`,
  );
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, ASSET), body);
// One-line stamp of the pin this corpus was fetched FOR. The test asserts it
// still equals SUPPORTED_CLI_VERSION, which is what catches a pin bump on a
// developer machine where the refresh was never re-run.
writeFileSync(path.join(OUT_DIR, "VERSION"), `${pin}\n`);
console.log(
  `envelope contract: fetched ${ASSET} for tan v${pin} (${body.length} bytes) → ${OUT_DIR}`,
);
