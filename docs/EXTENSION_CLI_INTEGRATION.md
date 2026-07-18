# Extension ↔ CLI Integration Plan

Last revised: 2026-07-17. Status: **decisions locked (§8) except binary
resolution (§5, revised — hybrid bundled + universal VSIX); not yet fully
implemented.**

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

### 4a. Debug doctor / preflight stay in-process (host-state exception)

There is a third class beyond per-keystroke vs per-click: **commands whose
answer depends on VS Code host state the CLI cannot observe.** The debug-domain
commands — `alp.debugDoctor`, `alp.debugPreflight` (and the debug parts of
`inspect` / `support-bundle`) — probe **which debugger extensions are installed**
via `vscode.extensions.getExtension(...)` (Cortex-Debug, CodeLLDB, C/C++). A
separate `alp` process cannot see the host's installed extensions, so the Rust
`alp doctor` deliberately *assumes* the marquee extensions are present
(`resolveCliDebugContext` sets them all to `true`). That assumption is fine for a
terminal/CI doctor, but in the extension it would turn a real "CodeLLDB is not
installed" finding into a false "installed" — a correctness regression.

**Decision:** the debug doctor/preflight readiness checks **stay in-process**
(`@alp-sdk/core/debug` via `src/debug.ts` + `collectRuntimeCapabilities`), even
though a same-named `alp doctor` envelope exists. They are part of the live/LSP
side of this split, not delegated. The CLI `alp doctor` remains the surface for
terminals and CI (where extension state is irrelevant). Only commands whose full
result is reproducible from `board.yaml` + the SDK + PATH (validate, generate,
sdk, …) are delegated. If a future need arises, the extension could pass its
observed extension state to the CLI via flags — out of scope for now.

## 5. Binary resolution (hybrid: bundled + universal)

**Decision: `alpSdk.cliPath` setting → bundled `bin/alp[.exe]` → local build →
cached download → a verified-native `alp` on PATH (last resort) →
download-on-demand.** `resolveAlpBinary()` resolves in that order: an explicit
`alpSdk.cliPath` (also serves dev builds: `cli-rs/target/release/alp`); then a
binary staged at `<extensionPath>/bin/alp[.exe]` — present only in a
platform-specific VSIX built with `vsce package --target <triple>`; then a
locally-built `cli-rs/target/{release,debug}/alp[.exe]` (source checkout);
then a previously downloaded binary cached in `globalStorage`; then `alp` on
PATH, but only once verified to be the native (clap) CLI — the SDK's
`bootstrap.sh` pip-installs a Python `alp` (click) into the workspace venv,
which shadows the native binary on PATH once that venv is active, so PATH is
checked last and a non-native match falls straight through; then a fresh
download (the `cli-rs/npm-shim/postinstall.js` logic) for the host target. If
all of those fail, surface a one-click "install the ALP CLI" action.

**Compat note (PATH order reorder, 2026-07):** before this reorder, `alp` on
PATH was tried right after `alpSdk.cliPath` — ahead of anything the extension
itself manages. Now PATH is a last resort, tried only once nothing
already-managed (bundled / local build / cached) is available. One practical
consequence: a **newer** native `alp` a user installed manually on PATH (e.g.
via Homebrew or a manual download) now *loses* to whatever the extension
already has cached or bundled, even if that managed copy is older — PATH used
to win that race, it no longer does. The escape hatch is `alpSdk.cliPath`:
point it explicitly at the PATH binary (or any other build) to force the
extension to use it regardless of what's cached/bundled.

Two VSIX shapes ship side by side:

- **Platform-specific VSIXes** (`--target darwin-arm64`, and eventually the
  other four `release-cli-rs.yml` targets) embed `bin/alp[.exe]` for that host.
  First run needs no network call, no GitHub reachability, no proxy config —
  the `bundled` resolver source picks the binary up directly.
- **The universal (binary-less) VSIX** keeps download-on-demand as the
  fallback. It is also the sideload / air-gapped artifact: a single package
  that works with any host once `alpSdk.cliPath` is pointed at a local build,
  and the one to hand-install where the managed download can't run anyway.

**Reversal rationale:** the original "single universal VSIX, no per-platform
bundling" call (§8, item 1) assumed a first-run download-on-demand was
acceptable UX. It isn't offline or behind a proxy that blocks GitHub
releases — the extension activates, but every CLI-backed command fails until
a human fixes network access, with no local fallback to point at. Bundling the
binary for platforms already built in CI (`release-cli-rs.yml`) removes that
first-run dependency for the common case, while the universal VSIX remains for
sideload and air-gapped environments where a smaller download matters more
than a zero-network first run.

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
  setting. `service.ts` (pure): `decideBinarySource` (cliPath→bundled→localBuild→
  cached→PATH(verified-native, last resort)→download, §5), `parseEnvelope`,
  `classifyExitCode`/`classifyOutcome` (exit 0/1/2/3/4/5 →
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
  untouched (LSP domain, §4). **generate ✅** — the four `alp.generate*` +
  `alp.generateAll` now spawn `alp generate --target <emit>` / `--all`; the
  envelope's `{targets,written,failed}` drives the same preview + status-bar /
  warning UX (the in-process loop, trace, and plan/exec machinery are gone from
  `loader.ts`). **Scope finding:** the debug-domain commands (`debugDoctor`,
  `debugPreflight`, …) probe **VS Code-host-only state** —
  `vscode.extensions.getExtension(...)` for installed debuggers — which the CLI
  can't see (it assumes the marquee extensions present). Migrating them would
  regress accuracy, so they **stay in-process** (they belong to the live/LSP
  side of §4, see §4a). **sdk list ✅** — both release-fetchers (the SDK Manager
  panel and the IDE Hub sidebar provider) now call `alp sdk list --format json`
  and post `data.releases` to the webview, replacing two copies of an in-process
  `listRemoteSdkReleases` + hand-rolled `https.get`. **B3 effectively complete:**
  the cleanly-delegable envelope commands (validate, generate, sdk list) are
  migrated; the rest are either host-coupled (the whole debug domain — doctor,
  preflight, inspect, support-bundle, debug-config — §4a) or not worth a spawn
  (sdk install is a bespoke webview/terminal git-clone flow; sdk switch is a
  cheap local fs pointer write). `previewEffectiveConfig` stays in-process (live
  configurator, §4).
- **B4 — retire the TS CLI. ✅ done (retire); core shrink = n/a.** Inventory found
  the extension (`src/`) imports **nearly all** of `@alp-sdk/core` (board,
  boardSummary, configurator, the whole debug domain [in-process per §4a], loader,
  project, sdk, sdkCatalogue, toolchain, validation, west, wizard), and every core
  module `packages/alp-cli` used is also used by `src/` — so retiring the TS CLI
  frees **zero** core modules. Core stays as-is; "shrink to LSP + configurator"
  isn't achievable (the extension legitimately needs the rest). **Deleted
  `packages/alp-cli`** (+ its `test/cli.*.test.js`, the `cli:pack`/`cli:smoke`
  scripts + `scripts/ci/smoke-cli.sh`, and the build-script filters). The contract
  harness is unaffected — it compares the Rust binary against committed goldens
  (the only TS bit, `offline-validate-ts.mjs`, reads `@alp-sdk/core`, not alp-cli).
  Safe because `alp-sdk` was never published to npm. The Rust `alp` is now the sole
  CLI.

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

1. **Binary distribution** → `alpSdk.cliPath` → bundled `bin/alp[.exe]` →
   local build → cached → a verified-native PATH `alp` (last resort) →
   download-on-demand into `globalStorage` (§5; superseded 2026-07 —
   platform-specific VSIXes now bundle the CLI; the universal VSIX stays
   binary-less for sideload/air-gapped installs and keeps download-on-demand;
   PATH order superseded again to close the venv-shadowing gap, see B1).
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

## 9. Build orchestration — agreed: the CLI drives, the SDK emits the plan (Wave C)

- Today `alp build` delegates to the SDK's `west alp-build` →
  `alp_orchestrate.py` (a thin terminal wrapper, §6a). **Agreed direction (after
  SDK review):** the CLI takes orchestration to the top — it owns materialise /
  execute / schedule / cache / progress UX / envelope and invokes `west` /
  `bitbake` / `cmake` directly.
- The CLI does **not** re-implement the planner. Per the SDK team's counter-offer
  it **consumes `alp_orchestrate.py --emit build-plan`**: the planner (the
  fast-moving, vendor-heavy part — partition allocation, sysbuild, TF-M) stays the
  SDK's single source of truth; the CLI owns the stable mechanism below it.
- The SDK's only scheduled new work is `--emit build-plan` (emitting our spec'd
  `BuildPlan` JSON **with generated-file contents**) plus an answer on the
  conf→build wiring before our C1. `west alp-build` stays native (the shim was
  declined). Full evidence, the consumed `BuildPlan` contract, the parity strategy
  (pinned to release tags), and the phased plan (C0 consume-the-emit → C4 flip the
  front-ends) are in [`BUILD_ORCHESTRATION.md`](BUILD_ORCHESTRATION.md); the
  team-to-team agreement record is in
  [`PROPOSAL-alp-build-core.md`](PROPOSAL-alp-build-core.md).
