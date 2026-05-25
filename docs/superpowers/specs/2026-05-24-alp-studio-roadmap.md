# Roadmap: Alp Studio — comprehensive-yet-easy configuration experience

**Date:** 2026-05-24
**Status:** Approved (phased)
**Branding:** Use **"Alp"** (not "ALP") in all new UI strings.

## Vision

Make the Alp SDK fully configurable from inside VS Code through a discoverable,
comprehensive-yet-easy experience — anchored on the patterns proven by the best
embedded SDK extensions (Nordic nRF Connect, ESP-IDF, PlatformIO, STM32, NXP),
adapted to Alp's **SoM + carrier preset** model.

## Reality model (important)

Alp is **not** a bare-MCU SDK. There is **no per-pin mux / clock-tree** in
`board.yaml`. The configuration surface is preset-based:

- `som.sku`, `carrier.name`, `os` (required)
- `inference.{backend, default_arena_kib}`
- `iot.{wifi, mqtt, ble, tls}`
- `libraries[]`
- `diagnostics.{last_error, log_level}`
- `carrier.populated{}` — which chips/peripherals are populated on the carrier

The honest analog of a "pin configurator" is a **visual peripheral / populated
map** over `carrier.populated` — not pin muxing.

## Existing assets to reuse (do not rebuild)

- `@alp-sdk/core/configurator` — `BoardModel`, `PresetCatalogue`, save/parse, panel HTML.
- `ConfiguratorPanel` webview (`src/configuratorPanel.ts`) — already renders the full
  `board.yaml` surface with Basic/Advanced modes, validation, effective-config preview.
- Status-bar board-summary load path (`loadBoardSummary` + `collectProjectContext`).
- ~20 existing `alp.*` commands.

The original perceived gap ("I don't see the GUI") was **discoverability**, not
missing configuration: the configurator is launched by command, with no activity-bar
home. Hence the roadmap *elevates and polishes* existing code rather than rebuilding.

## SKU-driven model (the core domain truth)

The selected **SoM SKU drives the valid option space** — the extension must mirror
what alp-sdk does. Each `metadata/e1m_modules/E1M-*.yaml` SoM preset encodes
silicon-determined settings:

- `inference.preferred_backend` is **silicon-fixed** (AEN/NX → `ethos_u`, V2N →
  `drpai`, V2M → `deepx_dxm1`). Per the v0.6 schema, `inference.backend` was **removed
  as a customer field** — the UI must *derive and display* the backend, not offer a
  free picker. Only V2M SKUs expose DeepX.
- `capabilities` (per-SKU booleans: `deepx_dx`, `optiga_trust_m`, `tmu_*`, …),
  `default_board`, `memory`, `topology` (heterogeneous A-cluster Yocto machine +
  M-core Zephyr boards), `on_module` chips, `pad_routes` (E1M pad → dispatch chip/pin),
  and the on-module I2C device map.

Board presets (`metadata/boards/*.yaml`) carry `name`, `display_name`,
`hosts_som_families` (constrains which SoMs a carrier supports), and `populated`
(chip→bool, grouped by comment into Motion / Storage / Audio / … — usable as map labels).

## Real alp-sdk metadata layout (authoritative) + loader drift

Verified against a real checkout (`C:\Users\caner\Documents\GitHub\alp-sdk`). The
current extension loader (`src/configurator/vscodeAdapter.ts`) targets the **wrong**
paths — this is why dropdowns are empty even with a checkout:

| Data | Extension currently expects | Real alp-sdk path |
|---|---|---|
| SoM SKUs | `e1m_modules/<sku>/som.yaml` (subdir) | flat `e1m_modules/E1M-*.yaml` |
| Carriers/boards | `metadata/carriers/<name>/board.yaml` | `metadata/boards/*.yaml` |
| board.yaml schema | `alp-sdk-upstream/…/board-config-v1.schema.json` (missing) | `metadata/schemas/board.schema.json` |

Other real dirs: `socs/<vendor>/<family>/<part>.json` (cores/memory/variants),
`chips/<name>/` (drivers behind `populated`), `library-profiles/` (the libraries),
`templates/`, `sdk_version.yaml`.

## Expanded program (supersedes the original 4 phases)

Dependency-ordered. The **SKU-aware data layer** is the keystone everything visual
depends on. Each phase is its own spec → plan → implementation cycle.

### Phase 1 — Activity-bar home ✅ DONE
Bolt icon → "Project" tree + welcome view (branch `feat/activity-bar-view`).

### Phase 2a — v0.6 realignment + foundation + full configurator (START HERE)
**Decision: full v0.6, all blocks.** The extension models a **pre-v0.6** board.yaml; the
real `metadata/schemas/board.schema.json` (SDK v0.6.0) is fundamentally different —
**per-core `cores:` slices**, `preset` xor inline `populated`/`e1m_routes`, top-level
`os` forbidden, per-core `libraries`/`iot`/`inference{arena}` (no backend), plus new
`chips[]`, `pins[]`, `storage[]`, `security{}`, `boot{}`, `ota{}`, `ipc[]`,
`diagnostics.modules{}`. So Phase 2a is:
1. **SKU-aware data layer** — real paths (flat `e1m_modules/E1M-*.yaml`,
   `metadata/boards/*.yaml`, `chips/*.yaml`, `library-profiles/*/`, `socs/**`); derived
   read-only backend; accelerator availability; carrier+chip filtering by family.
2. **v0.6 board model** — replace `BoardModel` with a full v0.6 model (parse/serialize/
   validate); vendor `board.schema.json`; migrate old-shape board.yaml.
3. **Full configurator** — site-styled (Indigo-dark, Inter/Roboto Mono, hairline header
   w/ real white wordmark, brand CTA), left sidebar + search, **SKU-driven**, with a
   section per v0.6 block (Project, Cores, Board population, Chips, Diagnostics, Storage,
   Security, Boot, OTA, IPC, Review). Detailed spec:
   `2026-05-25-phase-2a-data-layer-and-configurator-design.md`.

### Phase 2b — Reference tools  *(metadata/env only, no build needed)*
Hardware & pin-route explorer · Topology view · Per-SKU docs/datasheet links ·
Toolchain/SDK status + bootstrap.

### Phase 2c — Generated-config viewer + diff  *(uses existing generate step)*
Browse/diff `build/generated/{alp.conf,alp.overlay,alp-cmake-args.txt,alp-yocto.conf}`.

### Phase 3 — Runtime tools  *(need build/device)*
Build/Flash/Run integration · Serial monitor · Memory/flash report · Device/probe
manager.

### Phase 4 — Visual peripheral / `populated` map (pin-configurator analog)
Graphical carrier view; click chips to toggle `carrier.populated`. Labels from new
SDK metadata (friendly name + type), or grouped from the board-file comments.

## Build order

Phase 1 ✅ → **Phase 2a** → 2b → 2c → 3 → 4.

## Decisions log

- Pin configurator → **visual peripheral/populated map** (not true pin mux).
- Build approach → **elevate + upgrade the existing configurator** (reuse `BoardModel`
  + webview; redesign the UI; do not rebuild the data protocol from scratch).
- Visual style → **match alplab-website** (Indigo-dark default theme, Inter/Roboto
  Mono, real white wordmark logo used as-is — never recolor the bolt).
- Branding → **"Alp"**, never "ALP", in all text strings ([[branding-alp-not-allcaps]]).
- Backend is **SKU-derived and read-only** (v0.6 dropped the customer field).
- **Target the real v0.6 `board.schema.json`** — the extension's pre-v0.6 `BoardModel`
  is replaced wholesale (per-core `cores:`, preset/inline, `chips[]`, storage/security/
  boot/ota/ipc); **build all blocks** (user choice). Old board.yaml gets a migration path.
- Layout → **left sidebar nav + search** (confirmed from mockup).
- Developer tools → build **all eight** (serial monitor, generated-config viewer+diff,
  hardware/pin-route explorer, memory report, topology, toolchain status, probe
  manager, per-SKU docs) across phases 2b–3.
- **Start with Phase 2a** (foundation + configurator).
