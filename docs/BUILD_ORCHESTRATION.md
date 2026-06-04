<!-- SPDX-License-Identifier: Apache-2.0 -->

# CLI-native build orchestration (Wave C)

**Status:** plan / design. Direction decided **and agreed with the SDK team**;
not yet implemented.
**Owner:** the `alp` CLI (`cli-rs/`).

**Decision (post SDK review):** the `alp` CLI sits **at the top** of the build —
it owns materialise / execute / schedule / cache / progress UX / envelope and
invokes `west` / `bitbake` / `cmake` directly. It does **not** re-implement the
planner in Rust. Instead it **consumes the SDK's `alp_orchestrate.py --emit
build-plan` JSON** (the SDK team's counter-offer). The planner — the
fast-moving, vendor-heavy part — stays the SDK's single source of truth; the CLI
owns the stable mechanism below it.

> Why we flipped from "native Rust planner": the SDK revealed the planner is not
> the stable schema logic we assumed. It doubled (1547 → 3066 lines, ~1.5k lines
> of planner/materialiser semantics in three weeks) and now carries storage
> partition allocation, sysbuild, and TF-M secure-boot. Porting it would mean
> chasing that surface forever. The "no Python dependency" prize is small (`west`
> and `bitbake` are Python; the build host already has a Python-bearing SDK
> checkout). Consuming `--emit build-plan` drops planner drift to ~zero — "one
> machine-readable source per fact", which is the SDK's core design rule.

See [`PROPOSAL-alp-build-core.md`](PROPOSAL-alp-build-core.md) for the agreement
record with the SDK team, and §9 of
[`EXTENSION_CLI_INTEGRATION.md`](EXTENSION_CLI_INTEGRATION.md).

---

## 1. The split (who owns what)

| Concern | Owner | How |
|---|---|---|
| Parse + validate `board.yaml`, resolve per-core slices, partition allocation, IPC/DTS/sysbuild/TF-M derivation, generated-file **contents** | **SDK** | `alp_orchestrate.py --emit build-plan` (new) |
| Hardware metadata (`metadata/**`), the builders (`west`/`bitbake`/`cmake`), Yocto layer, vendor glue | **SDK** | unchanged |
| Materialise (write the plan's files to disk) | **CLI** | pure IO — byte-write the `GeneratedFile`s the emit carries |
| Execute (run each slice's command) | **CLI** | subprocess: `cwd`, `env`, tee to `build.log`, rc → status |
| Schedule (parallel/sequential, incremental cache) | **CLI** | `.alp-build-state.json`, slice-hash skip |
| Progress UX + JSON envelope + exit codes | **CLI** | indicatif + the existing envelope |

The CLI is still "at the top" — it drives the build and owns everything the user
sees. It just *fetches* the plan instead of *computing* it.

## 2. Re-baseline: what changed since our first read

Our initial pass read a 1547-line `alp_orchestrate.py`; current SDK `dev` is
3066 lines. Corrections (per the SDK team, with their refs) — **all to be
re-verified against a current SDK release tag before C1, not against `dev`**:

- **Partition packaging exists now.** Storage partition allocator +
  `dts-partitions.dtsi` emission landed (commit `9a4c63e`). Our earlier "no
  partition-packaging in the build path" claim is **stale**.
- **`shared_artefacts` is larger.** `_materialise_shared`
  (`alp_orchestrate.py:2079-2106`) now emits `system_ipc.h`,
  `dts-reservations.dtsi`, `dts-partitions.dtsi` (always), `build/alp_sysbuild.conf`
  (when `boot:` is present), and `build/sysbuild/tfm/tfm.conf` (when
  `security.psa.tfm: true`).
- **Flash backends are real, not stubs.** `scripts/flash_backends/` is six
  backends; `swd_probe.py` (J-Link, GD32G553) is silicon-validated with tests.
  Leaving flash out of Wave C is still correct scoping — just not on a "stubs"
  premise.
- **Still true:** the executor is genuinely trivial (three commands, `cwd`/`env`/
  tee-to-log); per-slice `alp.conf` / `local.conf` / `cmake-args.txt` are written
  but **not yet consumed** (`alp_orchestrate.py:2130-2135`). Our two open
  questions stand.

The meta-point: the planner is Phase 2/3 of an actively moving roadmap. That is
exactly why we consume its output rather than mirror its logic.

## 3. The contract we consume (C1 — `--emit build-plan`)

The SDK adds `--emit build-plan` (idiomatic — it already does `--emit
{system-manifest|ipc-contract-h|dts-reservations}`), emitting deterministic,
schema-versioned JSON. **Our one refinement to the schema we spec'd: the emit
must carry the generated-file *contents*, so our materialise stays pure IO and no
content-derivation logic leaks back to the CLI.**

Rust deserialization target (we still own the type for the envelope):

```rust
pub struct BuildPlan {
    pub schema_version: u32,
    pub board_yaml: String,
    pub sku: String,
    pub build_root: String,                  // "build"
    pub slices: Vec<BuildSlice>,             // one per non-`off` core
    pub shared_artefacts: Vec<GeneratedFile>, // system_ipc.h, dts-reservations.dtsi,
                                              // dts-partitions.dtsi, alp_sysbuild.conf, tfm.conf, …
    pub sequential: bool,
    pub warnings: Vec<PlanWarning>,
}

pub struct BuildSlice {
    pub core_id: String,
    pub backend: Backend,                    // Zephyr | Yocto | Baremetal
    pub build_dir: String,                   // build/<core>-<os>/
    pub config_artefacts: Vec<GeneratedFile>, // alp.conf | local.conf | cmake-args.txt (+contents)
    pub command: ToolStep,                   // the build invocation (do NOT freeze its shape — see §6)
    pub env: BTreeMap<String, String>,       // ALP_SDK_ROOT, …
    pub input_hash: String,                  // for the incremental cache (or recomputed CLI-side)
}

pub struct ToolStep { pub tool: String, pub args: Vec<String>, pub cwd: String }
pub struct GeneratedFile { pub path: String, pub contents: String }  // contents REQUIRED
pub enum Backend { Zephyr, Yocto, Baremetal }
```

Surfaced under the existing envelope's `data` for `alp build --plan --format
json`. The envelope (C2) and exit codes are reused verbatim.

## 4. Parity — now a thin faithfulness check

Because we consume the plan, "plan parity" is by construction. What the harness
verifies is that our **mechanism faithfully applies the emit**:

- We write every `GeneratedFile` byte-identically to where the script's own
  `_materialise_*` would, and
- we run each `ToolStep` with the same `cwd` / `env`, and
- our `system-manifest.yaml` matches the script's (or we consume `--emit
  system-manifest` too).

Run against a **pinned SDK release tag** (not `dev` — see §7.2), committed
goldens, `--bless` to refresh, in the spirit of `cli-rs/contract/run.sh`. The
emit doubles as the strongest possible golden.

## 5. Phased delivery

- **C0 — Agree the schema + consume the emit + `alp build --plan`.** Lock the
  `--emit build-plan` JSON shape with the SDK (incl. the contents requirement);
  deserialize into `BuildPlan`; `alp build --plan` shows it (and can dry-run the
  would-write artefacts). No execution. Gate: round-trips the emit for the
  fixture matrix. *Low-risk, no SDK semantics mirrored.*
  **(Landed:** the consumer is in `alp-core::build_plan` (`BuildPlan` /
  `parse_build_plan` / `summarize_plan`, schema-version guarded) and
  `alp build --plan-from <FILE>` renders a plan under the envelope (text +
  JSON). The live `alp build --plan` path returns a clear "pending SDK emit"
  issue until `--emit build-plan` ships. Sample/reference fixture:
  `cli-rs/contract/fixtures/build/build-plan.sample.json`.**)**
- **C1 — Single-core Zephyr end to end.** Materialise (write the emit's files) +
  run the `ToolStep`; live output + envelope. **Blocked on the SDK's C4 answer
  (conf→build wiring) — they commit to answering before C1.**
- **C2 — Multi-core fan-out + Yocto + baremetal.** Parallel/sequential scheduler;
  `bitbake` (host-gated) + `cmake` backends.
- **C3 — Incremental cache + manifest.** `.alp-build-state.json` slice-hash skip;
  `system-manifest.yaml`.
- **C4 — Flip the front-ends + retire delegation.** `alp build` stops shelling to
  `west alp-build`; the extension keeps calling `alp build` (no UX change).
  `west alp-build` stays native (the SDK declined the shim — standalone west use
  is a first-class path).

Rollback at any phase = the terminal delegation that ships today.

## 6. What we need from the SDK (agreed)

The SDK team committed to:

1. `board.yaml` schema-version bump on breaking shape changes (as today).
2. `schema_version` stays on the `e1m_modules` YAMLs.
3. Release-notes / CHANGELOG heads-up for changes to: per-slice **command shape**,
   build-dir convention, env keys, metadata layout. *(Hence: do **not** freeze C3
   against today's `west build -b <board> <app>` — sysbuild overlays will grow it
   to `west build --sysbuild --sysbuild-config`.)*
4. An answer on **C4 (conf→build wiring)** before our C1.
5. **`--emit build-plan`** per §3 — to be scheduled (our refinement: carry file
   contents).

## 7. Open questions / notes

- **C4 conf→build wiring** (SDK answering; current leaning, subject to change):
  - **Zephyr:** `alp.conf` via `EXTRA_CONF_FILE`. Trap to inherit: keep extra
    conf files in a `generated/` subdir, **not** loose in the app binary dir, or
    Zephyr's `${APPLICATION_BINARY_DIR}/*.conf` GLOB picks them up twice. Sysbuild
    overlays via `west build --sysbuild --sysbuild-config`.
  - **Yocto:** per-slice `local.conf` fragment pulled via `require` from the slice
    build dir's conf; fragments use weak `?=` so hand-edits win.
  - **Baremetal:** `cmake-args.txt` splatted onto the `cmake` invocation.
- **`west build` build-dir vs cwd.** The script sets `cwd = build/<core>-<os>/`
  and runs `west build` without `-d`. Once the command shape is consumed from the
  emit (§3), this is the SDK's choice and we just run what the emit says.
- **Flash** stays out of Wave C (separate, real backends). `alp flash` keeps
  delegating until we wire it deliberately.
