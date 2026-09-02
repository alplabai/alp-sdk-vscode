#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Did the Marketplace actually INGEST the version this run published? (#648)
//
// ── What release_gate can and cannot see ────────────────────────────────────
//
// `release_gate` reads `steps.<id>.outcome` for each publish step, and that is
// the right thing for it to read -- taking the step's own word rather than
// re-deriving the condition is what made the first half-publish legible. Its
// limit is SCOPE, not logic: a workflow can observe what it DID, never what
// the Marketplace ACCEPTED.
//
// Those are not the same event, and v0.6.0 measured the gap:
//
//   09:19:02.663Z  darwin-arm64 visible in the gallery
//   09:22:02       universal publish step starts
//   09:22:04       universal publish step exits 0   <-- gate can go green here
//   09:28:21.2Z    universal visible in the gallery <-- ~6 min later
//
// For six minutes the workflow reported a published universal target that no
// customer could install. That window is survivable. The failure that is not:
// a publish call exits 0 and the version is NEVER ingested. `release_gate`
// then stays green forever, on a tag that is spent and cannot be republished.
//
// ── Why the target set is derived, never listed ─────────────────────────────
//
// The caller passes the outcome of each channel's publish step, and the
// expected targets follow from those. A hardcoded ["universal","darwin-arm64"]
// would fail a legitimate run that published one channel, and -- worse -- a
// hardcoded list that someone SHRINKS is invisible to the check that reads it.
// Same reason `test/ci.cliHostCoverage.test.js` derives its host set.
//
// ── Absence needs every attempt to agree ────────────────────────────────────
//
// Ingestion is slow and the gallery is eventually consistent, so one empty
// answer is not a verdict. This polls with backoff and only reports a target
// MISSING after every attempt has said so. That is the #518 lesson: a 404 arm
// that returned on the first attempt turned one sample into a verdict.

import { setTimeout as sleep } from "node:timers/promises";

const GALLERY =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";

/** The gallery reports a universal build by OMITTING `targetPlatform`, not by
 *  naming it. Spelled here so the absence is a documented value rather than a
 *  falsy check somebody later "tidies" into a bug. */
export const UNIVERSAL = "universal";

/**
 * Which targets this run is entitled to expect, from the publish steps' own
 * outcomes.
 *
 * Only `success` counts. A `skipped` channel published nothing and must not be
 * looked for; a `failure` is already `release_gate`'s to report, and demanding
 * ingestion for it would double-report one defect as two.
 */
export function expectedTargets(outcomes) {
  return Object.entries(outcomes)
    .filter(([, outcome]) => outcome === "success")
    .map(([target]) => target)
    .sort();
}

/**
 * The targets the gallery currently serves for `version`.
 *
 * DROP, never coerce: an entry without a string `version` is not a version,
 * and guessing one would invent a publish that did not happen.
 */
export function ingestedTargets(payload, version) {
  const versions = payload?.results?.[0]?.extensions?.[0]?.versions ?? [];
  if (!Array.isArray(versions)) return [];
  const found = new Set();
  for (const entry of versions) {
    if (typeof entry?.version !== "string" || entry.version !== version) {
      continue;
    }
    const target = entry.targetPlatform;
    found.add(typeof target === "string" && target !== "" ? target : UNIVERSAL);
  }
  return [...found].sort();
}

/** What is still missing. Empty means every expected target is being served. */
export function missingTargets(expected, ingested) {
  const have = new Set(ingested);
  return expected.filter((t) => !have.has(t));
}

/** The delay before attempt `n` (1-based), in ms. Short at first because
 *  darwin-arm64 was visible in under a minute on v0.6.0, then widening,
 *  because the universal target took ~6. */
export function backoffMs(attempt) {
  const schedule = [0, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000];
  return schedule[Math.min(attempt - 1, schedule.length - 1)];
}

async function queryGallery(extensionId, fetchImpl = fetch) {
  const res = await fetchImpl(GALLERY, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json;api-version=3.0-preview.1",
    },
    body: JSON.stringify({
      // filterType 7 is an exact `publisher.name` match; flags 151 is the
      // combination that returns per-version rows including `targetPlatform`.
      filters: [{ criteria: [{ filterType: 7, value: extensionId }] }],
      flags: 151,
    }),
  });
  if (!res.ok) {
    throw new Error(`gallery query failed: HTTP ${res.status}`);
  }
  return res.json();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (key) out[key] = argv[i + 1];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { extension, version, attempts } = args;
  if (!extension || !version) {
    console.error(
      "usage: verify-marketplace-ingest.mjs --extension <publisher.name> " +
        "--version <x.y.z> --universal <outcome> --darwin-arm64 <outcome> " +
        "[--attempts N]",
    );
    process.exit(2);
  }

  const expected = expectedTargets({
    [UNIVERSAL]: args[UNIVERSAL],
    "darwin-arm64": args["darwin-arm64"],
  });

  if (expected.length === 0) {
    // Not a pass by default: say so, and say why, so a run that published
    // nothing is distinguishable from a run this script failed to check.
    console.log(
      "No channel reported a successful publish, so there is nothing to " +
        "verify. (This is not a claim that anything was ingested.)",
    );
    return;
  }

  // 10, not 7. The schedule above sums to 365s over 7 attempts and the
  // measured universal lag on v0.6.0 was ~360s -- a budget that expires the
  // moment the thing it waits for happens. Ten attempts hold ~12 minutes.
  const total = Number(attempts ?? 10);
  let ingested = [];
  let missing = expected;
  for (let attempt = 1; attempt <= total; attempt += 1) {
    const wait = backoffMs(attempt);
    if (wait > 0) await sleep(wait);
    try {
      ingested = ingestedTargets(await queryGallery(extension), version);
    } catch (error) {
      // A transient query failure is not an absence verdict. Keep going; only
      // the last attempt decides.
      console.log(`attempt ${attempt}/${total}: ${error.message}`);
      continue;
    }
    missing = missingTargets(expected, ingested);
    console.log(
      `attempt ${attempt}/${total}: serving [${ingested.join(", ") || "none"}]` +
        `, still missing [${missing.join(", ") || "none"}]`,
    );
    if (missing.length === 0) {
      console.log(
        `${extension} ${version}: every published target is being served.`,
      );
      return;
    }
  }

  console.error(
    `::error::${extension} ${version} was published but the Marketplace is ` +
      `not serving [${missing.join(", ")}] after ${total} attempts. The ` +
      "publish step exited 0, so `release_gate` is green — but the version " +
      "is not installable. The tag is spent and cannot be republished; the " +
      "next step is a new version, not a re-run.",
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
