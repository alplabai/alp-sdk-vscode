// SPDX-License-Identifier: Apache-2.0
//
// The TypeScript `OtaServer` models cannot outlive a field the vendored schema
// drops (#589).
//
// ── The re-vendor this exists for ───────────────────────────────────────────
//
// alp-sdk removed `ota.server.tls_ca_bundle` (alp-sdk#1493, merged in
// alp-sdk#1744 -> `dev` on 2026-08-27). The key was accepted by the schema and
// read by NO emitter: the Hawkbit path derives TLS solely from `url`'s scheme
// (`CONFIG_HAWKBIT_USE_TLS`) with no sec-tag or CA registration, and the Mender
// path emits no CA variable at all. A schema that accepts a TLS pin and
// silently ignores it is worse than one that rejects it.
//
// That removal is NOT here yet, and cannot be: `schemas/board.schema.json` is a
// BYTE-EXACT vendored copy of alp-sdk `v0.16.0` (`BOARD_SCHEMA_SHA256`), and
// every alp-sdk TAG still declares the property -- `v0.15.0`, `v0.16.0` and
// `main` all carry it; only `dev` has the removal. There is no tag to
// re-vendor from. Editing the copy by hand would break the sha gate and make
// it misrepresent the tag it names.
//
// ── Why this gate, and not a TODO ──────────────────────────────────────────
//
// The re-vendor is a hash bump. `test/board.schema.vendored.test.js` says so
// itself: "The byte-exact SHA pin below catches drift, but an *intentional*
// re-vendor just bumps the hash -- this asserts a re-vendor can't silently drop
// a pin class the extension depends on."
//
// Nothing made the same promise for `ota.server`. So on the day someone
// re-vendors past the removal, the sha changes, they bump it, the property
// disappears from the schema -- and BOTH TypeScript copies keep declaring
// `tls_ca_bundle?: string` with nothing red. The extension would then model a
// field the schema it ships rejects, which is the drift this issue was filed
// to stop being discovered by a customer.
//
// This turns that into a failing test at exactly the right moment.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

/** The schema's own `ota.server` property names.
 *
 *  Addressed by PATH, never by searching for a field name: a search for
 *  `tls_ca_bundle` finds nothing the moment it is removed, which is precisely
 *  when this file has to keep working. */
function schemaOtaServerKeys() {
  const schema = JSON.parse(
    fs.readFileSync(path.join(root, "schemas", "board.schema.json"), "utf-8"),
  );
  const server = schema?.properties?.ota?.properties?.server;
  assert.ok(
    server && typeof server === "object",
    "the vendored schema has no `ota.server` block at all — the path this " +
      "gate reads moved, and every assertion below would compare empty sets",
  );
  return Object.keys(server.properties ?? {});
}

/**
 * The property names an `export interface OtaServer { ... }` block declares.
 *
 * Source-level, because a TypeScript interface is erased at runtime and there
 * is nothing to enumerate in the compiled output. The repo already gates other
 * source-level facts this way; the anti-vacuous check at the bottom is what
 * keeps a regex that stopped matching from reading as agreement.
 */
function interfaceKeys(relPath) {
  const src = fs.readFileSync(path.join(root, relPath), "utf-8");
  const block = /export interface OtaServer \{([^}]*)\}/.exec(src);
  assert.ok(
    block,
    `${relPath} declares no \`export interface OtaServer\` — this gate reads ` +
      "it by name, so a rename silently empties the comparison",
  );
  return [...block[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map(
    (m) => m[1],
  );
}

const CORE_MODEL = "packages/alp-core/src/board/models.ts";
const WEBVIEW_MIRROR = "packages/alp-webview/src/types.ts";

// ---------------------------------------------------------------------------
// The direction that catches the re-vendor
// ---------------------------------------------------------------------------

test("no OtaServer field is modelled that the vendored schema does not declare", () => {
  const declared = new Set(schemaOtaServerKeys());
  for (const rel of [CORE_MODEL, WEBVIEW_MIRROR]) {
    const orphans = interfaceKeys(rel).filter((key) => !declared.has(key));
    assert.deepEqual(
      orphans,
      [],
      `${rel} models ${orphans.join(", ")}, which \`schemas/board.schema.json\` ` +
        "no longer declares.\n\n" +
        "If a re-vendor just dropped it, this is the point of this gate: drop " +
        "the same field from BOTH TypeScript copies in the same commit. " +
        "`ota.server` is `additionalProperties: false`, so a field the schema " +
        "does not declare is one a board.yaml is rejected for carrying — " +
        "modelling it tells the reader the opposite.",
    );
  }
});

// The other direction is deliberately NOT asserted. The schema may declare a
// field this extension has no reason to read, and modelling every one of them
// would be busywork that reds on any additive upstream change — the failure
// `tanPayloadShape.ts`'s header argues against for tan payloads, for the same
// reason.

// ---------------------------------------------------------------------------
// The hand-mirror
// ---------------------------------------------------------------------------

test("the webview's OtaServer mirror agrees with the core model", () => {
  assert.deepEqual(
    interfaceKeys(WEBVIEW_MIRROR),
    interfaceKeys(CORE_MODEL),
    `${WEBVIEW_MIRROR} is a HAND mirror of the core board model, so the two ` +
      "drift silently by construction. A field dropped from one and left in " +
      "the other is the half-done removal this gate exists to prevent.",
  );
});

// ---------------------------------------------------------------------------
// The gate is not vacuous
// ---------------------------------------------------------------------------

test("the extraction actually found fields on all three sides", () => {
  const schemaKeys = schemaOtaServerKeys();
  assert.ok(
    schemaKeys.includes("url"),
    "`url` is the one REQUIRED property of `ota.server`; a schema read that " +
      "cannot see it is reading the wrong node, and the orphan check above " +
      "would then report every modelled field as an orphan or none at all",
  );
  for (const rel of [CORE_MODEL, WEBVIEW_MIRROR]) {
    const keys = interfaceKeys(rel);
    assert.ok(
      keys.includes("url"),
      `${rel}'s OtaServer parsed to [${keys.join(", ")}] — the regex stopped ` +
        "matching, and an empty key list satisfies the orphan assertion " +
        "perfectly while checking nothing",
    );
  }
});
