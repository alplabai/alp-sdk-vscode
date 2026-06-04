<!-- SPDX-License-Identifier: Apache-2.0 -->

# CLI-native build orchestration (Wave C)

**Status:** plan / design. Decided direction; not yet implemented.
**Owner:** the `alp` CLI (`cli-rs/`).
**Decision:** the `alp` CLI sits **at the top** of the build and drives it
directly — it computes the build plan and invokes `west` / `bitbake` / `cmake`
itself. `scripts/alp_orchestrate.py` is **not** a runtime dependency; it is a
**reference spec** we read to reproduce the correct command sequence. The SDK
does **not** need to orchestrate on our behalf (see
[`PROPOSAL-alp-build-core.md`](PROPOSAL-alp-build-core.md) for the SDK-team
message).

This supersedes the deferred note in
[`EXTENSION_CLI_INTEGRATION.md`](EXTENSION_CLI_INTEGRATION.md) §9 and the earlier
"SDK extracts a shared crate" framing.

---

## 1. Why this is safe (what `alp_orchestrate.py` actually does)

We read `alp-sdk-upstream/scripts/alp_orchestrate.py` (1547 lines) end to end.
It is **not** a vendor-execution monster. It is a planner with a trivial
executor:

| Part | What it does | Owner after Wave C |
|---|---|---|
| **Planner** | `load_board_yaml` → `cores: {core_id: Slice}`; per-core topology resolution; IPC contract + DTS reservations; SoM preset lookup | **CLI / `alp-core`** |
| **Materialiser** | per-slice config files + shared generated headers | **CLI** (reuses `generate`) |
| **Executor** | **one** tool command per slice | **CLI** (wraps the tool) |
| **Scheduler** | incremental cache (slice-hash skip), parallel/sequential fan-out | **CLI** |
| **Manifest** | `system-manifest.yaml` | **CLI** |

The entire executor is three commands (`alp_orchestrate.py:1440-1465`):

```
zephyr:    west build -b <board> <app_path>           # cwd = build/<core>-<os>/
yocto:     bitbake <image|app>                         # cwd = build/<core>-<os>/
baremetal: cmake -S <app_path> -B build/<core>-<os>/
```

Each slice subprocess runs with `cwd = build/<core>-<os>/`,
`env = os.environ + ALP_SDK_ROOT=<sdk root>`, output tee'd to `build.log`, and
its return code mapped to a status (`alp_orchestrate.py:1069-1094`). **There is
no signing / `imgtool` / `objcopy` / partition-packaging in the build path.**

Two facts that further de-risk owning this:

- **Flash is a separate, still-maturing concern.** Vendor flash logic lives in
  `scripts/flash_backends/` + `west alp-flash` and is explicitly noted in-code as
  landing in "subsequent PRs" — i.e. still stubs. Build and flash are decoupled.
- **`alp_orchestrate.py` is itself Phase 2/3.** Per-slice config is written but
  the build command does not yet obviously consume it ("Phase 3 wires this up").
  We are not discarding a finished, battle-tested system.

**Where the real work is:** the *planner* (board.yaml → slices: backend, board,
machine, toolchain, app, build dir, env; plus IPC carve-outs, DTS reservations,
boot order, helper MCUs). That is **schema semantics**, which we already vendor
and track — far lower risk than owning vendor *execution*. `alp-core` already
parses `board.yaml` v2 with per-core `os` and the SoM catalogue, so this is an
*extension* of existing code, not a from-scratch port.

## 2. The build-plan contract (C1, grounded in the script)

Pure function `(resolved board.yaml + SoM/SDK metadata) → BuildPlan`. No IO,
deterministic, unit-testable. Field set mirrors `Slice`
(`alp_orchestrate.py:67-89`) plus what the executor needs.

```rust
pub struct BuildPlan {
    pub schema_version: u32,
    pub board_yaml: String,                 // resolved path
    pub sku: String,                        // SoM sku (e.g. "E1M-AEN701")
    pub build_root: String,                 // "build"
    pub slices: Vec<BuildSlice>,            // one per non-`off` core
    pub shared_artefacts: Vec<GeneratedFile>, // generated/alp/system_ipc.h, dts-reservations.dtsi
    pub sequential: bool,                   // Windows / --no-parallel
    pub warnings: Vec<PlanWarning>,
}

pub struct BuildSlice {
    pub core_id: String,                    // "m55_hp", "a32", ...
    pub backend: Backend,                   // Zephyr | Yocto | Baremetal
    pub app: Option<String>,
    pub image: Option<String>,              // Yocto image recipe
    pub machine: Option<String>,            // Yocto MACHINE
    pub board: Option<String>,              // Zephyr board target
    pub toolchain: Option<String>,
    pub peripherals: Vec<String>,
    pub libraries: Vec<String>,
    pub build_dir: String,                  // build/<core>-<os>/
    pub config_artefacts: Vec<GeneratedFile>, // alp.conf | local.conf | cmake-args.txt
    pub command: ToolStep,                  // the actual build invocation
    pub env: BTreeMap<String, String>,      // ALP_SDK_ROOT, ...
    pub input_hash: String,                 // for the incremental cache
}

pub struct ToolStep { pub tool: String, pub args: Vec<String>, pub cwd: String }
pub struct GeneratedFile { pub path: String, pub contents: String }
pub enum Backend { Zephyr, Yocto, Baremetal }
```

JSON form emitted under the existing envelope's `data` (e.g. `alp build --plan
--format json`):

```json
{
  "schemaVersion": 1,
  "boardYaml": "/path/board.yaml",
  "sku": "E1M-AEN701",
  "buildRoot": "build",
  "slices": [
    { "coreId": "m55_hp", "backend": "zephyr", "board": "alif_e7_dk_rtss_he",
      "app": "app", "toolchain": "zephyr-sdk", "buildDir": "build/m55_hp-zephyr",
      "command": { "tool": "west", "args": ["build","-b","alif_e7_dk_rtss_he","app"],
                   "cwd": "build/m55_hp-zephyr" },
      "env": { "ALP_SDK_ROOT": "…" }, "inputHash": "…" }
  ],
  "sharedArtefacts": [{ "path": "build/generated/alp/system_ipc.h", "contents": "…" }],
  "sequential": false,
  "warnings": []
}
```

## 3. Executor, materialiser, scheduler, manifest

- **Materialiser** writes `shared_artefacts` + each slice's `config_artefacts`
  (reuses the existing `generate` code paths). Build dirs: `build/<core>-<os>/`;
  shared: `build/generated/`.
- **Executor** runs `slice.command` as a subprocess (`cwd`, `env`, tee to
  `build/<core>-<os>/build.log`), rc → status. Text mode inherits stdio (live
  output + indicatif progress); JSON mode captures and folds per-slice results
  into the envelope.
- **Scheduler** = incremental cache (`build/.alp-build-state.json`, keyed by
  `BuildSlice.input_hash`; skip when hash matches a prior `ok` and the build dir
  exists) + parallel fan-out (sequential when `BuildPlan.sequential`). `--core`
  limits to one slice; `off` cores never enter the plan.
- **Manifest** writes `build/system-manifest.yaml` (slices, carve-outs, boot
  order, helper MCUs) — same shape the script emits today.

This replaces today's `alp build` → terminal `west alp-build` delegation (Wave
A2). Exit codes + envelope (C2 in the proposal) are reused verbatim.

## 4. Parity strategy (the safety net)

`alp_orchestrate.py` is deterministic and already supports
`--emit {system-manifest|ipc-contract-h|dts-reservations}` plus per-slice config
materialisation. We use it as a **golden reference**:

- For a fixture matrix of `board.yaml` × SoM, run the script and the CLI and diff
  (a) the materialised config + shared artefacts, (b) `system-manifest.yaml`, and
  (c) the exact command each would run per slice (tool + args + cwd + env keys).
- Wire this as a parity harness in the spirit of `cli-rs/contract/run.sh`
  (golden fixtures committed; `--bless` to refresh). It gates each phase.

This proves our planner matches the SDK's intent **without** depending on the
script at runtime. If the script changes, the harness flags the diff.

## 5. Phased delivery

Each phase is independently shippable and parity-gated.

- **C0 — Pure planner + `--plan` (no execution).** `alp-core` grows
  `build_plan()`; `alp build --plan` emits the `BuildPlan` (and would-write
  artefacts) without running anything. Gate: parity vs the script's
  materialise/`--emit` for the fixture matrix. *Highest-value, lowest-risk — it
  de-risks matching SDK semantics before any subprocess runs.*
- **C1 — Single-core Zephyr end to end.** Materialise + run `west build` for the
  common one-core case; live output + envelope. Gate: builds a real project; plan
  parity holds.
- **C2 — Multi-core fan-out + Yocto + baremetal.** Parallel/sequential scheduler;
  `bitbake` (host-gated) + `cmake` backends. Gate: parity across the matrix.
- **C3 — Incremental cache + manifest.** `.alp-build-state.json` slice-hash skip;
  `system-manifest.yaml` emission. Gate: cache-hit/miss matches the script.
- **C4 — Flip the front-ends + retire delegation.** `alp build` no longer shells
  to `west alp-build`; the extension keeps calling `alp build` (no UX change).
  Optionally offer `west alp-build` a thin shim over `alp build` for SDK users.

Rollback at any phase = the previous phase's behavior (C0 is inert; C1+ fall back
to the terminal delegation until flipped at C4).

## 6. What we need from the SDK (minimal, stable contract)

We are **not** asking the SDK to orchestrate or to build us a crate. We only
depend on data + tools that already exist and should stay stable:

1. **`board.yaml` schema** (already vendored + versioned) — the planner's input.
2. **`metadata/**`** (SoM topology, chips, soc-spec) — per-core type → backend +
   board/machine/toolchain resolution. Keep `schema_version` on the e1m_modules
   YAMLs.
3. **The build tools** (`west` workspace, `meta-alp-sdk` for bitbake, vendor
   CMake toolchains) — unchanged; we invoke them.
4. **The per-slice config → build consumption convention** — once the SDK
   finalizes how `alp.conf` / `local.conf` / `cmake-args.txt` feed each build
   (the script's still-open "Phase 3" wiring), we match it.

## 7. Open questions

- **Conf→build wiring.** The script writes per-slice config but the build
  command does not yet obviously consume it. Confirm the intended wiring with the
  SDK before C1 so generated config is actually applied.
- **`west build` build-dir vs cwd.** The script sets `cwd = build/<core>-<os>/`
  and runs `west build` without `-d`; decide whether the CLI passes `-d
  <build_dir>` explicitly (clearer) while keeping parity with the script's
  output layout.
- **Flash backends.** Out of scope for Wave C (separate, still-stub). `alp flash`
  keeps delegating until the SDK's flash backends stabilize.
