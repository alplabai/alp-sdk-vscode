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

## Key data dependency (cross-cutting risk)

The catalogue (real SKUs, carriers, and `populated` maps) is loaded **at runtime from
a separate alp-sdk checkout**: `sdkRoot/metadata/e1m_modules/*/som.yaml` and
`sdkRoot/metadata/carriers/*/board.yaml` (`src/configurator/vscodeAdapter.ts`).

- `alp-sdk-upstream/` in **this** repo is currently **empty**, and the
  `board-config-v1.schema.json` referenced by `package.json` is **missing**.
- Without a real SDK checkout (via `alpSdk.path` or workspace autodetect), the
  configurator dropdowns are empty. **Phase 1 does not depend on this** (board summary
  only parses `board.yaml`); Phase 2/3 do.

## Phases

Each phase is its own spec → plan → implementation cycle.

### Phase 0 — SDK-data wiring (small, prerequisite for Phase 2+)
Init/restore `alp-sdk-upstream` (or document `alpSdk.path` setup), fix the missing
schema path, confirm the catalogue loads end-to-end. Done **alongside Phase 2** when
the catalogue is first actually needed.

### Phase 1 — Activity-bar home (START HERE; no data dependency)
Bolt icon in the activity bar → "Project" tree (board summary + grouped actions) with
a welcome-view fallback. Surfaces **"Configure board (GUI)"** as the featured action.
Detailed spec: `2026-05-24-alp-activity-bar-view-design.md`.

### Phase 2 — Elevate + upgrade the configurator
Open the configurator from the activity-bar home; add UX patterns: **board-picker
funnel** (SoM/carrier first), **categorized navigation + search**, theme-native
(VS Code UI toolkit) components, keep live validation + effective-config preview.
Pairs with Phase 0.

### Phase 3 — Visual peripheral / "populated" map (pin-configurator analog)
Graphical carrier view; click chips to toggle `carrier.populated`. **Decision:** add
**label metadata to the SDK** (friendly name + peripheral type, possibly position) so
the map renders real labels rather than raw chip keys (e.g. `lsm6dso`). This is
upstream SDK work bundled into Phase 3.

## Build order

Phase 1 → (Phase 0 + Phase 2) → Phase 3.

## Decisions log

- Pin configurator → **visual peripheral/populated map** (not true pin mux).
- Build approach → **elevate + upgrade the existing configurator** (reuse data layer
  and webview, don't rebuild from scratch).
- Phase 3 labels → **add label metadata to the SDK**.
- Start with **Phase 1**.
