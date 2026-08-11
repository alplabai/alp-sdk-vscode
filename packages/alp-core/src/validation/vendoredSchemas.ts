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
export const VENDORED_SDK_TAG = "v0.15.0";

/**
 * sha256 of `schemas/board.schema.json` over its LF-normalized bytes.
 *
 * board.schema.json moves for real at the v0.15.0 bump, in two ways that
 * change what the editor accepts:
 *  1. `som.sku`'s pattern widens from
 *     `^E1M-(AEN[3-8]01|V2N10[12]|V2M10[12]|NX9[0-9]{3})$` to
 *     `^E1M-(AEN[3-8][0-9]{2}|V2N[0-9]{3}|V2M[0-9]{3}|NX9[0-9]{3})$`.
 *     NO shipped preset uses a widened tail yet -- v0.15.0 carries the same 11
 *     as v0.14.0 (E1M-AEN301/401/501/601/701/801, E1M-NX9101, E1M-V2M101/102,
 *     E1M-V2N101/102) -- so this only stops the editor pre-rejecting a SKU the
 *     PLM has allocated but the SDK has not yet shipped a preset for. The
 *     schema's own new wording: "The config tail is a per-configuration
 *     increment allocated by the PLM; not every value in range has a shipped
 *     preset."
 *  2. `storage[].raw` (the legacy `fs: raw` alias) is GONE, and storage items
 *     are `additionalProperties: false`, so a board.yaml carrying `raw: true`
 *     is now rejected. Upstream's stated intent, not an oversight -- v0.15.0's
 *     `scripts/alp_orchestrate/loader.py` deleted the normalising branch and
 *     says so: "The legacy `raw: true` alias is gone: `board.schema.json` no
 *     longer declares the property and sets `additionalProperties: false` on
 *     storage items, so a board carrying it is rejected at validation rather
 *     than normalised here. Measured before removal: zero tracked `board.yaml`
 *     files used it."
 */
export const BOARD_SCHEMA_SHA256 =
  "f489eb9647776ed9dedc76be57323fa10715c15e2490cf161b1fd742b2f9193e";

/**
 * sha256 of `schemas/system-manifest-v1.schema.json` over its LF-normalized
 * bytes.
 *
 * Moves for the first time since the v0.13.0 re-vendor (#328), and by
 * DESCRIPTION TEXT only: the emitter is now named as the `alp_orchestrate`
 * package (`python -m alp_orchestrate`) rather than
 * `scripts/alp_orchestrate.py` -- the ADR 0020 relocation reaching the
 * contract's own prose. No property changed.
 *
 * The comment this replaced said "Unchanged from v0.11.0 -- byte-identical at
 * v0.13.0 and v0.14.0". That was FALSE, and inverted: upstream's
 * system-manifest schema moved at v0.12.0 (sha256 0a7ce139 -> ea7383b5), and
 * it is board.schema.json that was byte-identical v0.11.0..v0.13.0
 * (d9393ab0). So #328 moved this file for real and board.schema.json only by
 * label; #427 (v0.14.0) was the other way round. Verified by hashing both
 * schemas at all five tags -- do that before writing a claim like this, not
 * after.
 */
export const SYSTEM_MANIFEST_SCHEMA_SHA256 =
  "be48d9159638968eb2cf42b0284b3c7ba9fe92f46bec3a8fdab8561c4d6dd59e";

/** Which vendored schema a provenance comparison is about. */
export type VendoredSchemaId = "board" | "systemManifest";

/**
 * Where each schema lives, on both sides of the comparison.
 *
 * `vendored` is relative to the extension install root; `sdk` is relative to a
 * resolved `<sdkRoot>`. Both files are present at every alp-sdk tag this
 * extension supports (verified v0.11.0..v0.15.0), but the reader still treats
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
export const VENDORED_SCHEMA_SHA256: Readonly<Record<VendoredSchemaId, string>> =
  {
    board: BOARD_SCHEMA_SHA256,
    systemManifest: SYSTEM_MANIFEST_SCHEMA_SHA256,
  };

/** Human label for each schema, for status text the customer reads. */
export const VENDORED_SCHEMA_LABEL: Readonly<Record<VendoredSchemaId, string>> =
  {
    board: "board.yaml",
    systemManifest: "system-manifest.yaml",
  };
