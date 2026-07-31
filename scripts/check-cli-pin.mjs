#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Gate: `SUPPORTED_CLI_VERSION` must name a PUBLISHED tan-cli release, and that
// release must carry a binary for every platform this extension downloads for.
//
// Why this is worth a CI step: the pin has been raised to an unreleased version
// twice, and both times the build stayed green while every user's activation
// retried a 404 forever. `shouldFetchManagedCli` returns true for a `download`
// source AND for a `cached` binary behind the pin, so nothing self-corrects —
// the extension simply never gets a working CLI.
//
// Each of the six targets is checked, not just the tag: a release whose Windows
// asset failed to upload is exactly as broken for a Windows user as no release
// at all, and is invisible from every other platform.
//
// A 404 fails the gate. A network/registry error does NOT: someone else's
// outage is not a defect in this repo, and a gate that goes red on it is one
// people learn to ignore — the same rule as scripts/check-extension-deps.mjs.
//
// ── AND THE OTHER DIRECTION ────────────────────────────────────────────────
// Not every release publishes all six. A PyInstaller-built tan cannot
// cross-compile, so it ships four (alplabai/tan-cli#271), and the extension
// declares which hosts that costs in `HOSTS_WITHOUT_RELEASE_ASSET`
// (src/alpCli/service.ts) so it can explain itself offline instead of
// constructing a URL that 404s. A DECLARATION IS A CLAIM ABOUT A RELEASE, and
// this is the only place it ever meets that release — so it is probed too, and
// an entry whose asset DOES resolve fails the gate exactly as loudly as a
// missing one. That is what keeps the list from rotting into a lie the day tan
// starts publishing those hosts again: nobody has to remember, CI reds.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  HOSTS_WITHOUT_RELEASE_ASSET,
  SUPPORTED_CLI_VERSION,
  releaseAssetForTarget,
  TARGETS,
} = require("../out/alpCli/service.js");

const TIMEOUT_MS = 15_000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

/** Derived from `TARGETS`, never hand-listed: a platform added there must be
 *  probed here automatically, or the gate silently stops covering it. */
const HOSTS = Object.keys(TARGETS).map((key) => key.split("/"));

/** Run `attempt` up to ATTEMPTS times, pausing between tries so a 429 or a slow
 *  503 gets a chance to recover instead of failing three times instantly. */
async function withRetry(attempt) {
  let lastError = "";
  for (let i = 1; i <= ATTEMPTS; i += 1) {
    if (i > 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      const outcome = await attempt();
      if (outcome) return outcome;
      lastError = "empty response";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { state: "unknown", detail: lastError };
}

/** GitHub redirects release downloads to a CDN, so follow redirects on the
 *  HEAD; a missing TAG and a missing ASSET both surface as 404. */
async function probeAsset(url) {
  return withRetry(async () => {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) return { state: "missing" };
    if (response.ok) return { state: "present" };
    return null; // 5xx / 429 — retry, then report as unknown
  });
}

/** The hosts the pin DECLARES it publishes nothing for. */
const declaredGaps = HOSTS_WITHOUT_RELEASE_ASSET[SUPPORTED_CLI_VERSION] ?? [];

const results = await Promise.all(
  HOSTS.map(async ([platform, arch]) => {
    const host = `${platform}/${arch}`;
    // `{}` — the empty gap table — on purpose: this gate has to probe the URL a
    // download WOULD use even for a declared gap, or the declaration could
    // never be checked against the release it describes. Passing the real table
    // would make `releaseAssetForTarget` return null for exactly the hosts this
    // gate most needs a URL for, and the gate would then confirm the
    // declaration by reading it.
    const asset = releaseAssetForTarget(
      platform,
      arch,
      SUPPORTED_CLI_VERSION,
      {},
    );
    const expected = declaredGaps.includes(host) ? "missing" : "present";
    if (!asset) {
      return {
        label: host,
        state: "missing",
        expected: "present",
        detail: "no target triple for this host in TARGETS",
      };
    }
    const { state, detail } = await probeAsset(asset.url);
    return {
      host,
      label: `${asset.tag} ${asset.assetName}`,
      state,
      expected,
      detail,
      url: asset.url,
    };
  }),
);

let missing = false;
let published = false;
for (const { host, label, state, expected, detail, url } of results) {
  if (state === "unknown") {
    console.log(`  skipped  ${label} — ${detail} (not a repo defect)`);
  } else if (state === expected) {
    console.log(
      state === "present"
        ? `  ok       ${label}`
        : `  ok       ${label} — absent, as declared for ${host}`,
    );
  } else if (expected === "missing") {
    // The declaration is stale: the release DOES publish this one.
    published = true;
    console.error(`  PUBLISHED  ${label} -> ${url}`);
  } else {
    missing = true;
    console.error(`  MISSING  ${label} -> ${url ?? "n/a"}`);
  }
}

if (missing) {
  console.error(
    `\nSUPPORTED_CLI_VERSION is ${SUPPORTED_CLI_VERSION}, and the release above is ` +
      `not published (or is incomplete).\n` +
      `Either release that version from alplabai/tan-cli first, or lower the pin to ` +
      `a published one and gate the feature that needs the newer tan on its own\n` +
      `probed-version check (see RENODE_CORE_CLI_VERSION in src/west.ts).\n` +
      `If tan v${SUPPORTED_CLI_VERSION} is not MEANT to publish that host (a PyInstaller ` +
      `release cannot build every target), declare it in\n` +
      `HOSTS_WITHOUT_RELEASE_ASSET (src/alpCli/service.ts) — the extension then ` +
      `explains that host instead of downloading a 404.`,
  );
}
if (published) {
  console.error(
    `\ntan v${SUPPORTED_CLI_VERSION} DOES publish the asset(s) above, but ` +
      `HOSTS_WITHOUT_RELEASE_ASSET (src/alpCli/service.ts) declares that host\n` +
      `unpublished — so the extension refuses to download a binary that is ` +
      `sitting right there and tells the customer to build their own.\n` +
      `Remove the entry.`,
  );
}
if (missing || published) {
  process.exit(1);
}
console.log(
  declaredGaps.length === 0
    ? `\ntan pin v${SUPPORTED_CLI_VERSION}: every platform asset resolves.`
    : `\ntan pin v${SUPPORTED_CLI_VERSION}: every published platform asset resolves, ` +
        `and the ${declaredGaps.length} declared gap(s) really are absent.`,
);
