# Extension ↔ CLI Integration Plan

Last revised: 2026-06-02. Status: **design / not yet implemented.**

How the VS Code extension should consume the native `alp` CLI so that command
behavior has a single source of truth — instead of being reimplemented per
surface. Companion to `cli-rs/PLAN.md` (the Rust CLI migration) and
`ARCHITECTURE_RULES.md` (the layer contract).

## 1. Why

Today every "surface" reaches the shared TypeScript core (`@alp-sdk/core`)
in-process: the extension imports it across ~26 files, the TS CLI wraps it, and
the LSP server links it. That keeps most *domain logic* shared. But two cracks
have appeared:

- **The Rust migration created a second core.** `cli-rs/crates/alp-core` mirrors
  `@alp-sdk/core`; they are kept in lockstep only by the contract harness. After
  cutover the Rust binary *is* the CLI, yet the extension still runs the TS core.
- **Bootstrap is genuinely triplicated.** `src/bootstrap.ts` (venv + west, no
  `west init/update`), `alp-core/toolchain/bootstrapPlan.ts` (`pip --user`), and
  the SDK's own `scripts/bootstrap.sh` (the real, complete flow) all disagree.

The envelope contract (`{command, ok, exitCode, project, data, issues}`, stable
exit codes) was designed for machine consumption. So the extension *can* treat
the `alp` binary as the single implementation and render its output — collapsing
"command behavior" to one place.

## 2. Target architecture

```
                       ┌───────────────────────────┐
   user (GUI) ───────▶ │  VS Code extension (TS)    │
                       │  • webviews, tree views    │
                       │  • LSP client              │
                       └───────────┬───────────────┘
            in-process (latency)   │   subprocess (actions)
        ┌──────────────────────────┤
        ▼                          ▼
  @alp-sdk/core (TS)         alp  (native binary)  ◀── single impl of command behavior
  • LSP analysis             • validate/generate/sdk/…
  • configurator live model  • bootstrap, build (terminal)
  • board summary/status     → JSON envelope or live terminal
```

- **`alp` binary = the one implementation** of the 14 commands. The extension
  invokes it instead of re-deriving the same outcomes in TS.
- **`@alp-sdk/core` (TS) shrinks to the latency-sensitive, in-process subset**
  (see §4). It does not disappear — the LSP and the live configurator need
  synchronous, per-keystroke calls that cannot afford a subprocess.
- **`packages/alp-cli` (TS CLI) is retired** at the Rust cutover (Phase 7).

## 3. Two invocation modes

| Mode | When | Mechanism |
|------|------|-----------|
| **Envelope** | one-shot, data-producing commands | spawn `alp <cmd> --format json`, parse the envelope, map `exitCode`/`issues` to UX |
| **Terminal** | long-running / interactive / live-output | open a VS Code integrated terminal and run `alp <cmd>` (or the underlying tool) so the user sees progress and can answer prompts (sudo, pip, `west update`) |

Envelope commands: `validate`, `generate`, `inspect`, `presets`, `explain`,
`diff`, `trace`, `debug-config --preview`, `support-bundle`, `doctor`,
`sdk list/current`.

Terminal commands: `bootstrap`, `sdk install` (git clone), and the build/flash
workflow. The extension **already** runs west builds in a terminal
(`src/west/vscodeAdapter.ts` → `createTerminal` + `sendText`), so this mode is
established; the CLI just becomes what the terminal runs.

## 4. In-process vs delegated (the split)

Keep **in-process** (`@alp-sdk/core`, TS) — must be synchronous / per-edit:

- LSP analysis: diagnostics, completion, hover, symbols, quick-fixes on
  `board.yaml` (`src/lsp/*`, per keystroke — never spawn).
- Configurator webview live model: parse/normalize/serialize on every edit.
- Board summary / status-bar reads (cheap, frequent).

Delegate to the **`alp` binary** — user-triggered "actions":

- `validate` (full, Python spawn), `generate`, `init`, `scaffold`, `diff`,
  `presets`, `explain`, `inspect`, `trace`, `debug-config`, `support-bundle`,
  `sdk *`, `bootstrap`, and (future) `build`.

Rule of thumb: **per-keystroke → in-process TS; per-click → CLI binary.**

## 5. Binary resolution (open decision)

The extension needs to locate `alp`. Options, cheapest-first:

- **(C) PATH + `alpSdk.cliPath` setting** — find `alp` on PATH or an explicit
  setting; otherwise prompt to `npm i -g alp-sdk`. Universal VSIX, zero bundling.
  *(Pre-noted direction in the migration memory.)* **Recommended first step.**
- **(B) Download-on-demand** — fetch the matching release archive into
  `globalStorage` on first use (same logic as `cli-rs/npm-shim/postinstall.js`).
  Universal VSIX, works without a separate install; needs network once.
- **(A) Bundle per-platform** — ship platform-specific VSIXes (`vsce --target`)
  each carrying the right `alp`. Fully offline; 4 VSIXes + binary size.

Add an `alpSdk.cliPath` configuration property regardless (it makes A/B/C
interchangeable and supports dev builds: `cli-rs/target/release/alp`).

## 6. Incremental rollout

- **Slice 1 — bootstrap (first, low-risk).** Add `alp bootstrap` to the CLI
  (orchestrate the SDK's `scripts/bootstrap.sh`; POSIX now, Windows → pointer).
  Rewire `alp.installDependencies` to run `alp bootstrap` in a terminal and
  delete `src/bootstrap.ts`'s private plan. **3 bootstraps → 1.**
- **Slice 2 — binary resolution.** Add `alpSdk.cliPath`, a `resolveAlpBinary()`
  helper (PATH → setting → download/prompt), and a `runAlp(cmd, args): Envelope`
  wrapper with exit-code → UX mapping.
- **Slice 3 — migrate envelope commands.** Move the action commands from
  in-process `alp-core` calls to `runAlp(...)` one at a time
  (validate → generate → sdk → debug-config → support-bundle → inspect/trace/…),
  each diffed against current behavior.
- **Slice 4 — build through the CLI (`alp build` + siblings).** See §6a — this
  is the one place where the flow genuinely varies by platform, so it gets its
  own design.
- **Slice 5 — shrink + retire.** Trim `@alp-sdk/core` to the LSP/configurator
  subset; retire `packages/alp-cli`.

## 6a. `alp build` — the build flow varies by platform (and by core)

Build is **not** "run `west build`". A single `board.yaml` declares multiple
cores, and each core's runtime decides its toolchain. The SDK already owns this
dispatch in **`west alp-build`** (a Python west extension in
`scripts/west_commands/`), which:

- reads + validates `board.yaml`, then **fans out one build slice per non-`off`
  core** into `<app>/build/<core>-<os>/…`,
- routes each slice to the right backend and runs them in parallel
  (`--sequential` on Windows), figuring the cross-compile target out of
  `board.yaml`:

  | Core runtime | Backend it dispatches to | Toolchain prerequisite |
  |---|---|---|
  | Zephyr (Cortex-M) | `west build` | Zephyr SDK compiler + bootstrapped west workspace |
  | Yocto (Cortex-A) | bitbake / `meta-alp-sdk` layer | Yocto host packages (Linux-only; can be hour-long) |
  | baremetal | CMake + vendor toolchain | Alif Ensemble / Renesas FSP / NXP MCUXpresso, per SoC family |

**Design: `alp build` is a thin orchestrator over `west alp-build`** — exactly
like `alp bootstrap` wraps `bootstrap.sh` and `generate` spawns `alp_project.py`.
The CLI does **not** reimplement per-platform/per-core build logic; the SDK's
driver stays the single source of that truth. The CLI surface:

- `alp build [app] [--core <id>] [--board <b>] [--sequential]` → runs
  `west alp-build …` in a **terminal** (live, long-running). Mirror the SDK's
  sibling commands too: `alp image` / `alp flash` / `alp clean` / `alp renode`
  (→ `west alp-image|alp-flash|alp-clean|alp-renode`). These already exist as
  extension commands (`alp.westAlp*`); the extension flips to invoking the CLI.
- Mode is **terminal**, not envelope (Yocto rebuilds + flashing want live output
  and device interaction). A short final envelope summary is optional.
- **Prerequisites are platform-specific and beyond `bootstrap`.** `bootstrap`
  gets west + the Zephyr workspace + Zephyr Python reqs, but **not** the
  compiler toolchains above. So `alp build` needs a build-preflight (extend
  `doctor`, or an `alp build --check`) that verifies the toolchains required by
  *the cores this board.yaml actually uses* and points to installers when
  missing — Zephyr SDK for M-cores, Yocto host packages for A-cores, vendor
  toolchains for baremetal.

This keeps the heterogeneity where it belongs (the SDK), while still giving the
extension and terminal a single `alp build` entry point.

## 7. Constraints & non-goals

- **LSP stays in-process TS** — no per-keystroke subprocess. `@alp-sdk/core`
  survives for it (and the live configurator).
- **The envelope contract is the seam** — the extension depends only on the
  documented envelope (`CLI.md`); the contract harness remains the parity gate.
- **Build heterogeneity lives in the SDK, not the CLI** (§6a) — `alp build`
  orchestrates `west alp-build`, which owns the per-core Zephyr/Yocto/baremetal
  dispatch and cross-compile-target resolution. The CLI is a thin wrapper.
- Sequencing follows the Rust cutover: don't point the extension at a binary
  that isn't resolvable yet (ties into §5 and Phase 7).

## 8. Open decisions to confirm

1. Binary distribution: (C) PATH/setting first, (B) download later, or (A) bundle?
2. `alp build` scope: just `build`, or the full set (`build`/`image`/`flash`/
   `clean`/`renode`) mirroring the SDK's `west alp-*` commands at once?
3. Build preflight: extend `doctor` to verify per-platform toolchains (Zephyr SDK
   / Yocto host packages / vendor toolchains) keyed off the board.yaml's cores,
   or a separate `alp build --check`?
4. Should `bootstrap` grow beyond `bootstrap.sh`'s scope to also fetch the Zephyr
   SDK compiler toolchain (and, on Linux, the Yocto host packages), or stay a
   pointer for those?
5. Do slices 2–5 before or after the first `cli-rs-v*` release?
