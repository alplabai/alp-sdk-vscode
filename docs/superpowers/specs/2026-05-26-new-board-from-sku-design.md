# Onboarding — New board.yaml from SKU — Design

**Date:** 2026-05-26
**Status:** Approved (design); built autonomously — review in the morning.
**Branch:** feat/dev-tools

## Goal

A one-step **`Alp: New board.yaml from SKU`** command that writes a **valid v0.6
`board.yaml`** for a chosen SoM SKU into the workspace and opens it — so a fresh
project is immediately editable in the configurator and buildable.

## Key finding (flag for review)

The existing `Alp: New project wizard` (`src/wizard.ts`) is built on the
**pre-v0.6 `BoardModel`** (`@alp-sdk/core/configurator/service`: `carrier`, `os`,
`iot.wifi/mqtt/ble/tls`). It generates a **pre-v0.6 board.yaml** that does not
match the v0.6 schema the configurator/validator now use. Rewiring that whole
legacy subsystem is out of scope for this autonomous session (too risky
unattended). This feature instead adds a **focused, additive** generator on the
already-tested v0.6 board core, leaving the legacy wizard untouched. **Recommended
follow-up:** modernize or retire the legacy wizard.

## What makes a valid v0.6 starter

`validateBoardConfig` (`@alp-sdk/core/board/validate.ts`) requires only:
- `som.sku` present, and
- `cores` with ≥1 entry, and
- `preset` is **not** set together with inline `populated`/`e1m_routes`.

So a minimal valid starter omits `preset` and inline routing entirely and
declares the SoM's cores. No catalogue is strictly required, but when connected
we use the real core ids.

## Architecture

### Pure core — `@alp-sdk/core/board/starter.ts`

```ts
import { BoardConfig } from "./models";

export function buildStarterBoardConfig(sku: string, coreIds: string[]): BoardConfig;
```
- `name`: `"<sku> project"`.
- `som`: `{ sku }`.
- `cores`: if `coreIds` is non-empty, the **first** core id →
  `{ os: "zephyr", app: "app" }`, every other id → `{ os: "off" }`. If `coreIds`
  is empty (SDK not connected), a single `{ app: { os: "zephyr", app: "app" } }`.
- No `preset`, no `populated`/`e1m_routes` (keeps it valid + lets the user choose
  a preset in the configurator).
- Pure; the result passes `validateBoardConfig` (asserted in tests).

### VS Code adapter — `src/onboarding.ts`

`alp.newBoardFromSku` command:
1. Require an open workspace; target path = `<workspaceRoot>/board.yaml`.
2. Pick the SKU: from `loadSdkCatalogue(sdkRoot).soms` (QuickPick of SoM SKUs);
   if the catalogue is empty, fall back to an input box (default `E1M-AEN701`).
3. `coreIds = coreIdsForSom(catalogue, sku)` (empty when disconnected).
4. `cfg = buildStarterBoardConfig(sku, coreIds)`; `content = serializeBoardConfig(cfg)`.
5. If `board.yaml` already exists → modal confirm ("Overwrite board.yaml?"). If
   declined, abort.
6. Write the file, open it in the editor, and show an info message offering
   **Open configurator** (`alp.openConfigurator`).

Reuses: `loadSdkCatalogue` (sdkCatalogue adapter), `collectProjectContext`,
`coreIdsForSom` + `serializeBoardConfig` (core).

## Components & files

- Create core: `packages/alp-core/src/board/starter.ts`.
- Create adapter: `src/onboarding.ts`.
- Create test: `test/board.starter.test.js`.
- Modify: `src/extension.ts` (register `registerOnboardingCommands`), `package.json` (command `alp.newBoardFromSku`).

## Error handling

- No workspace → error message, abort.
- No SDK / empty catalogue → input-box SKU fallback; `coreIds` empty → single
  generic core (still valid).
- Existing `board.yaml` → modal overwrite confirm (default safe: abort).
- Write failure → error message with the reason.

## Testing

Pure core (`node:test`):
- `buildStarterBoardConfig("E1M-AEN701", ["a32_cluster","m55_hp"])` → `som.sku`
  set, `name` includes the sku, first core (`a32_cluster`) `os:"zephyr"` with
  `app:"app"`, second (`m55_hp`) `os:"off"`; `validateBoardConfig(result).errors`
  is empty.
- `buildStarterBoardConfig("X", [])` → single `app` core `os:"zephyr"`;
  `validateBoardConfig` errors empty.
- No `preset` key set (so no preset/inline conflict).

Adapter (command, picker, file write, open) verified in the dev host.

## Out of scope

- Modernizing/retiring the legacy `alp.newProjectWizard` (flagged above).
- Folder/app source scaffolding (the generator writes board.yaml only; module
  scaffolding already exists via `alp.scaffoldModule`).
- Choosing a preset/cores layout interactively (the user does that in the
  configurator after the file opens).
