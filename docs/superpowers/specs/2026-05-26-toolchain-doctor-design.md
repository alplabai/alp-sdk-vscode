# Toolchain Bootstrap + Doctor — Design

**Date:** 2026-05-26
**Status:** Approved (design); spec under review
**Branch:** feat/dev-tools

## Goal

Give developers a single, structured read on whether their machine can build an
Alp/Zephyr project, with one-click fixes for what's missing. A new
**`Alp: Toolchain doctor`** command probes the toolchain, analyzes it in tested
pure core, and reports it **both** in the Alp output channel (with quick actions)
and a **webview panel** (per-row status + Fix buttons). The existing per-OS
install plans in `src/bootstrap.ts` move into tested core and become the doctor's
fix actions.

## Current state

- `alp.sdkStatus` (`src/sdkStatus.ts`) already probes alp-sdk / SDK version /
  catalogue / Python / west via `execFileSync` and offers "Install dependencies"
  / "Settings". It is SDK-connection focused and stays as-is (it will reuse the
  shared probe helper, not duplicate it).
- `src/bootstrap.ts` builds per-OS (`zephyr`/`yocto`/`baremetal`) install plans
  inline and sends them to a terminal. The plan logic is not tested.
- There is no structured check of the *build* toolchain (cmake/ninja/dtc/gdb,
  the Zephyr SDK, importable Python deps, the `alp` CLI).

## Scope decisions (flag for review)

- The doctor targets the **Zephyr build toolchain** (the common Alp path). v0.6
  `board.yaml` has no top-level `os`, so the doctor does **not** infer os; it
  reports the Zephyr prerequisites and links to the existing bootstrap for
  yocto/baremetal. (Noted as an assumption.)
- "Required vs recommended": cmake, ninja, dtc, west, the Zephyr SDK are
  **required** to build; Python + pip deps are required for the loader; the
  `alp` CLI and `ZEPHYR_BASE` are **recommended**.
- Fixes are **non-destructive**: a fix action opens a terminal with the install
  command (the user runs it) — never auto-executes installs. Vendor/licensed
  toolchains (Zephyr SDK installer) are links, not commands.

## Architecture

Pure, tested logic in `@alp-sdk/core/toolchain/*`; thin VS Code adapter probes
the environment and renders.

### Pure core

`@alp-sdk/core/toolchain/doctor.ts`
- `ToolProbe = { present: boolean; detail?: string }` — one tool's probe result.
- `ToolchainInputs` — the injected facts:
  ```ts
  interface ToolchainInputs {
    tools: Record<string, ToolProbe>;   // keyed by tool id: python, west, cmake, ninja, dtc, gdb, alp
    pythonDeps: Record<string, boolean>; // importable? pyyaml, jsonschema, west
    env: { zephyrSdkDir?: string; zephyrBase?: string };
    sdkConnected: boolean;               // alpSdk.path resolves
  }
  ```
- `DoctorCheckStatus = "ok" | "missing" | "warn"`.
- `DoctorCheck = { id: string; label: string; status: DoctorCheckStatus; detail: string; required: boolean; fixId?: ToolchainFixId }`.
- `ToolchainReport = { checks: DoctorCheck[]; ok: boolean; missingRequired: number }`.
- `analyzeToolchain(inputs: ToolchainInputs): ToolchainReport` — pure; builds the
  ordered check list, sets status/required/fixId, computes `ok`
  (no required check missing) and `missingRequired`.

`@alp-sdk/core/toolchain/bootstrapPlan.ts` (refactor of `bootstrap.ts` logic)
- `ToolchainFixId` — union: `"python-deps" | "west" | "zephyr-sdk" | "yocto-host" | "vendor-baremetal"`.
- `BootstrapHost = "linux" | "darwin" | "win32"`; `BootstrapOs = "zephyr" | "yocto" | "baremetal"`.
- `BootstrapPlan = { title; steps: { description; command }[]; pointers: { name; url }[] }`.
- `planForHost(host, os): BootstrapPlan` — moved verbatim from bootstrap.ts (now tested).
- `fixCommand(fixId, host): { description; command } | { pointer: { name; url } }` —
  maps a doctor `fixId` to the install command (or a doc pointer for licensed items).

### VS Code adapter

`src/toolchain/vscodeAdapter.ts`
- `probeTool(cmd, args)` — shared `execFileSync` version probe (the existing
  `probe` in sdkStatus is moved here so both reuse it).
- `probePythonDep(python, module)` — `python -c "import <module>"` → boolean.
- `collectToolchainInputs(): ToolchainInputs` — gathers `tools`, `pythonDeps`,
  `env` (`process.env.ZEPHYR_SDK_INSTALL_DIR` / `ZEPHYR_BASE`), `sdkConnected`
  (from `collectProjectContext().sdkRoot !== null`).

`src/toolchain/doctorPanel.ts` — the webview (mirrors `hardwareExplorerPanel.ts`):
renders `ToolchainReport` rows with status icons and Fix buttons; a Fix button
posts `{ type: "fix", fixId }` → the command runs the bootstrap fix.

`src/toolchain.ts` — registers `alp.toolchainDoctor`:
1. `collectToolchainInputs()` → `analyzeToolchain(...)`.
2. Write a structured report to the Alp output channel.
3. Show an info message: "Toolchain — N issue(s)" with **Show report** (opens the
   panel), **Fix missing** (runs the relevant bootstrap), **Settings**.
4. The panel shows the same report with per-row Fix.

### Pure-core view-model for the panel

`@alp-sdk/core/toolchain/doctorHtml.ts` — `createDoctorPanelHtml({ nonce, cspSource, cssUri, jsUri })` (shell HTML, CSP nonce), matching the configurator/hardware-explorer pattern. The renderer (`media/toolchainDoctor.js`) draws rows from the posted `ToolchainReport`.

## Components & files

- Create core: `toolchain/doctor.ts`, `toolchain/bootstrapPlan.ts`, `toolchain/doctorHtml.ts`.
- Create adapter: `src/toolchain/vscodeAdapter.ts`, `src/toolchain/doctorPanel.ts`, `src/toolchain.ts`.
- Create media: `media/toolchainDoctor.js`, `media/toolchainDoctor.css`.
- Modify: `src/bootstrap.ts` (use core `planForHost`), `src/sdkStatus.ts` (reuse the moved `probeTool`), `src/extension.ts` (register `registerToolchainCommands`), `package.json` (command `alp.toolchainDoctor`).
- Tests: `test/toolchain.doctor.test.js`, `test/toolchain.bootstrapPlan.test.js`.

## Data flow

`alp.toolchainDoctor` → `collectToolchainInputs()` (probes) → `analyzeToolchain()`
(pure) → output channel + info message + webview panel. A Fix (message or action)
→ `fixCommand(fixId, host)` → terminal with the install command (user runs) or an
external doc link.

## Error handling

- A probe that throws/times out → `present: false` (never crashes the doctor).
- No workspace / SDK not connected → still runs (those become `warn`/`missing`
  checks, not errors).
- Webview unavailable is irrelevant (panel is created on demand).
- Fix for a licensed toolchain → opens the doc URL, no command.

## Testing

Pure core (`node:test`):
- `analyzeToolchain` — all present → `ok: true`, 0 missing; a missing required
  tool (e.g. cmake) → `status: "missing"`, `required: true`, sets `fixId`,
  `ok: false`, `missingRequired` counted; a missing recommended (alp CLI) →
  `warn`, doesn't fail `ok`; `pythonDeps` missing → the Python-deps check is
  `missing` with `fixId: "python-deps"`.
- `planForHost` — zephyr/yocto/baremetal × host produce the expected step
  commands + pointers (port the current behavior into assertions).
- `fixCommand` — each `fixId` maps to the right command/pointer per host.

Adapters (probing, panel, terminal) + the webview are verified in the dev host /
headless render (repo convention).

## Out of scope

- Auto-installing anything (all fixes are user-run commands / links).
- os inference from board.yaml (Zephyr-focused; yocto/baremetal via bootstrap).
- Version-minimum enforcement (presence + reported version only; no semver gates).
