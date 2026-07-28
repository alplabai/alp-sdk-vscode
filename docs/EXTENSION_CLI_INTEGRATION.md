# Extension ↔ CLI Integration Plan

Last revised: 2026-07-20. Status: **decisions locked (§8) except binary
resolution (§5, revised — hybrid bundled + universal VSIX); not yet fully
implemented.**

How the VS Code extension should consume the native `tan` CLI so that command
behavior has a single source of truth — instead of being reimplemented per
surface. The CLI itself is the standalone `tan` binary, developed and released
from [`alplabai/tan-cli`](https://github.com/alplabai/tan-cli); this is a
companion to `ARCHITECTURE_RULES.md` (the layer contract).

## 1. Why

Today every "surface" reaches the shared TypeScript core (`@alp-sdk/core`)
in-process: the extension imports it across ~26 files, the TS CLI wraps it, and
the LSP server links it. That keeps most *domain logic* shared. But two cracks
have appeared:

- **The Rust migration created a second core.** `tan-cli`'s `tan-core` crate
  mirrors `@alp-sdk/core`; they are kept in lockstep only by the contract harness. After
  cutover the Rust binary *is* the CLI, yet the extension still runs the TS core.
- **Bootstrap was genuinely triplicated.** `src/bootstrap.ts` (venv + west, no
  `west init/update`), `alp-core/toolchain/bootstrapPlan.ts` (`pip --user`), and
  the SDK's own `scripts/bootstrap.sh` (the real, complete flow) all disagreed.
  *(Resolved: `tan bootstrap` is now the single implementation — a native Rust
  port of `bootstrap.sh` + `bootstrap.ps1` rather than a shell-out to either,
  tan-cli#49 — and `src/bootstrap.ts:146` shells it unconditionally on every
  host. `bootstrapPlan.ts` survives only as the per-tool install-hint table,
  which alp-sdk ADR 0021 Lane 1 moves upstream too; see #348.)*

The envelope contract (`{command, ok, exitCode, project, data, issues}`, stable
exit codes) was designed for machine consumption. So the extension *can* treat
the `tan` binary as the single implementation and render its output — collapsing
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
  @alp-sdk/core (TS)         tan  (native binary)  ◀── single impl of command behavior
  • LSP analysis             • validate/generate/sdk/…
  • configurator live model  • bootstrap, build (terminal)
  • board summary/status     → JSON envelope or live terminal
```

- **`tan` binary = the one implementation** of the 14 commands. The extension
  invokes it instead of re-deriving the same outcomes in TS.
- **`@alp-sdk/core` (TS) shrinks to the latency-sensitive, in-process subset**
  (see §4). It does not disappear — the LSP and the live configurator need
  synchronous, per-keystroke calls that cannot afford a subprocess.
- **`packages/alp-cli` (TS CLI) is retired** at the Rust cutover (Phase 7).

## 3. Two invocation modes

| Mode | When | Mechanism |
|------|------|-----------|
| **Envelope** | one-shot, data-producing commands | spawn `tan <cmd> --format json`, parse the envelope, map `exitCode`/`issues` to UX |
| **Terminal** | long-running / interactive / live-output | open a VS Code integrated terminal and run `tan <cmd>` (or the underlying tool) so the user sees progress and can answer prompts (sudo, pip, `west update`) |

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

Delegate to the **`tan` binary** — user-triggered "actions":

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
separate `tan` process cannot see the host's installed extensions, so the Rust
`tan doctor` deliberately *assumes* the marquee extensions are present
(`resolveCliDebugContext` sets them all to `true`). That assumption is fine for a
terminal/CI doctor, but in the extension it would turn a real "CodeLLDB is not
installed" finding into a false "installed" — a correctness regression.

**Decision:** the debug doctor/preflight readiness checks **stay in-process**
(`@alp-sdk/core/debug` via `src/debug.ts` + `collectRuntimeCapabilities`), even
though a same-named `tan doctor` envelope exists. They are part of the live/LSP
side of this split, not delegated. The CLI `tan doctor` remains the surface for
terminals and CI (where extension state is irrelevant). Only commands whose full
result is reproducible from `board.yaml` + the SDK + PATH (validate, generate,
sdk, …) are delegated. If a future need arises, the extension could pass its
observed extension state to the CLI via flags — out of scope for now.

## 5. Binary resolution (hybrid: bundled + universal)

**Decision: `alpSdk.cliPath` setting → bundled `bin/tan[.exe]` → local build →
cached download → a verified-native `tan` on PATH (last resort BY DEFAULT) →
download-on-demand.** `resolveAlpBinary()` resolves in that order: an explicit
`alpSdk.cliPath` (also serves dev builds: `tan-cli/target/release/tan`); then a
binary staged at `<extensionPath>/bin/tan[.exe]` — present only in a
platform-specific VSIX built with `vsce package --target <triple>`; then a
locally-built sibling `tan-cli/target/{release,debug}/tan[.exe]` (source checkout);
then a previously downloaded binary cached in `globalStorage`; then `tan` on
PATH, but only once verified to be the native (clap) CLI — `commandOnPath`
accepts a PATH `tan` only when `tan --version` prints the native version line
(`tan X.Y.Z`), so a stale or non-native `tan` that could otherwise shadow the
version the extension targets falls straight through; then a fresh download of
the raw `tan-<triple>[.exe]` release asset from `alplabai/tan-cli` for the host
target. If all of those fail, surface a one-click "install the tan CLI" action.

**Opt-in: `alpSdk.preferGlobalCli` (default off).** When set, `decideBinarySource`
promotes a verified-native `tan` on PATH to outrank the extension's own managed
copies (bundled / local build / cached) — it is checked directly after
`alpSdk.cliPath`, still below it. This closes the split-brain where the
extension quietly runs its own private, version-pinned managed `tan` (e.g.
`0.1.0`) while the user's terminal runs a different globally-installed `tan`
(e.g. one installed via **Install tan CLI (global)**, at `0.1.1`) — with the
flag on, both resolve to the same binary. The default order above is
unchanged when the flag is off. `ensureTanCliProvisioned` and `checkCliVersion`
both honor the same flag (via the shared `resolutionInputFromDeps` seam), so
activation does not fetch a shadow managed copy when a PATH `tan` already
resolves under the flag, and a `path`-source binary that's *ahead* of
`SUPPORTED_CLI_VERSION` is warned about once (in addition to the existing
*behind* warning), since behavior/flags may differ from what this extension
was built against. If the flag is on but no `tan` resolves on the extension
host's PATH (a known macOS class where a shell-managed PATH entry like
`~/.local/bin` isn't visible to the extension host), the extension logs and
warns once, then falls back to provisioning the managed copy as normal — the
flag never blocks and never suppresses that fallback.

The managed `tan` is also **provisioned up front on activation**
(`ensureTanCliProvisioned`): a fresh install fetches the binary once behind a
progress notification instead of stalling on the first build/validate command
(a no-op when a binary already resolves), and a version check then warns if the
resolved `tan` is older than the version this build targets.

**Every managed download is checked against the release's `checksums.txt`.**
The extension does not merely store this binary, it executes it, so a completed
transfer is not sufficient — `releaseAssetForTarget` resolves `checksumsUrl`
from the same release tag as the asset, `downloadFile` fetches it through the
same proxy settings as the binary, and the transferred bytes' sha256 must equal
the digest published for that exact asset name before anything is renamed into
the cache. Verification happens while the download is still a temp file, so a
rejected binary never appears at `cachedBinaryPath` (where the `cached`
resolution source would spawn it unasked) and an already-installed good binary
is left in place.

Three outcomes all REFUSE, with three distinct messages: a digest **mismatch**,
a `checksums.txt` that **could not be fetched**, and a `checksums.txt` with **no
line for this asset**. The last two are refusals rather than warnings on
purpose — every tagged tan release publishes the file, and the binary itself
just arrived over the same connection, so failing to obtain the digest means the
release is malformed or something is intercepting; neither justifies executing
an unverified binary. See `ChecksumError` in `src/alpCli/download.ts`.

**Out of scope: GitHub build-provenance attestation.**
`gh attestation verify <file> --repo alplabai/tan-cli` does work, and does fail
on a tampered copy, but it needs the `gh` CLI installed and authenticated —
which a customer machine cannot be assumed to have. It stays a maintainer/CI
check; the extension never shells out to `gh`. (When running it by hand: in gh
2.89.0 a successful verify prints nothing, so exit 0 is the only signal and
empty output is not a failure.) Note also what the checksum does and does not
buy: `checksums.txt` travels over the same TLS connection as the binary, so it
catches a corrupted or substituted asset, while TLS remains what authenticates
the channel. Only signature verification against a producer key held by the
extension would make the transport itself untrusted.

**Compat note (PATH order reorder, 2026-07):** before this reorder, `tan` on
PATH was tried right after `alpSdk.cliPath` — ahead of anything the extension
itself manages. Now PATH is a last resort, tried only once nothing
already-managed (bundled / local build / cached) is available. One practical
consequence: a **newer** native `tan` a user installed manually on PATH (e.g.
via Homebrew or a manual download) now *loses* to whatever the extension
already has cached or bundled, even if that managed copy is older — PATH used
to win that race, it no longer does. The escape hatch is `alpSdk.cliPath`:
point it explicitly at the PATH binary (or any other build) to force the
extension to use it regardless of what's cached/bundled.

Two VSIX shapes ship side by side:

- **Platform-specific VSIXes** (`--target darwin-arm64`, and eventually the
  other five `TARGETS` entries this extension resolves) embed `bin/tan[.exe]`
  for that host. Note the two counts that are easy to conflate: `tan-cli`
  publishes **eight** raw target assets, and this extension's `TARGETS` map
  consumes **six** of them — a deliberate musl-over-gnu choice on Linux, not an
  omission. The VSIX targets track the six we resolve, not the eight tan ships.
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
binary for platforms `tan-cli` publishes prebuilt removes that
first-run dependency for the common case, while the universal VSIX remains for
sideload and air-gapped environments where a smaller download matters more
than a zero-network first run.

## 6. Incremental rollout

Two waves. **Wave A is pure CLI work** — new commands, contract-harness-testable,
no extension change and no release dependency, so it can land now. **Wave B is
the extension consuming the binary** — every step needs a resolvable `tan`, so it
follows the first `tan-cli` `v<version>` release (§5 + Phase 7).

**Wave A — CLI gains the missing commands (now):**

- **A1 — `tan bootstrap`. ✅ done.** Performs the bootstrap natively — venv,
  west into it, `west init -l <alp-sdk>` / `west update` / `west zephyr-export`,
  Python deps — with `--no-pip`/`--no-west`/`--print-env` preserved. Text mode
  inherits stdio (live install in the caller's terminal); JSON mode captures
  + emits one envelope. sdk-unresolved → exit 2. Golden fixtures + verified
  against the real SDK's `bootstrap.sh --print-env`.
  *(Superseded 2026-07 — tan-cli#49: A1 originally shelled the SDK's
  `scripts/bootstrap.sh`, with Windows getting a pointer instead. It is now a
  Rust port of `bootstrap.sh` + `bootstrap.ps1`, which are the parity oracle for
  control flow and message strings rather than a runtime dependency, and the
  facts come from `<sdkRoot>/metadata/bootstrap.json`. Native Windows is
  first-class: no `bash`, no pointer, no WSL. This is what closed #316.)*
- **A2 — `tan build` + `image`/`flash`/`clean`/`renode`. ✅ done.** Five
  terminal-mode commands that drive the build/image/flash/clean/renode
  dispatch themselves (§6a — no `west alp-*` driver involved), run in the west
  cwd, and hide `west`. west-not-found → `tan
  bootstrap` hint. Arg-forwarding unit-tested + stub-west smoke; no golden
  fixtures (real builds need west + a workspace).
- **A3 — build preflight in `doctor`. ✅ done.** `tan doctor --build` resolves the
  OS set from the active `board.yaml` (explicit core `os:` fields; falls back to all
  three backends when none are declared — board.yaml alone doesn't carry per-core
  type, that's derived by the SDK's `alp_orchestrate.py` planner and consumed via
  the `--emit build-plan` contract, §9), probes the host build tools each
  needs (west/cmake/ninja/zephyrSdk for Zephyr, bitbake for Yocto / Linux-only
  warning otherwise, cmake+vendorToolchain for baremetal), and emits a doctor
  envelope with per-OS checks + installer next-steps. Vendor compilers/Yocto host
  pkgs stay pointer-only (decision 4). Advisory only. `tan-core/build_readiness.rs`
  (6 unit tests); the default `tan doctor` (no `--build`) is unchanged. No golden
  fixtures — output is machine-dependent like the debug doctor.

**Wave B — extension consumes the CLI (after the first `tan-cli` `v<version>` release):**

- **B1 — binary resolution. ✅ done.** New `src/alpCli/` slice + `alpSdk.cliPath`
  setting. `service.ts` (pure): `decideBinarySource` (cliPath→bundled→localBuild→
  cached→PATH(verified-native, last resort BY DEFAULT; promoted directly after
  cliPath when the opt-in `alpSdk.preferGlobalCli` is on)→download, §5), `parseEnvelope`,
  `classifyExitCode`/`classifyOutcome` (exit 0/1/2/3/4/5 →
  UX severity), `releaseAssetForTarget` (the 6 published targets — Windows,
  Linux, and macOS in x64 + arm64; Intel-mac now has a prebuilt binary).
  `adapterCore.ts` (injected fs/net/process seams): `resolveAlpBinary` (downloads
  into globalStorage on demand) + `runAlp` (spawns `tan … --format json`, parses,
  classifies; spawn-ENOENT → graceful error outcome). `vscodeAdapter.ts`: real
  https-redirect download of the raw binary + `chmod +x` (Unix) + `spawnSync`,
  session-memoized (tan-cli ships a raw per-target binary, so there is no archive
  to unpack).
  17 unit tests (service + adapterCore). Not yet wired into commands (that's B2/B3).
- **B2 — rewire the terminal actions first. ✅ done.** New `runAlpInTerminal()`
  (resolves the binary, opens a terminal, runs `tan …`; surfaces a one-click
  "Open Settings" if the binary can't be resolved). `alp.installDependencies` →
  `tan bootstrap` (the whole `src/bootstrap.ts` venv/pip/OS-picker plan deleted —
  **3 bootstraps → 1**). The orchestrator-backed commands flip to the CLI:
  `alp.westBuild` → `tan build`, and `westAlp{Image,Flash,Clean,Renode}` →
  `tan {image,flash,clean,renode}` — dropping the extension's in-process
  validate+generate (the SDK orchestrator owns it; board.yaml diagnostics still
  come live from the LSP). Command titles de-`west`-ed (hide west). The plain
  `west flash/update/run` commands have no CLI equivalent and stay as direct west
  invocations (revisited in B4). No new unit tests (terminal-mode UX); the
  testable runAlp/resolve logic was covered in B1.
- **B3 — migrate envelope commands (in progress).** Move action commands from
  in-process `alp-core` calls to `runAlp(...)` one at a time, each diffed against
  current behavior. `runAlpCommand` hardened to never throw (a resolution failure
  becomes an error outcome). **validate ✅** — `alp.validateBoardYaml` now spawns
  `tan validate --format json`; the envelope's `data.outcome`
  (clean/missing-preset/hardware-revision/schema-violation/failed) maps to the
  same toasts, and `issues` are logged to the output channel. The in-process
  board.yaml-exists pre-check stays (cheap; nicer "not found" message); the
  per-edit diagnostics path (`src/diagnostics.ts` → `executeValidatorPlan`) is
  untouched (LSP domain, §4). **generate ✅** — the four `alp.generate*` +
  `alp.generateAll` now spawn `tan generate --target <emit>` / `--all`; the
  envelope's `{targets,written,failed}` drives the same preview + status-bar /
  warning UX (the in-process loop, trace, and plan/exec machinery are gone from
  `loader.ts`). **Scope finding:** the debug-domain commands (`debugDoctor`,
  `debugPreflight`, …) probe **VS Code-host-only state** —
  `vscode.extensions.getExtension(...)` for installed debuggers — which the CLI
  can't see (it assumes the marquee extensions present). Migrating them would
  regress accuracy, so they **stay in-process** (they belong to the live/LSP
  side of §4, see §4a). **sdk list ✅** — both release-fetchers (the SDK Manager
  panel and the IDE Hub sidebar provider) now call `tan sdk list --format json`
  and post `data.releases` to the webview, replacing two copies of an in-process
  `listRemoteSdkReleases` + hand-rolled `https.get`. **B3 effectively complete:**
  the cleanly-delegable envelope commands (validate, generate, sdk list) are
  migrated; the rest are either host-coupled (the whole debug domain — doctor,
  preflight, inspect, support-bundle, debug-config — §4a) or not worth a spawn
  (sdk install is a bespoke webview/terminal git-clone flow; sdk switch is a
  cheap local fs pointer write). `previewEffectiveConfig` stays in-process (live
  configurator, §4).
  **Correction (#349): "sdk switch is a cheap local fs pointer write" is false.**
  The active-SDK pointer is not the only pointer a switch invalidates — `west`
  reads `<topdir>/.west/config`'s own `[manifest] path` directly and
  independently, so an in-process switch leaves it naming the previous SDK.
  When that directory is later removed the workspace is silently broken (west
  falls back to whatever `$ZEPHYR_BASE` names; the report saw `west flash` fail
  with `unknown runner "alif_flash"`). `tan` owns the repair — `tan bootstrap`
  has reconciled the pointer since tan-cli #31, `tan sdk switch` since tan-cli
  #74 — and the extension deliberately does **not** mirror that write: a second
  writer with an independently-evolving guard is how the two diverge on a file
  `west` depends on. The extension only **detects** it (`inspectWestManifest`,
  read-only, `packages/alp-core/src/sdk/service.ts`) and points at Bootstrap.
  Delegating the switch itself is queued behind a `SUPPORTED_CLI_VERSION` bump
  to the first tan-cli release carrying #74 — the pin bump and the
  `tan sdk switch` call must land in the **same** PR, using the **absolute**
  SDK path (a bare version resolves against `~/.alp/sdk-cache`, not the
  extension's `~/.alp/sdk`) and an explicit `cwd` of the workspace root.
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
  Safe because `alp-sdk` was never published to npm. The Rust `tan` is now the sole
  CLI.

## 6a. `tan build` — the build flow varies by platform (and by core)

Build is **not** "run `west build`". A single `board.yaml` declares multiple
cores, and each core's runtime decides its backend. **`tan build` drives that
per-core dispatch itself** (`crates/tan-cli/src/commands/build/mod.rs`) — no
`west alp-build` extension command is involved. The target design:

- fan out one build slice per non-`off` core into `<app>/build/<core>-<os>/…`,
  using the plan produced by the SDK's `alp_orchestrate.py --emit build-plan`
  (the consumed contract; see [`BUILD_ORCHESTRATION.md`](BUILD_ORCHESTRATION.md)),
- route each slice to the backend it targets:

  | Core runtime | Backend it targets | Toolchain prerequisite |
  |---|---|---|
  | Zephyr (Cortex-M) | `west build` | Zephyr SDK compiler + bootstrapped west workspace |
  | Yocto (Cortex-A) | **bitbake** (`meta-alp-sdk` layer) | Yocto host packages (Linux-only; can be hour-long) |
  | baremetal | **CMake + vendor toolchain** | Alif Ensemble / Renesas FSP / NXP MCUXpresso, per SoC family |

**What actually executes today:** only the single-core Zephyr path is landed
end to end (`tan build --native`, sequential; see
[`BUILD_ORCHESTRATION.md`](BUILD_ORCHESTRATION.md) C1). The Yocto/`bitbake`
and baremetal/`CMake` rows, plus multi-core parallel fan-out, are C2 —
not yet implemented.

**Design: `tan build` is the single user-facing entry that hides `west`.** The
user types `tan build` (never `west alp-build`); `tan` targets each core at
the backend in the table above itself, rather than shelling out to `west
alp-build`. Where it executes today (the Zephyr path), it still shells to
plain `west build` — never through the SDK's `west alp-build` extension
command. CLI surface:

- `tan build [app] [--core <id>] [--board <b>] [--sequential]` → drives the
  per-core build in a **terminal** (live, long-running). Sibling commands
  `tan image` / `tan flash` / `tan clean` / `tan renode` follow the same
  natively-driven pattern. These already exist as extension commands
  (`alp.westAlp*`); the extension invokes the CLI for all five.
- Mode is **terminal**, not envelope (Yocto rebuilds + flashing want live output
  and device interaction). A short final envelope summary is optional.
- **Prerequisites are platform-specific and beyond `bootstrap`.** `bootstrap`
  gets west + the Zephyr workspace + Zephyr Python reqs, but **not** the
  compiler toolchains above. So `tan build` runs a build-preflight (in `doctor`,
  per A3) that verifies the toolchains required by
  *the cores this board.yaml actually uses* and points to installers when
  missing — Zephyr SDK for M-cores, Yocto host packages for A-cores, vendor
  toolchains for baremetal.

**What still goes through `west alp-*`.** The west-delegating entry point
survives only for `west alp-migrate`, `west alp-lock`, and `west alp-quality`
— verbs `tan` has no native command for. `tan
build`/`image`/`flash`/`clean`/`renode` are not on that list; `tan` is the sole
executor for those five. (The ADR recording this isn't merged yet, so it isn't
cited or linked here.)

This keeps a single, natively-driven `tan build` entry point for the extension
and terminal alike, while the SDK's `alp_orchestrate.py` stays the single
source of truth for per-core planning.

## 7. Constraints & non-goals

- **LSP stays in-process TS** — no per-keystroke subprocess. `@alp-sdk/core`
  survives for it (and the live configurator).
- **The envelope contract is the seam** — the extension depends only on the
  documented envelope (`CLI.md`); the contract harness remains the parity gate.
- **Build heterogeneity lives in the SDK's planner, not the CLI** (§6a) —
  `tan build` consumes the SDK's `alp_orchestrate.py --emit build-plan`, which
  owns the per-core Zephyr/Yocto/baremetal dispatch and cross-compile-target
  resolution; `tan` executes the resulting plan itself rather than shelling to
  `west alp-build`.
- Sequencing follows the Rust cutover: don't point the extension at a binary
  that isn't resolvable yet (ties into §5 and Phase 7).

## 8. Decisions (locked)

No open items — this plan is frozen; revisit only if an assumption breaks.

1. **Binary distribution** → `alpSdk.cliPath` → bundled `bin/tan[.exe]` →
   local build → cached → a verified-native PATH `tan` (last resort) →
   download-on-demand into `globalStorage` (§5; superseded 2026-07 —
   platform-specific VSIXes now bundle the CLI; the universal VSIX stays
   binary-less for sideload/air-gapped installs and keeps download-on-demand;
   PATH order superseded again to close the venv-shadowing gap, see B1).
2. **`tan build` scope** → the full set `build`/`image`/`flash`/`clean`/`renode`,
   mirroring the SDK's `west alp-*` commands 1:1 (the extension already exposes
   all five). Done together to avoid a half-migrated extension.
3. **Build preflight** → lives in `doctor` (A3), keyed off the active
   `board.yaml`'s cores. No separate `--check` flag.
4. **`bootstrap` scope** → west + Zephyr workspace + Zephyr Python reqs only
   (§7 A1; the mechanism was "orchestrate `bootstrap.sh`" until tan-cli#49 made
   it a native Rust port of `bootstrap.sh` + `bootstrap.ps1` — the SCOPE below
   is unchanged). The compiler toolchains (Zephyr SDK, vendor SDKs) and Yocto
   host packages stay **pointer-only** — they are large, license-gated, and
   interactive; `doctor` detects + points to them. Matches what the two
   bootstrap scripts themselves deliberately do.
5. **Sequencing** → Wave A (CLI commands) now; Wave B (extension consumption)
   after the first `tan-cli` `v<version>` release. See §6.

## 9. Build orchestration — shipped: the CLI drives, the SDK emits the plan (Wave C)

- **Shipped.** `tan build` no longer delegates to the SDK's `west alp-build`
  (§6a). The CLI drives orchestration itself — it owns materialise / execute /
  schedule / cache / progress UX / envelope and invokes `west` / `bitbake` /
  `cmake` directly.
- The CLI does **not** re-implement the planner. Per the SDK team's counter-offer
  it **consumes `alp_orchestrate.py --emit build-plan`**: the planner (the
  fast-moving, vendor-heavy part — partition allocation, sysbuild, TF-M) stays the
  SDK's single source of truth; the CLI owns the stable mechanism below it.
- The SDK's only scheduled new work is `--emit build-plan` (emitting our spec'd
  `BuildPlan` JSON **with generated-file contents**) plus an answer on the
  conf→build wiring before our C1. `west alp-build` stays native (the shim was
  declined). Full evidence, the consumed `BuildPlan` contract, the parity strategy
  (pinned to release tags), and the phased plan (C0 consume-the-emit → C4 flip the
  front-ends, now landed) are in [`BUILD_ORCHESTRATION.md`](BUILD_ORCHESTRATION.md); the
  team-to-team agreement record is in
  [`PROPOSAL-alp-build-core.md`](PROPOSAL-alp-build-core.md).
