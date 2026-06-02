# Extension ↔ CLI Integration Plan

Last revised: 2026-06-02. Status: **decisions locked (§8); not yet implemented.**

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

## 5. Binary resolution (locked)

**Decision (locked): `alpSdk.cliPath` setting → PATH → download-on-demand.**
`resolveAlpBinary()` resolves in that order: an explicit `alpSdk.cliPath`
(also serves dev builds: `cli-rs/target/release/alp`), then `alp` on PATH, then
a download into `globalStorage` (the `cli-rs/npm-shim/postinstall.js` logic) for
the host target; if all fail, surface a one-click "install the ALP CLI" action.
This keeps a single universal VSIX (no per-platform bundling) and reuses the
shim's download path. Per-platform-bundled VSIXes are explicitly **not** pursued.

## 6. Incremental rollout

Two waves. **Wave A is pure CLI work** — new commands, contract-harness-testable,
no extension change and no release dependency, so it can land now. **Wave B is
the extension consuming the binary** — every step needs a resolvable `alp`, so it
follows the first `cli-rs-v*` release (§5 + Phase 7).

**Wave A — CLI gains the missing commands (now):**

- **A1 — `alp bootstrap`. ✅ done.** Orchestrates the SDK's `scripts/bootstrap.sh`
  (`--no-pip`/`--no-west`/`--print-env` pass-through; Windows → pointer). Text
  mode inherits stdio (live install in the caller's terminal); JSON mode captures
  + emits one envelope. sdk-unresolved → exit 2. Golden fixtures + verified
  against the real SDK's `bootstrap.sh --print-env`.
- **A2 — `alp build` + `image`/`flash`/`clean`/`renode`. ✅ done.** Five thin
  terminal-mode wrappers that forward args verbatim to the SDK's `west alp-*`
  driver (§6a), run in the west cwd, and hide `west`. west-not-found → `alp
  bootstrap` hint. Arg-forwarding unit-tested + stub-west smoke; no golden
  fixtures (real builds need west + a workspace).
- **A3 — build preflight in `doctor`. ✅ done.** `alp doctor --build` resolves the
  OS set from the active `board.yaml` (explicit core `os:` fields; falls back to all
  three backends when none are declared — board.yaml alone doesn't carry per-core
  type, that stays `west alp-build`'s job, §9), probes the host build tools each
  needs (west/cmake/ninja/zephyrSdk for Zephyr, bitbake for Yocto / Linux-only
  warning otherwise, cmake+vendorToolchain for baremetal), and emits a doctor
  envelope with per-OS checks + installer next-steps. Vendor compilers/Yocto host
  pkgs stay pointer-only (decision 4). Advisory only. `alp-core/build_readiness.rs`
  (6 unit tests); the default `alp doctor` (no `--build`) is unchanged. No golden
  fixtures — output is machine-dependent like the debug doctor.

**Wave B — extension consumes the CLI (after first `cli-rs-v*` release):**

- **B1 — binary resolution. ✅ done.** New `src/alpCli/` slice + `alpSdk.cliPath`
  setting. `service.ts` (pure): `decideBinarySource` (cliPath→PATH→cached→download,
  §5), `parseEnvelope`, `classifyExitCode`/`classifyOutcome` (exit 0/1/2/3/4/5 →
  UX severity), `releaseAssetForTarget` (the 3 published targets; Intel-mac → null).
  `adapterCore.ts` (injected fs/net/process seams): `resolveAlpBinary` (downloads
  into globalStorage on demand) + `runAlp` (spawns `alp … --format json`, parses,
  classifies; spawn-ENOENT → graceful error outcome). `vscodeAdapter.ts`: real
  https-redirect download + `tar` extract + `spawnSync`, session-memoized.
  17 unit tests (service + adapterCore). Not yet wired into commands (that's B2/B3).
- **B2 — rewire the terminal actions first. ✅ done.** New `runAlpInTerminal()`
  (resolves the binary, opens a terminal, runs `alp …`; surfaces a one-click
  "Open Settings" if the binary can't be resolved). `alp.installDependencies` →
  `alp bootstrap` (the whole `src/bootstrap.ts` venv/pip/OS-picker plan deleted —
  **3 bootstraps → 1**). The orchestrator-backed commands flip to the CLI:
  `alp.westBuild` → `alp build`, and `westAlp{Image,Flash,Clean,Renode}` →
  `alp {image,flash,clean,renode}` — dropping the extension's in-process
  validate+generate (the SDK orchestrator owns it; board.yaml diagnostics still
  come live from the LSP). Command titles de-`west`-ed (hide west). The plain
  `west flash/update/run` commands have no CLI equivalent and stay as direct west
  invocations (revisited in B4). No new unit tests (terminal-mode UX); the
  testable runAlp/resolve logic was covered in B1.
- **B3 — migrate envelope commands (in progress).** Move action commands from
  in-process `alp-core` calls to `runAlp(...)` one at a time, each diffed against
  current behavior. `runAlpCommand` hardened to never throw (a resolution failure
  becomes an error outcome). **validate ✅** — `alp.validateBoardYaml` now spawns
  `alp validate --format json`; the envelope's `data.outcome`
  (clean/missing-preset/hardware-revision/schema-violation/failed) maps to the
  same toasts, and `issues` are logged to the output channel. The in-process
  board.yaml-exists pre-check stays (cheap; nicer "not found" message); the
  per-edit diagnostics path (`src/diagnostics.ts` → `executeValidatorPlan`) is
  untouched (LSP domain, §4). Remaining: generate → sdk → debug-config →
  support-bundle → inspect/trace/presets/explain/diff.
- **B4 — shrink + retire.** Trim `@alp-sdk/core` to the LSP + live-configurator
  subset; retire `packages/alp-cli`.

## 6a. `alp build` — the build flow varies by platform (and by core)

Build is **not** "run `west build`". A single `board.yaml` declares multiple
cores, and each core's runtime decides its backend. The SDK already owns this
dispatch: **`west alp-build`** is a thin Python west extension
(`scripts/west_commands/alp_build.py`) that shells into **`alp_orchestrate.py`**,
the real per-core/per-platform brain. It:

- reads + validates `board.yaml`, then **fans out one build slice per non-`off`
  core** into `<app>/build/<core>-<os>/…`,
- routes each slice to the right backend and runs them in parallel
  (`--sequential` on Windows), deriving the cross-compile target from
  `board.yaml` (`alp_orchestrate.py:_default_os_from_core_type`):

  | Core runtime | Backend it routes to | Toolchain prerequisite |
  |---|---|---|
  | Zephyr (Cortex-M) | `west build` | Zephyr SDK compiler + bootstrapped west workspace |
  | Yocto (Cortex-A) | **bitbake** (`meta-alp-sdk` layer) | Yocto host packages (Linux-only; can be hour-long) |
  | baremetal | **CMake + vendor toolchain** | Alif Ensemble / Renesas FSP / NXP MCUXpresso, per SoC family |

**Design: `alp build` is the single user-facing entry that hides `west`.** The
user types `alp build` (never `west alp-build`); the CLI delegates to
`west alp-build`, and the Zephyr→`west build` / Yocto→`bitbake` /
baremetal→`CMake` routing stays in the SDK's orchestrator. The CLI does **not**
re-decide the backend — same pattern as `alp bootstrap` wrapping `bootstrap.sh`.
CLI surface:

- `alp build [app] [--core <id>] [--board <b>] [--sequential]` → runs
  `west alp-build …` in a **terminal** (live, long-running). Mirror the SDK's
  sibling commands too: `alp image` / `alp flash` / `alp clean` / `alp renode`
  (→ `west alp-image|alp-flash|alp-clean|alp-renode`). These already exist as
  extension commands (`alp.westAlp*`); the extension flips to invoking the CLI.
- Mode is **terminal**, not envelope (Yocto rebuilds + flashing want live output
  and device interaction). A short final envelope summary is optional.
- **Prerequisites are platform-specific and beyond `bootstrap`.** `bootstrap`
  gets west + the Zephyr workspace + Zephyr Python reqs, but **not** the
  compiler toolchains above. So `alp build` runs a build-preflight (in `doctor`,
  per A3) that verifies the toolchains required by
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

## 8. Decisions (locked)

No open items — this plan is frozen; revisit only if an assumption breaks.

1. **Binary distribution** → `alpSdk.cliPath` → PATH → download-on-demand into
   `globalStorage` (§5). Single universal VSIX; no per-platform bundling.
2. **`alp build` scope** → the full set `build`/`image`/`flash`/`clean`/`renode`,
   mirroring the SDK's `west alp-*` commands 1:1 (the extension already exposes
   all five). Done together to avoid a half-migrated extension.
3. **Build preflight** → lives in `doctor` (A3), keyed off the active
   `board.yaml`'s cores. No separate `--check` flag.
4. **`bootstrap` scope** → orchestrate `bootstrap.sh` (west + Zephyr workspace +
   Zephyr Python reqs) only. The compiler toolchains (Zephyr SDK, vendor SDKs)
   and Yocto host packages stay **pointer-only** — they are large, license-gated,
   and interactive; `doctor` detects + points to them. Matches what `bootstrap.sh`
   itself deliberately does.
5. **Sequencing** → Wave A (CLI commands) now; Wave B (extension consumption)
   after the first `cli-rs-v*` release. See §6.

## 9. Deferred / optional (not scheduled)

- **Move the build orchestration into Rust.** Today `alp build` delegates to the
  SDK's `west alp-build` → `alp_orchestrate.py` (≈3370 lines: SoC/board/topology
  resolution, memory maps, secure-boot partitions, `system-manifest.yaml`),
  which is versioned with the SDK and used by west + 2 CI workflows + the docs.
  Reimplementing it in Rust is **deferred and only makes sense as part of the SDK
  team rewriting its own Python tooling (`alp_project.py` + `alp_orchestrate.py`)
  in Rust** — not as CLI/extension work. Doing it sooner would fork the SDK's
  build brain across repos+languages (perpetual version-chase) and still require
  `west build`/`bitbake`/`cmake` (the actual builders) anyway, so it removes no
  dependency. If the SDK adopts a Rust core, the CLI would link it instead of
  shelling to west. Until then: thin wrapper (§6a). The CLI may still *preview*
  the build plan (`trace`, `doctor` A3) without owning dispatch.
