# Design: Phase 2a — v0.6 board.yaml realignment + SKU-aware data layer + full configurator

**Date:** 2026-05-25
**Status:** Draft v2 (pending review) — **supersedes the earlier draft that modeled the
pre-v0.6 board.yaml.**
**Roadmap:** Phase 2a of `2026-05-24-alp-studio-roadmap.md`.
**Branding:** Use **"Alp"**, never "ALP", in all text strings.
**Decision:** Build **full v0.6, all blocks** (user choice).

## Problem

The extension is built on a **pre-v0.6 board.yaml** (`BoardModel = {schema_version,
som:{sku}, carrier:{name,populated}, os, inference:{backend,arena}, libraries[], iot{},
diagnostics{}}`). The current SDK (`metadata/sdk_version.yaml` = 0.6.0) uses a
**fundamentally different, per-core schema** (`metadata/schemas/board.schema.json`). The
configurator therefore writes board.yaml that the SDK rejects, and dropdowns are empty
because the catalogue loader reads the wrong metadata paths.

### v0.6 board.yaml shape (authoritative: `board.schema.json`; example below)

Top-level (`additionalProperties:false`, required `som`+`cores`, top-level `os`
**forbidden**):
`name?`, `description?`, `preset?` **xor** inline (`populated?` + `e1m_routes?`),
`hw_rev?`, `som{sku,hw_rev?}`, `cores{<id>:core_entry}`, `pins[]`, `ipc[]`,
`diagnostics{last_error,log_level,modules{}}`, `storage[]`, `security{psa{…}}`,
`boot{method,signing,slots,swap_algorithm,…}`, `ota{provider,server,rollback,…}`,
`chips[]`, `features{}`, `supported_boards[]`.

`core_entry` (per core, all optional, inherits SoM `topology`): `os(zephyr|yocto|
baremetal|off)`, `app`, `image`, `peripherals[]` (enum), `libraries[]` (25-lib enum,
**underscores** e.g. `cmsis_dsp`,`tflite_micro`), `extra_libraries[]`,
`memory{stack_kib,heap_kib,isr_stack_kib}`, `power{sleep_mode,wakeup_sources[]}`,
`inference{default_arena_kib}` (**no backend** — silicon-fixed), `iot{wifi,mqtt,ble,tls}`.

Real example (`examples/aen/edgeai-vision-aen/board.yaml`):
```yaml
som: { sku: E1M-AEN701 }
preset: e1m-evk
pins:
  - { e1m: E1M_I2C0, macro: EVK_I2C_BUS_SENSORS, doc: "…" }
cores:
  a32_cluster: { os: "off" }
  m55_hp: { app: ./src, inference: { default_arena_kib: 256 } }
diagnostics: { log_level: info }
```

## Scope

1. **Replace `BoardModel` with a v0.6 model** + parse/serialize/validate.
2. **SKU-aware data layer** (SoM/board/chip/library/socs catalogue) from the real metadata.
3. **Full configurator** — a section per schema block, SKU-driven, site-styled.

## Pre-work facts (confirmed from the real repo — no longer open)

- `inference.backend` does not exist anywhere; backend is silicon-fixed. Per-core
  `inference` carries only `default_arena_kib` (min 16, default 128).
- `libraries` is a **per-core** enum using **underscores** (`cmsis_dsp`, `tflite_micro`,
  `nlohmann_json`, …) — 25 entries; `extra_libraries[]` is the open-set escape hatch.
- `os` is **per-core** (`cores.<id>.os`), top-level `os` is forbidden.
- Board population is `preset:` (ref to `metadata/boards/<preset>.yaml`) **xor** inline
  `populated:` + `e1m_routes:` (mixing rejected).
- `chips[]` is a top-level project-wide array (separate from board `populated`).
- Cross-field rule (from a real example): `iot.tls: true` on a core requires `mbedtls`
  or `bearssl` in that core's `libraries[]`. Treat the SDK's
  `scripts/validate_board_yaml.py` rules as the source of truth; mirror the ones we can.
- SoM SKU regex: `^E1M-(AEN[3-8]01|V2N10[12]|V2M10[12]|NX9[0-9]{3})$` (the 11 SKUs).

---

## Part 1 — v0.6 board.yaml model

`packages/alp-core/src/board/` (pure: types + parse + serialize + validate). Replaces the
old `configurator/models.ts` `BoardModel` usage.

### Types (`board/models.ts`)

A TypeScript mirror of `board.schema.json`. Key interfaces: `BoardConfig` (top level),
`CoreEntry`, `Storage`, `Security`, `Boot`, `Ota`, `IpcEntry`, `Diagnostics`,
`E1mRoutes`/`RouteEntry`, `PinRef`. Optionality matches the schema. The vendored schema
JSON (below) remains the **authoritative** validation source; the TS types serve the
configurator's editing + round-trip.

### Parse / serialize (`board/parse.ts`, `board/serialize.ts`)

- `parseBoardConfig(yamlText): BoardConfig` — `js-yaml` load + shape mapping; unknown keys
  preserved into `features`/passthrough where the schema allows, else dropped with a log.
- `serializeBoardConfig(cfg): string` — emit canonical YAML; **omit defaults** and empty
  blocks (mirrors the SDK's own normalization), keep `preset` xor inline invariant, keep
  per-core entries minimal (only fields that differ from SoM `topology` defaults).
- Round-trip test: parse→serialize of each real example is stable (semantically equal).

### Validation (`board/validate.ts` + vendored schema)

- **Vendor** `metadata/schemas/board.schema.json` → `schemas/board.schema.json` in the
  extension. Wire `package.json` `contributes.yamlValidation` to it (replaces the missing
  `board-config-v1.schema.json` path) so the YAML editor gets live schema validation.
- Programmatic structural validation against the vendored schema (lightweight validator;
  no heavy deps — a minimal JSON-Schema check sufficient for our subset, OR reuse the YAML
  extension's diagnostics) plus the **cross-field rules** we mirror (e.g. tls⇒mbedtls,
  preset-xor-inline, core ids ∈ SoM topology). Feeds the configurator's validation panel.

### Migration (old-shape board.yaml)

Detect a pre-v0.6 board.yaml (`carrier:` / top-level `os` / top-level `libraries`) and
offer a one-shot **"Migrate to v0.6"** action: map `os`→single-core default, `carrier.name`
→`preset`, `carrier.populated`→inline `populated`, top-level `libraries`/`iot`→the primary
core. Update the repo's `.scratch/board.yaml` fixture to a valid v0.6 example.

---

## Part 2 — SKU-aware data layer

`packages/alp-core/src/sdkCatalogue/` (pure) + `src/sdkCatalogue/vscodeAdapter.ts` (fs).
(Unchanged in intent from the prior draft — still correct.)

### Models (`sdkCatalogue/models.ts`)

```
SomPreset { sku; displayName; family; silicon; siliconVariant?;
            preferredBackend; capabilities: Record<string,boolean>;
            defaultBoard?; topologyCoreIds: string[]; onModule: string[];
            memory?: {dramMbit?;flashMbit?}; preliminary; }
BoardPreset { name; displayName; hostsSomFamilies: string[];
              populated: Record<string,boolean>; }
ChipDef { chipId; displayName; vendor?; bus?; driverStatus?;
          families: string[]; kconfig?: {zephyr?;baremetal?}; }
LibraryProfile { id; displayName?; }          // underscores, matching the schema enum
SocSpec { ref; vendor; family; part; cores: {id;type;count;freqMhz}[]; }  // from socs/*.json
SdkCatalogue { soms; boards; chips; libraries; socs; sdkVersion?; }
```

### Parsers (pure) + derivations

`parseSomPreset`, `parseBoardPreset`, `parseChipDef`, `parseSocSpec`;
`boardsForSom`, `chipsForSom`, `chipDefaults(board)`,
`coreIdsForSom(som)` (from topology), `coresForSom→SocSpec` (resolve cores via `silicon`),
`acceleratorAvailability(som)` (preferredBackend lit; `deepx_dxm1` iff `capabilities.deepx_dx`;
CPU always — encodes "AEN has no DeepX").

### fs adapter (`loadSdkCatalogue(sdkRoot)`)

Reads (real paths): `metadata/e1m_modules/E1M-*.yaml` (flat), `metadata/boards/*.yaml`,
`metadata/chips/*.yaml`, `metadata/library-profiles/*/` (dir names → ids),
`metadata/socs/**/*.json`, `metadata/sdk_version.yaml`. Empty/missing → empty arrays + log;
one bad file skipped, not fatal. Replaces the wrong-path `loadSomSkus`/`loadCarrierPresets`.

---

## Part 3 — Full configurator (v0.6, SKU-driven, site-styled)

Reworks the webview (`configurator/panelHtml.ts`, `media/configurator.{css,js}`,
`src/configuratorPanel.ts`). Keep the message-passing + save/validate/preview architecture;
replace the model, markup, styling, and add a section per v0.6 block.

### Visual system (from `alplab-website/src/styles/tokens.css`, Indigo-dark default)

Tokens copied into the webview CSS; **Inter** + **Roboto Mono** bundled to `media/fonts/`
(`font-src ${cspSource}`); header matches the site TopNav (`rgba(6,7,13,.85)` +
backdrop-blur + hairline bottom border) with the **real white wordmark** used **as-is —
never recolored**; 5px radii; mono-uppercase `§` labels; brand-indigo primary CTA;
accent-npu focus ring; compute-coded accents (cpu/npu/flux).

### Layout

Left **sidebar nav + search** (built to host multiple labeled groups so 2b's dev-tools
rail slots in later). Sections, each editing its schema block:

- **§ Project** — `som.sku` (grouped by family), `name`/`description`, board mode toggle
  **preset** (pick a `BoardPreset`, filtered by `boardsForSom`) **xor inline**.
- **Hardware (derived, read-only)** — SKU card: silicon, cores (from SocSpec), derived
  backend, default board, on-module chips, **accelerator availability** (DeepX struck
  through for AEN/NX/V2N).
- **§ Cores** — one editable panel per core id (from SoM topology): `os`, `app`/`image`,
  `peripherals[]`, `libraries[]` (SDK list, enable/disable), `extra_libraries[]`,
  `memory{}`, `power{}`, `inference.default_arena_kib`, `iot{wifi,mqtt,ble,tls}`.
- **§ Board population** — inline mode: chips `populated` toggles (from `chipsForSom`,
  defaults from preset) + `e1m_routes`/`pins` editor. Preset mode: read-only preset view.
- **§ Chips** — project-wide `chips[]` (the `<alp/chips/…>` direct-link list).
- **§ Diagnostics** — `last_error`, `log_level`, per-module `modules{}` overrides.
- **§ Storage** — `storage[]` partitions (name/size/fs/mount/flash_device/offset).
- **§ Security** — `security.psa` (slots, ITS/PS storage, tfm, attestation_root).
- **§ Boot** — `boot` (method, signing alg+key, slots, swap, anti_rollback, build_type).
- **§ OTA** — `ota` (provider, server, rollback, poll, storage).
- **§ IPC** — `ipc[]` carve-outs (kind, endpoints, size, name).
- **§ Review** — validation summary + effective-config preview + `supported_boards[]`.

### SKU-driven behavior

Selecting `som.sku` re-derives: the hardware card; the **core panels** shown (from SoM
topology ids); the **carrier/preset list** (`boardsForSom`); the **chip list**
(`chipsForSom`); accelerator availability; default board/preset. Backend is shown
read-only, never editable.

### Footer / actions

Validation summary (errors/warnings incl. the mirrored cross-field rules) ·
`Preview effective config` · `Reload` · `Save board.yaml` (brand CTA).

---

## Architecture / data flow

```
alp-sdk checkout (sdkRoot) ─ loadSdkCatalogue ─→ SdkCatalogue ─┐
project board.yaml ─ parseBoardConfig ─→ BoardConfig ──────────┤
                                                               ↓
configuratorPanel → init {BoardConfig, SdkCatalogue, derived} → webview
  webview: edit per-section (pure JS over payload) → validate →
           Save → serializeBoardConfig → write board.yaml
```

## Error handling

- No `sdkRoot` → empty catalogue → configurator shows "Connect your alp-sdk
  (`alpSdk.path`)" instead of empty controls.
- Pre-v0.6 board.yaml detected → offer migration (above), don't silently corrupt.
- Malformed metadata/board files → log + skip/degrade; never invent values (`TBD`→omit).

## Testing

Pure, `node --test` with fixtures copied from the real repo under `test/fixtures/`:
- **board model:** parse+serialize round-trip stable for ≥3 real examples (preset+inline,
  multi-core, boot/ota/security); top-level `os` rejected; preset-xor-inline enforced;
  tls⇒mbedtls cross-field rule fires.
- **catalogue:** `parseSomPreset`/`parseBoardPreset`/`parseChipDef`/`parseSocSpec`;
  `acceleratorAvailability` (AEN no DeepX, V2M DeepX); `boardsForSom`/`chipsForSom`/
  `coreIdsForSom`.
- **manual (dev host)** against `C:\Users\caner\Documents\GitHub\alp-sdk` via `alpSdk.path`:
  11 SKUs populate; AEN↔V2M flips backend + DeepX; core panels match SoM topology;
  save produces schema-valid v0.6 board.yaml; styling matches the site.

## Files

- Create `packages/alp-core/src/board/{models,parse,serialize,validate}.ts` (pure).
- Create `packages/alp-core/src/sdkCatalogue/{models,parse}.ts` (pure) +
  `src/sdkCatalogue/vscodeAdapter.ts` (fs).
- Vendor `schemas/board.schema.json`; point `package.json` `yamlValidation` at it.
- Rework `packages/alp-core/src/configurator/{models,panelHtml}.ts`,
  `media/configurator.{css,js}`, `src/configuratorPanel.ts`,
  `src/configurator/vscodeAdapter.ts` (use new catalogue + board model).
- Add `media/fonts/*` (Inter+Roboto Mono woff2), `media/alplab-logo-white.svg`.
- Update `snippets/board-yaml.json` + `.scratch/board.yaml` to v0.6.
- Realign `src/boardSummary/*` + status bar (summary now reads `som.sku` + `preset`, not
  `carrier`/`os`).
- Tests + fixtures under `test/` and `test/fixtures/`.

## Build order within Phase 2a (for the implementation plan)

1. SKU-aware data layer (catalogue) — pure + adapter + tests.
2. v0.6 board model — types, parse, serialize, validate + vendored schema + tests.
3. Status bar / boardSummary realignment + `.scratch` + snippets migration.
4. Configurator shell — site styling, sidebar, header, message protocol, SKU-driven
   wiring (Project + Hardware card + Cores).
5. Remaining configurator sections — Board population, Chips, Diagnostics, Storage,
   Security, Boot, OTA, IPC, Review.
6. Migration action for pre-v0.6 board.yaml.

## Out of scope (later phases)

The eight developer tools (2b/2c/3) and the visual peripheral map (4). The configurator's
`e1m_routes`/`pins` editor here is form-based; the **graphical** pin/peripheral map is
Phase 4.
