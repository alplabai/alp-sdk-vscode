// SPDX-License-Identifier: Apache-2.0

/**
 * Single source of truth for the alp-sdk tag both vendored schemas are pinned
 * to, and for the sha256 each vendored copy must hash to.
 *
 * The board and system-manifest schema copies MUST be vendored from the SAME
 * tag; the two `*.vendored.test.js` drift gates import their sha256 (and the
 * tag) from here through `test/vendored-sdk-tag.js`, so the two copies can
 * never green while disagreeing on tag. Bumping = re-vendor BOTH schemas from
 * the new tag, then update `VENDORED_SDK_TAG` and both hashes below in this
 * one place. `README.md` carries the full procedure.
 *
 * This lives in `alp-core` rather than under `test/` because the extension
 * needs it at RUNTIME: a customer's resolved SDK ships its own copies at
 * `<sdkRoot>/metadata/schemas/`, and the editor has to be able to say which
 * schema it is actually validating against (#493). `test/vendored-sdk-tag.js`
 * re-exports these so both drift gates keep reading one source.
 */

/** The alp-sdk tag `schemas/*.json` were vendored from. */
export const VENDORED_SDK_TAG = "v0.17.0-rc2";

/**
 * sha256 of `schemas/board.schema.json` over its LF-normalized bytes.
 *
 * The v0.17.0-rc2 bump is the largest since v0.15.0 and the first to move the
 * TOP-LEVEL PROPERTY SET: 21 keys become 24, still `additionalProperties:
 * false`. The three new keys -- `camera_connectors`, `cameras`, `ownership` --
 * are added to `BOARD_KEY_ORDER` (`packages/alp-core/src/board/models.ts`) so
 * the C1 round-trip data-loss gate keeps them; no view edits them. Every
 * `$ref` is still `#/$defs/...`, so `schemaSafety.ts` still takes the SDK's
 * own copy. Two removals changed what a written board.yaml means:
 * `ota.server.tls_ca_bundle` is gone (no emitter ever read it) and
 * `models[].compile.drpai.spec` is replaced by REQUIRED `input_shape`,
 * `input_name`, `images` (+ optional `product`). `som.sku` loses `E1M-NX9...`.
 * `docs/COMPATIBILITY_RULES.md` section 5 lists the full change set.
 */
export const BOARD_SCHEMA_SHA256 =
  "3a1770d9320fa7498ac9a567c943dbc8397f2539a921f04200bb36ac26ae49a7";

/**
 * sha256 of `schemas/system-manifest-v1.schema.json` over its LF-normalized
 * bytes.
 *
 * v0.17.0-rc2 grows the ROOT property set from eight keys to ten, still
 * `additionalProperties: false`: `ownership` (resolved `{instance: core}`
 * map, omitted when the SoM has no assignable resources) and `memory` (the
 * resolved region pane, rows closed with required name/source/kind/status).
 * `slices[].flash_method` / `flash_args` stop being unconditionally required
 * (required unless `os: off` or a `reason` is present) and
 * `flash_method_resolved` is new. The read-only tripwire in
 * `test/memoryRegions.readOnly.test.js` pins the ten keys.
 */
export const SYSTEM_MANIFEST_SCHEMA_SHA256 =
  "581d3540c57ee38bf5b519fd3ddceb5493e6131a1ae1cb49ef25d60082056c0c";

/** Which vendored schema a provenance comparison is about. */
export type VendoredSchemaId = "board" | "systemManifest";

/**
 * Where each schema lives, on both sides of the comparison.
 *
 * `vendored` is relative to the extension install root; `sdk` is relative to a
 * resolved `<sdkRoot>`. Both files are present at every alp-sdk tag this
 * extension supports (verified v0.11.0..v0.17.0-rc2), but the reader still treats
 * a missing file as a normal outcome rather than an error -- a customer can
 * point `alpSdk.sdkPath` at any directory.
 */
export const SDK_SCHEMA_RELATIVE_PATHS: Readonly<
  Record<VendoredSchemaId, { readonly vendored: string; readonly sdk: string }>
> = {
  board: {
    vendored: "schemas/board.schema.json",
    sdk: "metadata/schemas/board.schema.json",
  },
  systemManifest: {
    vendored: "schemas/system-manifest-v1.schema.json",
    sdk: "metadata/schemas/system-manifest-v1.schema.json",
  },
};

/** The sha256 the vendored copy of `id` must hash to. */
export const VENDORED_SCHEMA_SHA256: Readonly<
  Record<VendoredSchemaId, string>
> = {
  board: BOARD_SCHEMA_SHA256,
  systemManifest: SYSTEM_MANIFEST_SCHEMA_SHA256,
};

/** Human label for each schema, for status text the customer reads. */
export const VENDORED_SCHEMA_LABEL: Readonly<Record<VendoredSchemaId, string>> =
  {
    board: "board.yaml",
    systemManifest: "system-manifest.yaml",
  };
