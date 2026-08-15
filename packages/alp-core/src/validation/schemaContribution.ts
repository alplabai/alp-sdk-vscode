// SPDX-License-Identifier: Apache-2.0

/**
 * What to hand `redhat.vscode-yaml` for a given document -- the resolved SDK's
 * own schema when there is one, nothing when there is not (#493).
 *
 * The mechanics this has to satisfy were read out of vscode-yaml 1.24.0 rather
 * than assumed, because every one of them constrains the shape here:
 *
 *  * `registerContributor(scheme, requestSchema, requestSchemaContent, label)`
 *    returns `false` if `scheme` is already taken, and there is NO unregister.
 *    So the extension registers ONCE and the callback resolves live -- an SDK
 *    switch changes what the callback answers, not the registration.
 *  * `requestSchema` is called SYNCHRONOUSLY
 *    (`r = i.requestSchema(e); r && t.push(r)`), so it cannot read files. It
 *    answers from a snapshot the adapter refreshes on state change.
 *  * The language server's resolution is
 *    `if (Array.isArray(n)) { if (0 === n.length) return r(); ... allOf }
 *     return n ? this.resolveCustomSchema(n, t) : r()`, with `r()` being the
 *    ordinary `contributes.yamlValidation` path. So ONE uri replaces the
 *    bundled copy outright, an empty answer falls back to it, and TWO uris
 *    would be combined as `allOf` -- the conjunction of both schemas, which is
 *    exactly the bug #493 exists to remove. Answer with one uri or none.
 *  * A `throw` inside the callback also falls back (`catch { return r() }`), so
 *    the failure mode is degradation to today's behaviour, never no validation.
 *
 * The uri carries the schema's sha256 because the client caches schema content
 * by uri and its file watcher is workspace-scoped -- an SDK under `~/.alp/`
 * never invalidates a cached uri. Stamping the hash makes a switch produce a
 * uri the cache has never seen, which is what makes the switch take effect.
 *
 * Pure: the adapter reads the files, this decides. Same contract as
 * `schemaProvenance.ts`, which it consumes rather than duplicating -- WHICH
 * copy is in force is decided in exactly one place.
 */

import type { SchemaProvenance, SchemaRead } from "./schemaProvenance";
import {
  VENDORED_SCHEMA_LABEL,
  type VendoredSchemaId,
} from "./vendoredSchemas";

/**
 * The uri scheme registered with vscode-yaml.
 *
 * Must not be `file`: the client special-cases known schemes and would try to
 * read the path itself instead of asking us for the content.
 */
export const ALP_SCHEMA_SCHEME = "alp-schema";

/** What the adapter answers with, for one refresh of the resolved SDK. */
export interface SchemaOffer {
  /** The uri to serve for each document kind, or null to fall back. */
  readonly uriById: Readonly<Record<VendoredSchemaId, string | null>>;
  /** Schema text by uri -- what `requestSchemaContent` returns. */
  readonly contentByUri: Readonly<Record<string, string>>;
}

/** An offer that serves nothing, so every document falls back. */
export const EMPTY_SCHEMA_OFFER: SchemaOffer = {
  uriById: { board: null, systemManifest: null },
  contentByUri: {},
};

/** The uri for one schema id at one content hash. */
export function buildSchemaUri(id: VendoredSchemaId, sha256: string): string {
  return `${ALP_SCHEMA_SCHEME}://sdk/${id}/${sha256}.json`;
}

/**
 * The file name a resource uri points at, or null.
 *
 * Matched on the last path segment, case-sensitively, which is what
 * `contributes.yamlValidation`'s `fileMatch` already does -- a name this does
 * not match is one the static contribution does not match either, so both sides
 * agree on which documents are in scope.
 */
export function resourceFileName(resource: string): string | null {
  const withoutFragment = resource.split("#")[0].split("?")[0];
  const segments = withoutFragment.split("/");
  const last = segments[segments.length - 1];
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    // A malformed percent-escape is not ours to interpret; fall back to raw.
    return last;
  }
}

/** Which schema governs a resource uri, or null when none of ours does. */
export function schemaIdForResource(resource: string): VendoredSchemaId | null {
  const name = resourceFileName(resource);
  if (name === null) return null;
  const hit = (Object.keys(VENDORED_SCHEMA_LABEL) as VendoredSchemaId[]).find(
    (id) => VENDORED_SCHEMA_LABEL[id] === name,
  );
  return hit ?? null;
}

/**
 * Turn a provenance verdict plus the bytes it was built from into the offer.
 *
 * Only a comparison whose `served` is `"sdk"` produces a uri. Everything else
 * -- no SDK, unreadable, refused by `schemaSafety.ts` -- leaves that id null so
 * the bundled copy stays in force, which is the fallback the issue requires to
 * remain genuinely reachable.
 */
export function buildSchemaOffer(
  provenance: SchemaProvenance,
  sdkReads: Readonly<Partial<Record<VendoredSchemaId, SchemaRead>>>,
): SchemaOffer {
  const uriById: Record<VendoredSchemaId, string | null> = {
    board: null,
    systemManifest: null,
  };
  const contentByUri: Record<string, string> = {};

  for (const comparison of provenance.comparisons) {
    if (comparison.served !== "sdk") continue;
    const read = sdkReads[comparison.id];
    // `served === "sdk"` already implies a successful read, so this is a
    // consistency guard, not a path a correct caller reaches.
    if (!read?.ok || comparison.sdkSha256 === null) continue;

    const uri = buildSchemaUri(comparison.id, comparison.sdkSha256);
    uriById[comparison.id] = uri;
    contentByUri[uri] = read.text;
  }

  return { uriById, contentByUri };
}

/** The uri to answer `requestSchema(resource)` with, or null to fall back. */
export function offeredUriForResource(
  offer: SchemaOffer,
  resource: string,
): string | null {
  const id = schemaIdForResource(resource);
  if (id === null) return null;
  return offer.uriById[id];
}
