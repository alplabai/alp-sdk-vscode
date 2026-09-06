# Compatibility Rules

Last revised: 2026-07-17

This document defines backward-compatibility guarantees for schema support, generation targets, and CLI contracts.

## 1. Schema Compatibility

- board-config schema updates must preserve existing valid board.yaml files whenever possible.
- Breaking schema changes require:
  - explicit changelog note,
  - migration guidance,
  - versioned acceptance tests.
- Schema source of truth remains alp-sdk-upstream submodule.

## 2. Generation Target Compatibility

- Supported generation targets are versioned product contract:
  - zephyr-conf
  - dts-overlay
  - native-sim-overlay
  - cmake-args
  - yocto-conf
- Removing or renaming a target is breaking.
- Output path changes are breaking unless migration guidance is provided.
- Generation target metadata is protected by golden tests.

## 3. CLI Flag and JSON Compatibility

- Existing command names and flag names are stable public API.
- Existing JSON envelope keys are stable:
  - command
  - ok
  - exitCode
  - project
  - data
  - issues
- Command-specific payload keys must not be renamed silently.
- Any additive fields must be backward-compatible (no required-field break for existing parsers).

## 4. Compatibility Change Process

Before merging a potentially breaking change:

1. Update this document and CLI.md if contract changes.
2. Update golden/integration tests for the new contract.
3. Add migration notes in release communication.

## 5. SDK Version Compatibility Log

The extension + CLI **consume** the SDK planner over the JSON `--emit` seam (ADR 0014);
they do not re-implement it, so an SDK minor bump flows through without code changes as
long as the consumed contracts hold. Record each assessed SDK release here.

- **alp-sdk v0.8.0 — compatible, no product change required** (assessed 2026-06-24).
  - `metadata/schemas/board.schema.json` + `board-preset.schema.json`: **unchanged** → the
    vendored `schemas/board.schema.json` stays correct; no re-vendor.
  - `scripts/validate_board_yaml.py` / `validate_metadata.py`: **unchanged** → the CLI's
    offline validator (`@alp-sdk/core`) does not drift.
  - `--emit` shapes (7) + the `system-manifest-v1` schema: **unchanged** → the manifest
    reader + the build-plan envelope stay valid.
  - SoM catalogue is sourced at runtime via `tan presets` (smoke-tested against a v0.8.0
    checkout: 11 SKUs, version `0.8.0`); the CLI reads `metadata/sdk_version.yaml` at
    runtime — no pinned version to bump.
  - The one planner-behaviour change (`stock-shim-unimplemented`: a Zephyr core whose
    `app: alp-stock-shim` now emits `command: null` + a warning) is rendered generically by
    the Build Plan view (`command: null` + warnings were already first-class). The SDK's own
    warning message is actionable ("Override `cores.<id>.app` with a real app"), so no
    special-casing is needed.
  - Forward-looking (additive, not required): v0.8.0 adds an `ADC`/`DAC` E1M pin class and
    camera-sensor DTS bindings — the configurator / pin-mux could surface these as new
    routing/chip options. Tracked separately, not a compatibility concern.

- **alp-sdk v0.9.0 → v0.11.0 — shipped without a per-release assessment; the
  extension now declares a supported floor** (recorded 2026-07-17). Readiness
  (`checkSdkReadiness`) flags any SDK older than **`MIN_SDK_VERSION`** (declared
  in `packages/alp-core/src/sdk/service.ts`) as a `partial` install with an
  actionable issue rather than reporting it `ready`.
  - **v0.9.0** — BREAKING: generated pin macros renamed `E1M_*` → `ALP_E1M_*`;
    `metadata/schemas/board.schema.json` re-vendored (#52).
  - **v0.10.0** — added the `--emit native-sim-overlay` target the extension now
    hardcodes (`Alp: Generate native_sim overlay`); it does not exist on v0.9.0
    or earlier, where argparse rejects it. This is the supported floor.
  - **v0.10.1** — patch release.
  - **v0.11.0** — `metadata/schemas/board.schema.json` re-vendored (#117).
  - Caveat: `metadata/sdk_version.yaml` can lag the tag on a dev checkout (it
    read `0.7.0` at one HEAD), so the readiness floor is advisory — an absent or
    unparseable version is treated as "unknown, not behind" and never mis-flagged.

- **alp-sdk v0.11.1 → v0.14.0 — re-vendored twice, assessed neither time**
  (recorded 2026-08-11, retroactively). Both bumps shipped as schema chores with
  no §5 entry, which is why the line above read "currently tracks v0.11.0" while
  the pin file said `v0.14.0`. What that file recorded at the time is preserved
  here so it is not lost to the next re-vendor:
  - **v0.11.1** (2026-07-17), **v0.12.0** (2026-07-23) — never vendored from;
    the extension jumped v0.11.0 → v0.13.0 directly. Not assessed.
  - **v0.13.0** (2026-07-24) — both schemas re-vendored (#328, `70691c0c`).
    `system-manifest-v1.schema.json` moved for real; `board.schema.json` was
    byte-identical to v0.11.0, so that half moved the label, not the file.
    (Upstream's system-manifest schema actually changed at **v0.12.0**, which
    the extension never vendored from — `west alp-build` became `west alp-emit
    system-manifest` in its description.)
  - **v0.14.0** (2026-07-29) — both schemas re-vendored (#427, `f46bcaa2`).
    The other way round: `board.schema.json` moved for real — the `peripherals`
    enum gained `dac` and `i3c` (18 entries, was 16) — while
    `system-manifest-v1.schema.json` was unchanged from v0.12.0.
  - Verified by LF-normalised sha256 of both schemas at all five tags:
    system-manifest `0a7ce139…` (v0.11.0) → `ea7383b5…` (v0.12.0–v0.14.0) →
    `be48d915…` (v0.15.0); board `d9393ab0…` (v0.11.0–v0.13.0) → `0cc502ab…`
    (v0.14.0) → `f489eb96…` (v0.15.0). The pin file's own comment had carried
    the inverted claim since #427; it is corrected there too.

- **alp-sdk v0.15.0 — compatible; both schemas re-vendored, no code change**
  (assessed 2026-08-11). Tag `v0.15.0`, commit
  `3769febe680e244386afaeb49305c6a8961f1a79`, released 2026-08-07. The vendored
  `schemas/board.schema.json` and `schemas/system-manifest-v1.schema.json` now
  track this release; `packages/alp-core/src/validation/vendoredSchemas.ts` is
  the single source for the tag and both hashes.
  - `board.schema.json` — two changes that alter what the editor accepts, both
    detailed at the hash in that file: `som.sku`'s pattern
    widens to permit any 2-digit AEN config tail and any 3-digit V2N/V2M tail,
    and `storage[].raw` (the legacy `fs: raw` alias) is removed. Neither needs
    product code: the SKU widening only stops the editor pre-rejecting a
    PLM-allocated SKU with no shipped preset, and `raw: true` was measured
    upstream as used by **zero** tracked `board.yaml` files before removal.
  - `system-manifest-v1.schema.json` — description text only (the emitter is now
    named as the `alp_orchestrate` package rather than
    `scripts/alp_orchestrate.py`). No property changed, so the manifest reader is
    unaffected.
  - SoM catalogue — **unchanged at 11 SKUs** (`E1M-AEN301/401/501/601/701/801`,
    `E1M-NX9101`, `E1M-V2M101/102`, `E1M-V2N101/102`). Every hand-maintained SKU
    surface in this repo stays correct; the `ideHub.projectScaffold` gates
    ("E1M_MODULES ids match the SDK's e1m_modules manifests exactly", "the
    minimum-viable snippet offers every SKU the SDK ships") pass against the
    v0.15.0 tree unchanged. Six of the eleven preset YAMLs DID move
    (`E1M-AEN301`, `E1M-AEN801`, `E1M-V2N101`, `E1M-V2N102`, `E1M-V2M101`,
    `E1M-V2M102`) — a new `memory_map:` override on AEN801 (alp-sdk#1069;
    disjoint `he_slot0` `0x80010000` / `hp_slot0` `0x802b0000`) and new
    `soc_peripheral_instances:` + `*_driver_status` blocks on the V2N/V2M four —
    plus `metadata/e1m_modules/*/hw-revisions.yaml`. None of it is read here: no
    `id`, `family`, `sku` or `topology` field changed, which is what the
    hand-maintained surfaces key on.
  - Kconfig catalogue — two vendored artefacts, both regenerated:
    `src/lsp/generated/kconfig-metadata.json` 221 → 222 symbols (one new entry,
    `CMSISSTREAM`, from `metadata/libraries/cmsis-stream.yaml`), and
    `test/fixtures/alp-kconfig-symbols.txt` 346 → 350 (`ALP_SDK_CC3501E_REQUEST_LOCK_TIMEOUT_MS`,
    `ALP_SDK_MPROC_BOOT_ALIF_SE_DEFERRED_TOC`,
    `ALP_SDK_MPROC_BOOT_ALIF_SE_DEFERRED_TOC_ENTRY_ID`,
    `ALP_SDK_MPROC_BOOT_ALIF_SE_DEFERRED_TOC_PEER_IS_HP`). The fixture carries no
    `submoduleRev` and `test/lsp.kconfig.test.js:146` only asserts curated ⊆
    vendored, so a stale snapshot of it stays GREEN — it has to be regenerated by
    hand on every bump. The README procedure below now says so.
  - **Known limitation this release made concrete — now FIXED (#493).** A single
    vendored schema is a snapshot serving every SDK version a customer might
    have checked out, and the extension pins no SDK version (only the advisory
    `MIN_SDK_VERSION` floor above). So re-vendoring forward moved the
    `raw: true` disagreement onto customers still on v0.14.0, whose SDK accepts
    it. **The editor now validates against `<sdkRoot>/metadata/schemas/*.json`**
    when an SDK is resolved (`src/yamlSchemaContributor.ts`, registered through
    `redhat.vscode-yaml`'s `registerContributor`); `contributes.yamlValidation`
    keeps the vendored copies and they are the no-SDK fallback. This is the same
    move `alp/updateSdkCatalog` already makes for the SoM catalogue.

    Three things about that are worth knowing before changing it:

    - **The SDK's schema is untrusted input** — it sits on a path the customer
      controls. `packages/alp-core/src/validation/schemaSafety.ts` refuses one
      that is oversized, is not a JSON object, or carries an `http(s)` `$ref`
      (which would make opening `board.yaml` fetch over the network). A refusal
      falls back to the vendored copy, so it degrades to the pre-#493 behaviour
      rather than to no validation.
    - **The residual disagreement is the CONFIGURATOR, not validation.**
      `parseBoardConfig`/`serializeBoardConfig` whitelist top-level keys against
      `BOARD_KEY_ORDER` and silently drop the rest. An SDK newer than this
      extension can therefore accept a key the visual configurator deletes on
      save; before #493 the editor red-squiggled such a key, which deterred it
      by accident. The language-status item now names those keys explicitly and
      goes to Warning when there are any.
    - **After an `alp sdk switch`, an OPEN and UNEDITED `board.yaml` keeps its
      old diagnostics** until its next edit, save, or reopen. vscode-yaml
      consults the provider per validation pass and exposes no "revalidate now".
      Every other document picks up the new schema at once.

- **alp-sdk v0.16.0 — compatible; both schemas re-vendored, one product change
  required** (assessed 2026-09-06). Tag `v0.16.0`, commit
  `eb96112ba7d1cc3b4084c985962ea31772177d74`. Both vendored schemas now track
  this release; `packages/alp-core/src/validation/vendoredSchemas.ts` stays the
  single source for the tag and both hashes
  (board `1549c708…`, system-manifest `abbe4a44…`).
  - `system-manifest-v1.schema.json` — **the one change that needed code.**
    `helper_mcus[]`'s `required` moves from `["name","chip"]` to
    `["name","chip","flash_policy"]`, and gains `flash_policy`
    (`enum ["customer","factory","recovery_only"]`) plus an unenumerated
    `update_channel`. The schema is explicit that there is **no
    absent-means-`customer` default**, and that the keys are independent — "a
    consumer must not read one key's presence as excluding another's".
    v0.16.0 ships 11 SoM presets; the 10 that declare a helper all declare
    `flash_policy: recovery_only` (E1M-NX9101 declares `helper_firmware: []`).
    Enforcement is tan's, and this extension **discloses without filtering**.
    `packages/alp-core/src/flash/consent.ts` attaches the policy to the helper's
    entry as a verbatim note and still lists it under "will be programmed";
    only the `--core`/`--helper` scope ever moves an entry to `skipped`.
    An unrecognised value is quoted as itself, never folded into the absent case.

    **Why not filter — the divergence that makes it unsafe.** A first cut moved
    every non-`customer` helper into "Skipped, NOT written", reasoning that tan
    would decline it anyway. That is a PREDICTION of `helper_flash_gate`
    (`python/tan/core/flash_plan.py`, tan-cli#611) and it is WRONG for the
    absent case at the pinned tan (`SUPPORTED_CLI_VERSION = "0.6.0"`,
    `src/alpCli/service.ts:98`): `if not policy:` returns a skip only when a
    method AND a channel are both declared, else dispatch continues. Every
    V2N/V2M manifest emitted by alp-sdk <= v0.15.0 is exactly that shape —
    upstream's own v0.15.0 golden `rpmsg-v2n.system-manifest.snap` carries
    `{name: gd32_bridge, chip: gd32g553, flash_method: swd_probe,
    flash_args: {interface: cmsis-dap, target: gd32g553, base: '0x08000000'}}`
    with no `flash_policy` and no `update_channel`. The consent screen would
    have printed "Skipped, NOT written" over a real SWD write to `0x08000000`,
    which is `consent.ts`'s own rule (a) inverted: over-listing costs a line,
    under-listing is a device programmed without consent.
    The **root** property set is unchanged (the same eight keys), so the
    read-only Memory-tab tripwire in `test/memoryRegions.readOnly.test.js` still
    passes: alp-sdk's schema-only `memory` root key is on an unmerged branch,
    not on this tag.
  - `board.schema.json` — six edits, five of them description text. The
    structural one: `boot.swap_algorithm` **loses its `"default": "scratch"`**.
    There is now no fixed schema default (the SDK derives it from the target's
    real slot layout), and on a single-slot target — E1M-AEN801, whose
    disjoint-slot0 `memory_map:` has no slot1/scratch region (alp-sdk#1069 /
    #1413) — setting any of the three values explicitly is a build-time
    `OrchestratorError`. The Configurator's own `|| "scratch"` default was
    **deliberately NOT fixed in the re-vendor** — different file, different test
    surface, no coupling to the schema hashes — and was removed separately in
    #658: `SWAP_ALGORITHM_CHOICES` now offers `(SDK default)` first and the
    absent key renders as absent, gated by
    `test/configurator.swapAlgorithmDefault.test.js`. Still open on #658:
    offering only the values the resolved target accepts. That needs the
    single-slot fact on the wire, and neither `alp presets` nor
    `metadata/catalog.json` carries it — the count the issue asked for is
    all six of `E1M-AEN301` / `E1M-AEN401` / `E1M-AEN501` / `E1M-AEN601` /
    `E1M-AEN701` / `E1M-AEN801`, each declaring the same disjoint-slot0
    `memory_map:` (`he_slot0` at `0x80010000`, `hp_slot0` at `0x802b0000`,
    no `slot1`, no `scratch`).
  - **Top-level property set UNCHANGED** — the same 21 keys, still
    `additionalProperties: false` — so `BOARD_KEY_ORDER`
    (`packages/alp-core/src/board/models.ts`) needed no change and the C1
    round-trip data-loss gate is unaffected.
  - **Every `$ref` is still `#/$defs/...`** (board.schema.json; the manifest
    schema carries none), so `schemaSafety.ts`'s `^#`-only acceptance keeps
    serving an SDK's own copy instead of silently falling every customer back to
    the bundled one.
  - SoM catalogue — **unchanged at 11 SKUs**, same list as v0.15.0.
  - Kconfig catalogue — both vendored artefacts regenerated; the symbol sets did
    **not** move (`src/lsp/generated/kconfig-metadata.json` stays 222 symbols and
    changed only its `submoduleRev`; `test/fixtures/alp-kconfig-symbols.txt`
    stays 350 and is byte-identical).
  - Fixtures — `test/fixtures/system-manifest.aen801.yaml` was replaced with a
    byte-exact copy of upstream's own governed golden
    `tests/fixtures/emit-snapshots/rpmsg-aen.system-manifest.snap`. The file it
    replaced was **not** a real emit despite three tests calling it one: a
    v0.7.0 E1M-AEN701 emit with `sku`/`silicon` string-substituted (`eb2d77d6`),
    still carrying `machine: e1m-aen701-a32`.
  - New gate — `test/systemManifest.fixtures.schemaConformance.test.js`. Nothing
    previously validated a fixture against the vendored schema, which is why a
    fixture missing a REQUIRED key stayed green through the whole suite. It is a
    required-key presence check only (no types, enums, or
    `additionalProperties`); verified to fail on the pre-v0.16.0 fixture and
    pass on the replacement.
