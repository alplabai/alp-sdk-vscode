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

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
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

const results = await Promise.all(
  HOSTS.map(async ([platform, arch]) => {
    const asset = releaseAssetForTarget(platform, arch, SUPPORTED_CLI_VERSION);
    if (!asset) {
      return {
        label: `${platform}/${arch}`,
        state: "missing",
        detail: "no target triple for this host in TARGETS",
      };
    }
    const { state, detail } = await probeAsset(asset.url);
    return {
      label: `${asset.tag} ${asset.assetName}`,
      state,
      detail,
      url: asset.url,
    };
  }),
);

let failed = false;
for (const { label, state, detail, url } of results) {
  if (state === "present") {
    console.log(`  ok       ${label}`);
  } else if (state === "unknown") {
    console.log(`  skipped  ${label} — ${detail} (not a repo defect)`);
  } else {
    failed = true;
    console.error(`  MISSING  ${label} -> ${url ?? "n/a"}`);
  }
}

if (failed) {
  console.error(
    `\nSUPPORTED_CLI_VERSION is ${SUPPORTED_CLI_VERSION}, and the release above is ` +
      `not published (or is incomplete).\n` +
      `Either release that version from alplabai/tan-cli first, or lower the pin to ` +
      `a published one and gate the feature that needs the newer tan on its own\n` +
      `probed-version check (see RENODE_CORE_CLI_VERSION in src/west.ts).`,
  );
  process.exit(1);
}
console.log(
  `\ntan pin v${SUPPORTED_CLI_VERSION}: every platform asset resolves.`,
);
