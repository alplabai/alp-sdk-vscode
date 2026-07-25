#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Gate: every `extensionDependencies` entry must exist on Open VSX.
//
// `extensionDependencies` is a HARD gate in VS Code — an entry that cannot be
// resolved on the marketplace in use makes THIS extension impossible to install
// at all, not merely degraded. The Marketplace side is self-evident (that is
// where these are installed from), but Open VSX is a separate registry with its
// own publishing, and VSCodium / code-server / Windsurf install from it. A
// dependency missing there locks those users out entirely, silently, at
// whatever future moment someone adds an id (#344).
//
// A 404 fails the gate. A network/registry error does NOT: an Open VSX outage
// is not a defect in this repo, and a gate that goes red on someone else's
// downtime gets ignored, which is worse than no gate.

import { readFileSync } from "node:fs";

const REGISTRY = "https://open-vsx.org/api";
const TIMEOUT_MS = 15_000;
const ATTEMPTS = 3;

/** `publisher.name` → the registry's two path segments. */
function splitId(id) {
  const at = id.indexOf(".");
  if (at <= 0 || at === id.length - 1) return null;
  return { publisher: id.slice(0, at), name: id.slice(at + 1) };
}

/** `published` | `missing` | `unknown` (registry unreachable — never fatal). */
async function probe(id) {
  const parts = splitId(id);
  if (!parts)
    return { id, state: "missing", detail: "not a publisher.name id" };

  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(
        `${REGISTRY}/${parts.publisher}/${parts.name}`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      if (response.status === 404) {
        return { id, state: "missing", detail: "404 from Open VSX" };
      }
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const body = await response.json();
      return { id, state: "published", detail: `v${body.version ?? "?"}` };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { id, state: "unknown", detail: lastError };
}

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const ids = manifest.extensionDependencies ?? [];
if (ids.length === 0) {
  console.log("no extensionDependencies declared — nothing to check");
  process.exit(0);
}

const results = await Promise.all(ids.map(probe));
for (const { id, state, detail } of results) {
  const mark = { published: "ok", missing: "MISSING", unknown: "skipped" }[
    state
  ];
  console.log(`${mark.padEnd(8)} ${id.padEnd(32)} ${detail}`);
}

const missing = results.filter((r) => r.state === "missing");
const unknown = results.filter((r) => r.state === "unknown");

if (unknown.length > 0) {
  console.log(
    `\n${unknown.length} dependency/dependencies could not be checked (Open VSX unreachable). ` +
      `Not failing on registry downtime — re-run to confirm.`,
  );
}
if (missing.length > 0) {
  console.error(
    `\nnot published on Open VSX: ${missing.map((r) => r.id).join(", ")}\n` +
      `extensionDependencies is a hard gate: on Open VSX-based editors ` +
      `(VSCodium, code-server, Windsurf) this extension becomes impossible to ` +
      `install, not merely degraded. Move the entry to extensionPack, or get ` +
      `it published there first.`,
  );
  process.exit(1);
}
console.log(
  `\nall ${results.length} extensionDependencies resolve on Open VSX`,
);
