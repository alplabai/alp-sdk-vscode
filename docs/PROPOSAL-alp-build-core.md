<!-- SPDX-License-Identifier: Apache-2.0 -->

# Proposal: `alp-build-core` — one orchestrator, many surfaces

**Audience:** the alp-sdk (firmware) team.
**Author:** the alp-sdk-vscode (IDE + native `alp` CLI) team.
**Status:** proposal / RFC. Nothing here changes the SDK yet.
**TL;DR:** Extract the build-orchestration *brain* (`scripts/alp_orchestrate.py`)
into a shared, versioned **Rust crate `alp-build-core`** with a stable JSON
contract, consumed by **both** `west alp-build` (a thin shim) **and** the native
`alp` CLI. Today the brain is reachable only via `west`, and the `alp` CLI is a
thin wrapper around it; this couples the build UX to `west` and risks two
divergent code paths. One contract-bound brain fixes that without losing the
SDK's ownership of the hardware knowledge.

---

## 1. Context

The SDK already owns the heterogeneous build:

- `scripts/alp_orchestrate.py` (~3.4k lines) reads + validates `board.yaml`, fans
  out **one build slice per non-`off` core** into `build/<core>-<os>/`, routes
  each slice to its backend, and runs them in parallel (`--sequential` on
  Windows):

  | Core runtime | Backend | Toolchain prerequisite |
  |---|---|---|
  | Zephyr (Cortex-M) | `west build` | Zephyr SDK compiler + west workspace |
  | Yocto (Cortex-A) | `bitbake` (`meta-alp-sdk`) | Yocto host pkgs (Linux-only) |
  | baremetal | CMake + vendor toolchain | Alif / Renesas FSP / NXP, per SoC |

- `scripts/west_commands/alp_build.py` is a thin `west` extension that shells
  into the orchestrator. `alp image|flash|clean|renode` mirror it.

On the IDE/CLI side we have shipped a native Rust `alp` CLI (`cli-rs/`) that is a
**thin terminal wrapper**: `alp build` → `west alp-build` → `alp_orchestrate.py`.
That was the deliberate, correct first step (we did NOT fork the brain). But it
means:

1. The orchestration brain is only reachable **through `west`** — CI, the IDE,
   and any non-west caller must go through a Zephyr-meta-tool entry point even
   for a Cortex-A/Yocto or baremetal build.
2. The `alp` CLI cannot reason about the build (preview the plan, structured
   errors, per-slice progress) without re-parsing west's text output.
3. Two languages already model the same hardware: `alp_orchestrate.py` (Python)
   **and** `cli-rs/crates/alp-core` (Rust) both parse `board.yaml` + SoM
   topology. The risk is drift.

## 2. Goal & non-goals

**Goal:** a single orchestration brain, consumed by every surface (west, CLI,
IDE, CI) through a stable, versioned contract — while the **hardware knowledge
stays owned and versioned by the SDK**.

**Non-goals:**

- **Not** reimplementing the builders. `west build`, `bitbake`, `cmake`, and the
  vendor toolchains stay external; the crate *invokes* them. No toolchain
  dependency is removed.
- **Not** moving hardware metadata out of the SDK. `metadata/**` stays data in
  the SDK repo; the crate parses it.
- **Not** a unilateral fork. This is a proposal for the SDK team to own the crate.

## 3. Why a shared crate beats the status quo

- **One brain, no drift.** The Python orchestrator and the Rust `alp-core` model
  converge into one crate. The board/topology resolution we already have in
  `cli-rs/crates/alp-core` (`BoardModel`/`CoreEntry` with per-core `os`,
  `sdk_catalogue::{SomPreset, TopologyCore, SocCore, core_ids_for_som,
  chips_for_som, accelerator_availability}`) is ~60% of the planner already — the
  crate *extends* it rather than starting from zero.
- **Decouple from `west`.** A Yocto or baremetal build no longer has to enter
  through a Zephyr meta-tool. `west alp-build` becomes a thin shim that calls the
  crate; so does the CLI.
- **Structured everything.** The IDE gets `--preview` plans, per-slice progress,
  and machine-readable errors via the same JSON envelope the CLI already ships.

```
                 ┌────────────────────────── alp-sdk repo ──────────────────────────┐
                 │  metadata/**  (SoM topology, chips, soc-spec, carriers) — DATA    │
                 │  meta-alp-sdk/ (Yocto layer), cmake/, vendors/ — build assets     │
                 │                                                                   │
                 │            ┌──────────────────────────────┐                       │
   west alp-build│──shim────▶ │      alp-build-core (Rust)    │ ◀──direct call──┐     │
   (thin py/rust)│           │  board.yaml + metadata → Plan │                 │     │
                 │            │  Plan + Executor → Build run  │                 │     │
                 └────────────┴──────────────┬───────────────┴─────────────────┼─────┘
                                             │ invokes (never reimplements)     │
                                ┌────────────┼───────────────┐                  │
                          west build      bitbake        cmake+vendor           │
                                                                                │
                                                  alp CLI (cli-rs) ─────────────┘
                                                  IDE / CI ── via the CLI or the crate
```

## 4. What moves, what stays

| Concern | Today | After |
|---|---|---|
| Parse + validate `board.yaml` | Python (orchestrator) + Rust (alp-core) | **alp-build-core** (the Rust one, single owner) |
| Resolve per-core backend + target from SoM topology | Python `_default_os_from_core_type` etc. | **alp-build-core** planner |
| Fan-out slices, build dirs, parallel/sequential | Python | **alp-build-core** planner + runner |
| Invoke `west build` / `bitbake` / `cmake` | Python `subprocess` | **alp-build-core** executor (still subprocess) |
| Hardware metadata (`metadata/**`) | SDK data | **unchanged** (SDK data) |
| Yocto layer / CMake helpers / vendor glue | SDK | **unchanged** (SDK) |
| `west alp-build` entry point | owns the brain | **thin shim** over the crate |
| `alp build` (CLI) | wraps `west` | **calls the crate** |

---

## 5. Contracts (the stable seams)

Five contracts. Each carries an explicit `schemaVersion` and is the boundary the
SDK team owns; the CLI/IDE depend only on these, never on internals.

### C1 — Build-plan contract (the planner's output)

Pure function: `(resolved board.yaml, SoM/topology metadata) → BuildPlan`. No IO,
deterministic, the unit-testable heart. Mirrors what `alp_orchestrate.py`
computes before it shells out.

```rust
pub struct BuildPlan {
    pub schema_version: u32,            // bump on breaking shape change
    pub board_yaml: String,            // resolved path
    pub slices: Vec<BuildSlice>,        // one per non-`off` core
    pub sequential: bool,               // Windows / --sequential
    pub warnings: Vec<PlanWarning>,     // e.g. "core X off", "toolchain TBD"
}

pub struct BuildSlice {
    pub core_id: String,                // e.g. "m55_hp", "a32"
    pub backend: Backend,               // Zephyr | Yocto | Baremetal
    pub zephyr_board: Option<String>,   // derived board target (Zephyr only)
    pub toolchain: ToolchainRef,        // which compiler this slice needs
    pub app_path: String,               // app source for this slice
    pub build_dir: String,              // build/<core>-<os>/
    pub env: BTreeMap<String, String>,  // ZEPHYR_BASE, vendor SDK paths, ...
}

pub enum Backend { Zephyr, Yocto, Baremetal }

pub struct ToolchainRef {
    pub kind: String,                   // "zephyr-sdk" | "yocto-host" | "vendor"
    pub id: String,                     // "zephyr-sdk-1.0.1" | "alif-ensemble" | ...
    pub install_hint: String,           // installer URL / doc anchor
}
```

JSON form (what `--preview --format json` emits under `data`):

```json
{
  "schemaVersion": 1,
  "boardYaml": "/path/board.yaml",
  "slices": [
    { "coreId": "m55_hp", "backend": "zephyr", "zephyrBoard": "alif_e7_dk_rtss_he",
      "toolchain": {"kind":"zephyr-sdk","id":"zephyr-sdk-1.0.1","installHint":"…"},
      "appPath": "app", "buildDir": "build/m55_hp-zephyr", "env": {"ZEPHYR_BASE":"…"} },
    { "coreId": "a32", "backend": "yocto", "zephyrBoard": null,
      "toolchain": {"kind":"yocto-host","id":"meta-alp-sdk","installHint":"…"},
      "appPath": "userspace", "buildDir": "build/a32-yocto", "env": {} }
  ],
  "sequential": false,
  "warnings": []
}
```

### C2 — JSON envelope (already shipping; reuse verbatim)

Every command the crate exposes emits the envelope the `alp` CLI already
guarantees byte-for-byte:

```json
{ "command": "build", "ok": true, "exitCode": 0,
  "project": { "root": "…", "boardYaml": "…" },
  "data": { /* BuildPlan, or per-slice results */ },
  "issues": [ { "code": "build.toolchain-missing", "severity": "error", "message": "…" } ] }
```

Stable **exit codes** (already used across the CLI): `0` success, `1` runtime,
`2` validation, `3` write, `4` doctor/preflight, `5` internal. The crate MUST keep
these — the IDE maps them to UX and CI gates on them.

### C3 — Executor / backend trait (planning vs running)

The crate **plans** in pure code, then **runs** through an injected executor, so
the same plan drives a live terminal build (IDE/CLI), a captured CI build, or a
dry run.

```rust
pub trait BuildExecutor {
    /// Run one slice; stream or capture per the caller's mode.
    fn run(&mut self, slice: &BuildSlice, cmd: &PlannedCommand) -> SliceOutcome;
}

pub trait Backend {
    /// Translate a slice into the concrete tool invocation(s).
    /// Zephyr → `west build -b <board> -d <dir> <app>`
    /// Yocto  → `bitbake <image>` in the meta-alp-sdk env
    /// Baremetal → `cmake -S … -B <dir> -DTOOLCHAIN=… && cmake --build`
    fn commands(&self, slice: &BuildSlice) -> Vec<PlannedCommand>;
}
```

Text mode inherits stdio (live output); JSON mode captures and folds into the
envelope. This is the same split the CLI's `bootstrap`/`build` already use.

### C4 — SDK-metadata contract (the data the crate reads)

The crate reads, and the SDK owns + versions, this tree. A `metadata
schema_version` (already present in the e1m_modules YAMLs) guards compatibility.

```
metadata/
  e1m_modules/<E1M-…>{.yaml | /som.yaml}   # sku, family, display_name, topology, cores
  chips/…                                  # chip defs (kconfig, accelerators)
  soc-spec/…                               # per-SoC cores, families
  carriers/…
```

The crate already parses most of this (`alp-core::sdk_catalogue`). Both the flat
`E1M-X.yaml` and the `E1M-X/som.yaml` layouts are supported. The **per-core type
→ backend** mapping (the one piece `board.yaml` alone can't carry) is resolved
from this metadata — exactly where it should live.

### C5 — Versioning & compatibility

- `alp-build-core` is **published from the alp-sdk repo** (or a dedicated repo
  both consume), semver-versioned **in lockstep with the SDK's hardware model**.
- The `alp` CLI declares a compatible range (`alp-build-core = "^1"`); the
  `BuildPlan.schemaVersion` + envelope are the runtime compat guard.
- A compatibility matrix (SDK version ↔ crate version ↔ CLI version) ships in the
  SDK's `docs/`, mirroring the existing `docs/os-support-matrix.md`.

---

## 6. Migration plan (phased, parity-gated)

Each phase keeps `west alp-build`'s observable behavior identical; a **golden
build-plan parity harness** (dump `BuildPlan` JSON for a fixture matrix of
`board.yaml` × SoM) gates every step — the same pattern as
`cli-rs/contract/run.sh`.

- **Phase 0 — Extract the planner (no behavior change).** Move the
  board.yaml+metadata → plan logic into `alp-build-core` (building on the
  existing `alp-core` parsing). `alp_orchestrate.py` calls the crate for the plan
  (via pyo3 or a `--emit-plan --format json` subprocess) but still runs the
  builds. Gate: crate's plan == orchestrator's current fan-out for every fixture.
- **Phase 1 — Move the run loop behind the executor trait.** The crate owns
  fan-out + dispatch; backends shell to west/bitbake/cmake as today. The Python
  orchestrator shrinks to a shim. Gate: build outputs identical.
- **Phase 2 — Two thin front-ends.** `west alp-build` (Python shim) and `alp
  build` (CLI) both call the crate. The CLI stops wrapping `west` and calls the
  brain directly. Gate: `alp build` == `west alp-build` for the matrix.
- **Phase 3 — Retire the Python internals.** Keep the `west` command as a shim
  (Zephyr users expect it); delete the duplicated logic. One brain remains.

Rollback at any phase = revert to the previous shim; the contract is the seam.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Rust port surface (~3.4k Python lines) | Phase 0 only ports the **planner** (pure, testable); the run loop + builders move later, incrementally. |
| Drift during migration | Golden build-plan parity harness gates every phase; one brain after Phase 2. |
| Yocto is Linux-only / hour-long | Backend trait keeps Yocto a captured, host-gated slice; no change to bitbake itself. |
| Windows `--sequential` | Encoded in `BuildPlan.sequential`; executor honors it. |
| Vendor-licensed toolchains | Out of scope — `ToolchainRef.install_hint` only points; the crate never bundles them. |
| Cross-repo coordination | The crate + its contracts are owned by the SDK team; the CLI depends on a published version, never on internals. |

## 8. What the CLI/IDE side already gives you

So the SDK team isn't starting cold — the consumer half exists and is proven:

- **The envelope + exit codes (C2)** are implemented and contract-tested in
  `cli-rs/` (`crates/alp-cli/src/envelope.rs`, `exit.rs`, `contract/run.sh`).
- **The board + SoM/topology parsing (C1/C4 inputs)** exist in
  `cli-rs/crates/alp-core` (`model.rs`, `sdk_catalogue.rs`, `validate.rs`) — the
  natural home to grow `alp-build-core` from.
- **The thin-wrapper commands** (`alp build|image|flash|clean|renode`,
  `alp doctor --build` preflight, `alp bootstrap`) are the front-end that will
  flip from "wrap `west`" to "call the crate" in Phase 2 with no UX change.
- **The IDE** already invokes the CLI by JSON envelope (per-click) and terminal
  (live builds); it inherits the structured plan/progress for free.

## 9. Ask

1. Agreement in principle that the orchestration brain should be a
   contract-bound shared crate (`alp-build-core`), not west-locked Python.
2. Decide the crate's home (in `alp-sdk` vs a dedicated repo) and ownership.
3. Ratify contracts C1–C5 (shapes above are a starting point).
4. Green-light **Phase 0** (extract the planner; no behavior change) as the
   first, reversible step.

The IDE/CLI team will provide the consumer side (envelope, CLI front-ends, the
existing `alp-core` parsing to build on) and the parity-harness pattern.
