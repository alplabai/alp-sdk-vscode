#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Gate: every `extensionDependencies` entry must exist on BOTH registries VS
// Code family editors install from — the VS Code Marketplace and Open VSX.
//
// `extensionDependencies` is a HARD gate in VS Code: an entry that cannot be
// resolved makes THIS extension impossible to install at all, not merely
// degraded. So the failure this guards is total, and it is silent until a user
// on the affected editor tries to install.
//
// Both registries are checked, for different reasons:
//   * Marketplace — where VS Code proper installs from. A typo'd id, or an
//     extension its publisher unlisted, fails here. "It is obviously there, we
//     install it ourselves" is an assumption, not a check.
//   * Open VSX — a separate registry with its own publishing, used by VSCodium,
//     code-server and Windsurf. An extension can be on one and not the other.
//
// A "not found" on either registry fails the gate. A network or registry error
// does NOT: an outage is not a defect in this repo, and a gate that goes red on
// someone else's downtime is one people learn to ignore — worse than no gate.

import { readFileSync } from "node:fs";

const OPEN_VSX = "https://open-vsx.org/api";
const MARKETPLACE =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
const TIMEOUT_MS = 15_000;
const ATTEMPTS = 3;

/** `publisher.name` → the two path segments Open VSX wants. */
function splitId(id) {
  const at = id.indexOf(".");
  if (at <= 0 || at === id.length - 1) return null;
  return { publisher: id.slice(0, at), name: id.slice(at + 1) };
}

/** Run `attempt` up to ATTEMPTS times; `unknown` carries the last error. */
async function withRetry(attempt) {
  let lastError = "";
  for (let i = 1; i <= ATTEMPTS; i += 1) {
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

async function probeOpenVsx(id) {
  const parts = splitId(id);
  if (!parts) return { state: "missing", detail: "not a publisher.name id" };
  return withRetry(async () => {
    const response = await fetch(
      `${OPEN_VSX}/${parts.publisher}/${parts.name}`,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (response.status === 404) return { state: "missing", detail: "404" };
    if (!response.ok) return null; // retry
    const body = await response.json();
    return { state: "published", detail: `v${body.version ?? "?"}` };
  });
}

/**
 * The Marketplace has no REST-by-id endpoint; the gallery takes a POST query.
 * `filterType: 7` is ExtensionName — an exact `publisher.name` match, so an
 * empty `extensions` array means "no such extension", not "no good match".
 */
async function probeMarketplace(id) {
  return withRetry(async () => {
    const response = await fetch(MARKETPLACE, {
      method: "POST",
      headers: {
        Accept: "application/json;api-version=3.0-preview.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filters: [{ criteria: [{ filterType: 7, value: id }] }],
        flags: 914,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null; // retry
    const body = await response.json();
    const found = body?.results?.[0]?.extensions ?? [];
    if (found.length === 0) return { state: "missing", detail: "no such id" };
    const version = found[0]?.versions?.[0]?.version ?? "?";
    return { state: "published", detail: `v${version}` };
  });
}

const MARKS = { published: "ok", missing: "MISSING", unknown: "skipped" };

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const ids = manifest.extensionDependencies ?? [];
if (ids.length === 0) {
  console.log("no extensionDependencies declared — nothing to check");
  process.exit(0);
}

const results = await Promise.all(
  ids.map(async (id) => ({
    id,
    marketplace: await probeMarketplace(id),
    openVsx: await probeOpenVsx(id),
  })),
);

console.log("dependency".padEnd(34) + "marketplace".padEnd(22) + "open vsx");
for (const { id, marketplace, openVsx } of results) {
  const cell = (r) => `${MARKS[r.state]} ${r.detail}`;
  console.log(id.padEnd(34) + cell(marketplace).padEnd(22) + cell(openVsx));
}

const failures = results.flatMap(({ id, marketplace, openVsx }) => [
  ...(marketplace.state === "missing" ? [`${id} (Marketplace)`] : []),
  ...(openVsx.state === "missing" ? [`${id} (Open VSX)`] : []),
]);
const unknowns = results.filter(
  (r) => r.marketplace.state === "unknown" || r.openVsx.state === "unknown",
);

if (unknowns.length > 0) {
  console.log(
    `\n${unknowns.length} entry/entries could not be fully checked (registry unreachable). ` +
      `Not failing on downtime — re-run to confirm.`,
  );
}
if (failures.length > 0) {
  console.error(
    `\nnot published: ${failures.join(", ")}\n` +
      `extensionDependencies is a hard gate — on an editor installing from that ` +
      `registry this extension becomes impossible to install, not merely ` +
      `degraded. Move the entry to extensionPack, or get it published there first.`,
  );
  process.exit(1);
}
console.log(
  `\nall ${results.length} extensionDependencies resolve on both registries`,
);
