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
  - SoM catalogue is sourced at runtime via `alp presets` (smoke-tested against a v0.8.0
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
  - **v0.11.0** — `metadata/schemas/board.schema.json` re-vendored (#117); the
    vendored `schemas/board.schema.json` currently tracks this release.
  - Caveat: `metadata/sdk_version.yaml` can lag the tag on a dev checkout (it
    read `0.7.0` at one HEAD), so the readiness floor is advisory — an absent or
    unparseable version is treated as "unknown, not behind" and never mis-flagged.
