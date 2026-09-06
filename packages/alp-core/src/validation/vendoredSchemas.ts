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
export const VENDORED_SDK_TAG = "v0.16.0";

/**
 * sha256 of `schemas/board.schema.json` over its LF-normalized bytes.
 *
 * The v0.16.0 bump moves this file in six places, five of them description
 * text. The TOP-LEVEL PROPERTY SET IS UNCHANGED -- the same 21 keys as
 * v0.15.0, still `additionalProperties: false` -- so `BOARD_KEY_ORDER`
 * (`packages/alp-core/src/board/models.ts`) has nothing new to absorb and the
 * C1 round-trip data-loss gate is unaffected. Every `$ref` is still
 * `#/$defs/...`, so `schemaSafety.ts`'s `^#`-only acceptance still takes the
 * SDK's own copy rather than silently falling back to this one.
 *
 * The ONE structural change, and the only one that changes what a written
 * board.yaml means:
 *  1. `boot.swap_algorithm` LOSES its `"default": "scratch"`. There is now no
 *     fixed schema default: the SDK derives it from the target's real slot
 *     layout, and on a SINGLE-SLOT target -- E1M-AEN801, whose disjoint-slot0
 *     `memory_map:` has no slot1/scratch region (#1069/#1413) -- setting ANY
 *     of the three values explicitly is a build-time `OrchestratorError`,
 *     because there is no partition for them to swap into. `ConfiguratorView`
 *     still shows `boot.swap_algorithm || "scratch"` and persists a non-scratch
 *     pick; that predates this bump and is tracked by #658, NOT fixed here.
 *
 * The five description-only edits, recorded because a reader diffing the
 * bytes will otherwise re-derive them:
 *  2. `boot.sim_console` drops the `RENODE_MODE=real` naming (same behaviour).
 *  3. `boot.modules` keys may now ALSO be Zephyr log modules the SDK wires
 *     (`i2c`, `spi`, `gpio`, `adc`, `net_tcp`, ...), not only `alp_*` module
 *     names; the emitted `CONFIG_<MODULE>_LOG_LEVEL_<LEVEL>=y` is live only
 *     where that choice symbol exists and is downgraded to a hint comment
 *     otherwise, so the fragment always configures.
 *  4. `storage[].flash_device`: a `memory_map:` region marked
 *     `carveout: false` is a partition INSIDE a flash-class node and is
 *     refused as a target (#1484); and no target resolves to a genuinely
 *     working Devicetree label today -- a region's label DEFAULTS to the
 *     region name when the preset sets no `dt_label:` override (neither
 *     `mram_main` nor `ocram_low` has one), and as of alp-sdk#1556 the
 *     resolver blocks with a reason rather than decorating the fabricated
 *     label. `on_module.ospi_memories:` keys are not yet gated the same way.
 *  5. `ota.poll_interval` names its unit (SECONDS) and warns that
 *     `provider: hawkbit` converts to `CONFIG_HAWKBIT_POLL_INTERVAL`, which
 *     Zephyr declares in MINUTES with `range 1 43200` -- so a hawkbit
 *     project's value must be a whole number of minutes between 60 s and
 *     2592000 s, and anything else is refused at emit.
 *  6. `models[].source` adds `.pte` (an ExecuTorch `torch.export` program):
 *     it passes through for CPU, but no on-device ExecuTorch runtime backend
 *     exists yet, so the blob is producible and not yet invocable (#1260).
 */
export const BOARD_SCHEMA_SHA256 =
  "1549c70885a8eb184834baecb874084d239acde986050fdcf2d5173fd094d419";

/**
 * sha256 of `schemas/system-manifest-v1.schema.json` over its LF-normalized
 * bytes.
 *
 * v0.16.0 moves ONE object, `helper_mcus[]`, and it is a REQUIREDNESS change,
 * not prose:
 *  - `required` goes from `["name", "chip"]` to
 *    `["name", "chip", "flash_policy"]`.
 *  - `flash_policy` is new: `enum ["customer", "factory", "recovery_only"]`,
 *    stating WHO may invoke `flash_method` and WHEN. The schema's own wording
 *    is explicit that there is no fallback -- "REQUIRED -- there is no
 *    absent-means-`customer` default". `factory`: Alp Lab programs it in
 *    production, never a customer flash target. `recovery_only`: Alp Lab
 *    programs it in production and the customer may flash it ONLY to recover
 *    a bricked device, with Alp Lab-supplied binaries.
 *  - `update_channel` is new and deliberately UNENUMERATED here (the
 *    SoM-preset schema owns the vocabulary, so a consumer tolerates a channel
 *    added upstream). It is INDEPENDENT of `flash_policy`, and the array's
 *    own description says so: each declared key "is projected here
 *    independently ... a consumer must not read one key's presence as
 *    excluding another's".
 *
 * v0.16.0 ships 11 SoM presets. The 10 that declare a helper --
 * E1M-AEN301/401/501/601/701/801, E1M-V2M101/102, E1M-V2N101/102 -- ALL declare
 * `flash_policy: recovery_only`; E1M-NX9101 declares `helper_firmware: []` and
 * so contributes no entry at all. `tan flash` is the enforcing gate and it holds: the policy is
 * checked AHEAD of any `flash_method` presence
 * (`python/tan/core/flash_plan.py::helper_flash_gate`, tan-cli#611). This
 * extension's job is therefore disclosure, not enforcement -- see
 * `packages/alp-core/src/flash/consent.ts`.
 *
 * The ROOT property set is unchanged (the same eight keys), so the
 * read-only tripwire in `test/memoryRegions.readOnly.test.js` still passes:
 * alp-sdk's schema-only `memory` root key is on an unmerged branch, not on
 * this tag.
 */
export const SYSTEM_MANIFEST_SCHEMA_SHA256 =
  "abbe4a444ed088642cd85335a68714f1092528f976f77b94b499763286386628";

/** Which vendored schema a provenance comparison is about. */
export type VendoredSchemaId = "board" | "systemManifest";

/**
 * Where each schema lives, on both sides of the comparison.
 *
 * `vendored` is relative to the extension install root; `sdk` is relative to a
 * resolved `<sdkRoot>`. Both files are present at every alp-sdk tag this
 * extension supports (verified v0.11.0..v0.16.0), but the reader still treats
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
