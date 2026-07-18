# ADR: The native `alp`/`tan` CLI is the single tool for SDK management

- **Status:** Proposed
- **Date:** 2026-07-18
- **Deciders:** Alp Lab
- **Related:** `alplabai/alp-sdk#843` (one-planner RFC), `alplabai/alp-sdk#837` (`alp`→`tan` rename RFC), `alp-sdk-vscode#237` (native-path hardening), `alp-sdk-vscode#234` (SDK-sourced Kconfig)
- **Supersedes / extends:** `docs/ADR-native-shell-ux.md`, `docs/EXTENSION_CLI_INTEGRATION.md`

## Context

ALP SDK management (build, flash, image, clean, renode, validate, generate, doctor, bootstrap, debug-profile) is reached today from several places that grew independently:

- The **SDK** (Python) owns the build **engine** — `alp_orchestrate` (the `--emit` planner) plus a family of `west alp-*` extension commands discovered from a west workspace.
- The **native `alp` CLI** (Rust, `cli-rs/`) exposes a byte-fixed JSON envelope + stable exit codes (`0` success / `1` runtime / `2` validation / `3` write / `4` doctor / `5` internal). It executes SDK-emitted plans (smart-build native path) and falls back to `west alp-*` via a `--west` escape hatch.
- The **VS Code extension** calls the native CLI for orchestrated commands, keeps a few raw `west flash/update` legs, and keeps host-coupled debug in-process.
- Other Alp products (Alp Studio, CI recipes) need the same operations.

`alp` is a **unification layer above the vendor SDK** whose job is to make a **SoM swap transparent**, and it targets **Zephyr + Yocto + baremetal**. Two forces shape this decision:

1. **west is Zephyr-only.** It cannot be the universal management surface — a Yocto/bitbake or baremetal project has no `.west/` to discover commands from, and west cannot bootstrap the workspace it needs to exist first (see `#843`).
2. **Consumers must not each re-implement SDK behavior.** Every place that re-derives "how to build" (env injection, venv resolution, skip-vs-fail) is a silent-drift site against the Python engine.

## Decision

**The native `alp`/`tan` CLI is the single management tool.** It is the one surface every consumer speaks to — the VS Code extension (VSIX) and every other Alp product. It stays a **Rust native binary**, and it is an **end-to-end wrapper** that keeps pace with the SDK by consuming the SDK's emitted plans rather than re-deciding anything.

Concretely, four commitments:

### D1 — One planner, many thin executors

- The **SDK's `alp_orchestrate --emit`** is the single **engine** (decides: per-core fan-out, backend routing across zephyr/yocto/baremetal, artefact contents, manifests).
- The **native CLI** is the single **surface** (executes the emitted plan; owns env resolution + UX: JSON envelope, exit codes, preflight, doctor, bootstrap).
- **`west alp-*`** remains a **Zephyr-workspace compatibility** view of the same planner — never a second implementation.
- **Raw `west build/flash/update`** is an honest Zephyr escape hatch — never wrapped, never extended.

The CLI never re-decides *what* to build; it executes *what the SDK emitted*. This is the invariant that keeps three consumers from becoming three implementations.

### D2 — The CLI stays Rust-native and is consumed, not embedded

- A single static Rust binary, distributed via GitHub releases + the `@alplabai/alp-cli` npm shim, and bundled in the **platform-targeted** VSIX (only the darwin-arm64 release job stages `bin/alp` today; the **universal** VSIX ships binary-less and resolves via download-on-demand — `.vscodeignore`, `docs/EXTENSION_CLI_INTEGRATION.md §5`).
- Consumers integrate by **spawning the binary and parsing the JSON envelope**, not by linking a library or shelling to Python. The envelope + exit codes are the contract (`docs/CLI.md`).
- Rust is chosen for: a single dependency-free binary per platform (no Python/venv at the call site), startup latency low enough for IDE use, and a stable ABI-like output contract that Studio/CI/VSIX can all parse identically.

### D3 — What the CLI wraps, by tier (not one flat "end-to-end")

The verbs are real clap subcommands (`cli-rs/crates/alp-cli/src/cli.rs`), but they are **not** uniform. Four tiers:

- **Plan-executing (the CLI decides nothing, executes the SDK plan):** `build` (native plan path is the default; `--west` is a legacy escape hatch), `run` (native_sim by default; `--flash` programs hardware — reuses `build`'s engine).
- **west-forwarding (thin wrappers over `west alp-*`, therefore require a Zephyr west workspace):** `image` → `west alp-image`, `flash` → `west alp-flash`, `clean` → `west alp-clean`, `renode` → `west alp-renode` (`WestForwardArgs`, `build.rs west_argv`). These are **not** OS-agnostic plan execution today.
- **Envelope / data-lookup (offline, pure):** `validate`, `generate`, `doctor`, `presets`, `explain`, `sdk`.
- **Lifecycle wrapper:** `bootstrap`.

- **Debug is host-coupled and stays IN-PROCESS in the extension — the CLI is not in that path.** The extension drafts + merges `launch.json` itself (`src/debug.ts` → `@alp-sdk/core/debug/launchJsonCore` `createLaunchJsonWritePlan`) and probes installed debugger extensions via `vscode.extensions.getExtension` — which a batch CLI cannot observe. The CLI *does* ship a **parallel** `alp debug-config` verb (drafts/merges a launch config for terminal/CI use, `cli-rs/.../commands/debug_config.rs`), but **no extension code consumes it**, and `docs/EXTENSION_CLI_INTEGRATION.md §4a/§6 B3` records the explicit decision to keep the whole debug domain in-process rather than migrate it. So debug is the one lifecycle stage the "single tool" does not own end-to-end — by design.

### D4 — Extension binary resolution: bundled, manual, or downloaded

The extension resolves which `alp` binary to run in a fixed precedence (`src/alpCli/service.ts` `decideBinarySource`):

1. **`alpSdk.cliPath`** — an explicit user-pinned path (the manual override). Best-effort: if the path does not exist it silently falls through (resolution requires `cliPathExists`), so it is not an authoritative pin.
2. **bundled** — `bin/alp[.exe]` shipped inside the **platform-targeted** VSIX (zero-setup, but only for that VSIX shape — the universal VSIX has no bundled binary and relies on step 6).
3. **localBuild** — a local `cli-rs/` build (developer checkout).
4. **cached** — a previously downloaded managed binary.
5. **`alp` on PATH** — the 5th leg, and accepted **only** if a native-probe passes: the extension runs `alp --version` and requires the output to match `/^alp \d+\.\d+\.\d+/` (`isNativeAlpVersionOutput`). This is placed after the managed binaries — not second — because a bootstrap venv can put the **Python** `alp` first on PATH (the two-`alp` collision, `#837`); the version-identity check is the guard that keeps the extension from silently driving the wrong binary.
6. **download-on-demand** — the true last resort: fetch the `SUPPORTED_CLI_VERSION` release asset.

So a user may run **the bundled CLI (platform VSIX), a manually-placed/downloaded CLI (`alpSdk.cliPath` or a native `alp` on PATH), or let the extension auto-download** — all three are first-class, with managed binaries winning over an unverified PATH `alp`. Caveat: on the universal VSIX, an offline/proxy-blocked host has no working CLI until `alpSdk.cliPath` is set.

## Advantages (why this is the right call)

- **One contract, many consumers.** VSIX, Alp Studio, and CI all parse the same JSON envelope + exit codes. No per-consumer re-implementation, no scraping human logs.
- **Multi-OS in the build path.** The `build` slice executor is tool-agnostic — it launches whatever `cmd.tool` the SDK-emitted plan names, and a missing tool (bitbake, vendor toolchain) yields `skipped` + reason + exit `0` (`build.rs`); `doctor --build` probes per-OS tools. This is the mechanism for Yocto/baremetal support — but only in `build`/`run`; `flash`/`image`/`clean`/`renode` still ride `west alp-*` and thus a Zephyr west workspace (see D3). A real Yocto/baremetal slice executing end-to-end is **not yet proven in-tree** (only a `build-plan` fixture) — the path is designed for it; folding the flash/image legs off west is the rollout item that completes it.
- **Runs from nothing.** Preflight gate + auto-bootstrap collapse `init → bootstrap → build` into one verb — impossible with a west-workspace-discovered surface.
- **Single-source, drift-resistant.** The SDK decides; the CLI executes. `schemaVersion` guarding turns SDK skew into a clear error instead of silent misbehavior.
- **Environment isolation.** Consumers never touch Python/venv/`ZEPHYR_BASE`; the binary encapsulates it.
- **Zero-setup default with full manual control.** The bundled binary works out of the box on the platform-targeted VSIX; `alpSdk.cliPath` / native-PATH / download cover pinned and networked installs. (Air-gapped on the universal VSIX still needs an explicit `alpSdk.cliPath` — see D4 caveat.)

## Consequences

**Positive:** covered above — one surface, multi-OS, machine-parseable, bootstrap-capable, drift-guarded.

**Negative / costs to manage:**

- **SDK version skew.** The binary releases separately from the SDK, so it loses the "commands ride the SDK checkout" coupling `west alp-*` gets for free. Mitigation: plan `schemaVersion` rejection + clear "SDK too old / CLI too old" errors; `SUPPORTED_CLI_VERSION` pinning.
- **Ported execution semantics can drift.** `cli-rs/.../build.rs` hand-ports skip-vs-fail, env injection, and venv resolution against the Python engine. Mitigation: the contract tests in `#237` and the upstream parity test in `#843` (emit → materialize → byte-compare vs `west alp-build`).
- **Distribution overhead.** Per-platform binaries, npm shim, the two-`alp` PATH collision. Mitigation: the managed-wins resolver (D4) + the `#837` `tan` rename.
- **Debug is not a single verb.** The CLI/host split for debug must be documented so it isn't mistaken for an incomplete wrapper.

## Alternatives considered

- **`west alp-*` as the single surface** — rejected: Zephyr-only, workspace-discovery-only, cannot bootstrap; excludes 2 of 3 OS targets (`#843`).
- **Keep the multi-path status quo** (extension calls CLI + raw west + in-process logic ad hoc) — rejected: every raw-west/TS-reimplemented leg is a drift site (e.g. the duplicated `EXTRA_ZEPHYR_MODULES` in `packages/alp-core/src/west/service.ts`).
- **A Python library consumers import** — rejected: forces Python/venv onto every consumer (Studio, CI, VSIX), no stable machine contract, worst-case startup latency for the IDE.
- **Collapse `west alp-*` into the CLI and retire it** — rejected: abandons west-native users + CI recipes and removes the SDK's ability to self-test orchestration inside a workspace. Two tiers are healthy *while both stay thin over the one planner*.

## Rollout (non-blocking, staged)

1. Land the boundary doc + CLI contract tests (`#237`).
2. RFC the upstream `west alp-build`-consumes-`--emit` + parity test (`#843`); pairs with the `tan` rename (`#837`).
3. Defer: fold raw `west flash/update` into the CLI (gate on `#837` + demand); delete the TS `EXTRA_ZEPHYR_MODULES` duplication when that lands; remove `--west` once every supported SDK release emits `build-plan`.

## References

- `docs/EXTENSION_CLI_INTEGRATION.md`, `docs/CLI.md`, `docs/ARCHITECTURE_RULES.md`, `docs/ADR-native-shell-ux.md`
- `cli-rs/crates/alp-cli/src/commands/build.rs`, `src/alpCli/service.ts`, `packages/alp-core/src/west/service.ts`
