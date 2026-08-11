// Single source of truth for the alp-sdk tag both vendored schemas are pinned to.
// The board and system-manifest schema copies MUST be vendored from the SAME tag;
// the two *.vendored.test.js drift gates import their sha256 (and the tag) from
// here, so the two copies can never green while disagreeing on tag. Bumping =
// re-vendor BOTH schemas from the new tag, then update VENDORED_SDK_TAG and both
// hashes below in this one place.
module.exports = {
  VENDORED_SDK_TAG: "v0.15.0",
  // board.schema.json moves for real at this bump, in two ways that change what
  // the editor accepts:
  //  1. `som.sku`'s pattern widens from
  //     `^E1M-(AEN[3-8]01|V2N10[12]|V2M10[12]|NX9[0-9]{3})$` to
  //     `^E1M-(AEN[3-8][0-9]{2}|V2N[0-9]{3}|V2M[0-9]{3}|NX9[0-9]{3})$`.
  //     NO shipped preset uses a widened tail yet -- v0.15.0 carries the same 11
  //     as v0.14.0 (E1M-AEN301/401/501/601/701/801, E1M-NX9101, E1M-V2M101/102,
  //     E1M-V2N101/102) -- so this only stops the editor pre-rejecting a SKU the
  //     PLM has allocated but the SDK has not yet shipped a preset for. The
  //     schema's own new wording: "The config tail is a per-configuration
  //     increment allocated by the PLM; not every value in range has a shipped
  //     preset."
  //  2. `storage[].raw` (the legacy `fs: raw` alias) is GONE, and storage items
  //     are `additionalProperties: false`, so a board.yaml carrying `raw: true`
  //     is now rejected. Upstream's stated intent, not an oversight -- v0.15.0's
  //     `scripts/alp_orchestrate/loader.py` deleted the normalising branch and
  //     says so: "The legacy `raw: true` alias is gone: `board.schema.json` no
  //     longer declares the property and sets `additionalProperties: false` on
  //     storage items, so a board carrying it is rejected at validation rather
  //     than normalised here. Measured before removal: zero tracked `board.yaml`
  //     files used it."
  BOARD_SCHEMA_SHA256:
    "f489eb9647776ed9dedc76be57323fa10715c15e2490cf161b1fd742b2f9193e",
  // Moves for the first time since the v0.13.0 re-vendor (#328), and by
  // DESCRIPTION TEXT only: the emitter is now named as the `alp_orchestrate`
  // package (`python -m alp_orchestrate`) rather than
  // `scripts/alp_orchestrate.py` -- the ADR 0020 relocation reaching the
  // contract's own prose. No property changed.
  //
  // The comment this replaced said "Unchanged from v0.11.0 -- byte-identical at
  // v0.13.0 and v0.14.0". That was FALSE, and inverted: upstream's
  // system-manifest schema moved at v0.12.0 (sha256 0a7ce139 -> ea7383b5), and
  // it is board.schema.json that was byte-identical v0.11.0..v0.13.0
  // (d9393ab0). So #328 moved this file for real and board.schema.json only by
  // label; #427 (v0.14.0) was the other way round. Verified by hashing both
  // schemas at all five tags -- do that before writing a claim like this, not
  // after.
  SYSTEM_MANIFEST_SCHEMA_SHA256:
    "be48d9159638968eb2cf42b0284b3c7ba9fe92f46bec3a8fdab8561c4d6dd59e",
};
