#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Fetch tan's published envelope contract for the version this extension pins,
// so `test/tanContract.test.js` can diff against the PRODUCER's artefact rather
// than a fixture hand-copied into this repo. A hand-copied corpus drifts in
// exactly the way the thing it is testing drifts, which is why this fetches.
//
// The artefact EXISTS: `alplabai/tan-cli#106` wired `envelope-contract.json`
// into `release.yml`, every tag from v0.4.0-rc1 on carries it, and
// `SUPPORTED_CLI_VERSION` pins v0.4.0.
// So the fetch is the normal path, and whether a failed fetch may be
// tolerated turns on ONE question -- is the PINNED release expected to publish
// the asset? That is not a judgement call and not a comment: it is
// `RELEASES_PREDATING_CONTRACT_ASSET` in `src/alpCli/service.ts`, a closed list
// of the tags cut before #106 landed, read below.
//
//   * pin IS on that list  → nothing is published for it, so there is nothing
//                            to fetch. `::warning::`, exit 0, no request made.
//                            The test then SKIPS with the same fact in its
//                            reason. This is the ONLY tolerated absence.
//   * pin is NOT on it     → the release is expected to carry the asset, so
//     and the fetch fails    every way of not getting it is a FAILURE:
//     for ANY reason         `::error::`, exit 1. A 404, a rate-limit, an
//                            outage and a dead network are different facts
//                            and keep different messages -- but
//                            they share one exit code, because "we did not
//                            verify the contract" is the same outcome for all
//                            four and exiting 0 on any of them is a green run
//                            that verified nothing. That is what this script
//                            used to do.
//   * 200, not JSON        → `::error::`, exit 1, on any pin. The asset exists
//                            and is malformed: a contract violation, not an
//                            availability problem.
//
// (A pin, or the release list, that cannot be resolved out of
// `src/alpCli/service.ts` at all is a further `::error::` below -- it means
// this script's own assumption about the repo broke, not anything about tan.)
//
// Tolerating a rate-limit used to be justified as "reddening every PR on a
// gate that today cannot verify anything trains people to ignore it". That
// held while nothing was published. It stopped holding at v0.4.0: the gate can
// verify something now, so a run that skips it is a run missing a check, and
// the honest signal for that is red.
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

// The same grep release-vsix.yml and ci.yml use to resolve the pin (their
// "Resolve pinned CLI version" steps). Deliberately re-derived from the source
// of truth instead of duplicated into a second constant that could drift from
// it.
//
// The `(?:-[0-9A-Za-z.-]+)?` suffix accepts a SemVer PRERELEASE pin. That is
// not hypothetical and it is not only the release workflow's problem (#443):
// this script is a gate step in ci.yml on all three runners, so a narrow
// pattern here reds every PR the moment the pin names an rc — before the
// release job the issue was filed against is ever reached. Asserted by
// test/cliPin.prerelease.test.js, which reads this regex out of this file.
const PIN_SOURCE = path.join(ROOT, "src", "alpCli", "service.ts");
const pinSource = readFileSync(PIN_SOURCE, "utf8");
const pin =
  /SUPPORTED_CLI_VERSION = "([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)"/.exec(
    pinSource,
  )?.[1];
if (!pin) {
  console.error(
    `::error::Could not resolve SUPPORTED_CLI_VERSION from ${PIN_SOURCE}`,
  );
  process.exit(1);
}

// Same re-derivation, same reason: one declaration, read by both this script
// and `test/tanContract.test.js`, so the two can never disagree about which
// releases publish the asset.
const predating = /RELEASES_PREDATING_CONTRACT_ASSET[^=]*=\s*\[([^\]]*)\]/
  .exec(pinSource)?.[1]
  ?.match(/"([^"]+)"/g)
  ?.map((quoted) => quoted.slice(1, -1));
if (!predating) {
  console.error(
    `::error::Could not resolve RELEASES_PREDATING_CONTRACT_ASSET from ${PIN_SOURCE}`,
  );
  process.exit(1);
}

const url = `https://github.com/${REPO}/releases/download/v${pin}/${ASSET}`;
const why = (error) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

// The pin predates the producer, so no release publishes an artefact to fetch.
// The only tolerated absence — and it makes no request at all, because a 404 is
// the only answer the URL could give.
//
// Drop any corpus left from an EARLIER pin while here. Keeping it would leave
// the test asserting a contract belonging to a different tan than the one
// pinned now. CI checks out fresh (the directory is gitignored), so this only
// ever fires on a developer machine after a pin bump.
if (predating.includes(pin)) {
  rmSync(OUT_DIR, { recursive: true, force: true });
  console.warn(
    `::warning::tan v${pin} predates ${ASSET} — it is listed in ` +
      `RELEASES_PREDATING_CONTRACT_ASSET (${PIN_SOURCE}), the tags cut before ` +
      `${ISSUE} added the asset to release.yml. Nothing is published at ${url} and ` +
      `nothing was fetched. The envelope-contract test will SKIP, so nothing verified ` +
      `that tan still emits the envelope this extension parses.`,
  );
  console.log(
    `envelope contract: v${pin} predates ${ASSET}. Gate skipped, not passed.`,
  );
  process.exit(0);
}

/**
 * DID NOT VERIFY, for a pin whose release is expected to publish the asset.
 * Exit 1: a 404, a rate-limit and a dead socket are different facts and keep
 * different sentences, but all three end with the contract unverified, and a
 * green run that verified nothing is the defect this whole file exists to stop.
 *
 * Any corpus already on disk is LEFT ALONE — a good corpus for this pin
 * surviving an outage is the good case, and the VERSION stamp test reds if it
 * belongs to a different pin.
 */
function didNotVerify(what) {
  console.error(
    `::error::Could not fetch tan's envelope contract for the pinned v${pin}: ${what}. ` +
      `v${pin} is NOT in RELEASES_PREDATING_CONTRACT_ASSET (${PIN_SOURCE}), so its release ` +
      `is expected to publish ${ASSET} at ${url} and this is a failure to obtain it, not a ` +
      `release that legitimately has none. Nothing verified that tan still emits the ` +
      `envelope this extension parses. If GitHub was merely busy, re-run ` +
      `\`pnpm run contract:fetch\`; if the release genuinely has no such asset, that is a ` +
      `producer-side contract regression — see ${ISSUE}.`,
  );
  process.exit(1);
}

let response;
try {
  response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
} catch (error) {
  didNotVerify(`could not reach it — ${why(error)}`);
}

if (response.status === 404) {
  didNotVerify(
    `HTTP 404 — the release exists but publishes no ${ASSET}. Either the tag was cut ` +
      `without it, or the pin names a release that was never published`,
  );
}

// GitHub rate-limits unauthenticated downloads (403/429) and has outages (5xx).
// Kept a distinct sentence because it is a distinct fact — but no longer a
// distinct exit code, because the outcome is identical: unverified.
if ([403, 408, 429].includes(response.status) || response.status >= 500) {
  didNotVerify(
    `HTTP ${response.status} ${response.statusText} — GitHub was rate-limiting or down, ` +
      `which says nothing about the contract either way`,
  );
}

// A 400 or a 451 on a public release-asset URL is neither of the two above, so
// it keeps its own sentence rather than being filed as a fact it is not.
if (!response.ok) {
  didNotVerify(
    `an unexpected HTTP ${response.status} ${response.statusText} — neither a missing ` +
      `asset (404) nor GitHub being busy (403/408/429/5xx)`,
  );
}

let body;
try {
  // The signal above bounds the BODY read too, not just the headers — driven
  // against a server that sends headers then stalls, this rejects at
  // TIMEOUT_MS. Caught rather than left to reject uncaught: an uncaught stack
  // trace names none of the facts `didNotVerify` does, and exits 1 by accident
  // rather than on purpose.
  body = await response.text();
} catch (error) {
  didNotVerify(`the response body never finished — ${why(error)}`);
}

try {
  JSON.parse(body);
} catch (error) {
  // The only red that does NOT depend on the pin: the asset EXISTS and is
  // malformed, which is a contract violation on any release, listed or not.
  console.error(
    `::error::${url} returned HTTP 200 but the body is not JSON: ${why(error)}. ` +
      `The asset is published and malformed — a contract violation, not an ` +
      `availability problem.`,
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
