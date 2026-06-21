# Proof bench: a policy/metadata/template engine reproduces the SDK emit from data

**Branch:** `proof/pmt-aen701` (off `spike/partition-allocator-rust`)
**Module:** `cli-rs/crates/alp-core/src/proof_aen701.rs` · **Tests:** 12, all green
**Context:** [alplabai/alp-sdk#235](https://github.com/alplabai/alp-sdk/issues/235)

## What this proves

A Rust engine on **our** side, driven by **policy / metadata / template DATA**, reproduces
the SDK's `alp_orchestrate.py --emit` output for a real, heterogeneous board
(`examples/multicore/rpmsg-aen/board.yaml`, **E1M-AEN701** = Alif Ensemble E7: 1× Cortex-A32
cluster + 2× Cortex-M55) — **without re-implementing the Python planner**. It derives the
result from the same metadata the SDK already ships, and parity-checks against the SDK's
actual emit.

This is the concrete answer to the RFC's central claim: **per-silicon build knowledge is
data, not hardcoded code** — and the seam the CLI already consumes is sufficient to gate it.

## The oracle (ground truth)

Generated from the **real SDK emitter** (no hand-authoring), vendored under
`cli-rs/crates/alp-core/src/spike_fixtures/oracle/`:

```
python3 -m venv /tmp/v && /tmp/v/bin/pip install pyyaml jsonschema
/tmp/v/bin/python alp-sdk-upstream/scripts/alp_orchestrate.py \
  --input alp-sdk-upstream/examples/multicore/rpmsg-aen/board.yaml \
  --emit {build-plan|system-manifest|dts-partitions|...}
```

(SDK metadata at submodule `v0.6.0-55`; refresh at a `v0.7.0` tag for the final PR.)

## Parity results — every test asserts engine output == the SDK emit

| Stage | Artefact | Parity |
|---|---|---|
| A | `a32_cluster` Yocto `local.conf` | **byte-for-byte** |
| B | full `a32_cluster` build-plan `BuildSlice` | byte/structural |
| C | `m55_he` Zephyr `alp.conf` (~40-line Kconfig) | **byte-for-byte** |
| — | `m55_hp` Zephyr `alp.conf` (+ CMSIS_DSP libs) | **byte-for-byte** |
| D | `system_ipc.h` + `dts-reservations.dtsi` + `dts-partitions.dtsi` | **byte-for-byte** |
| E | `system-manifest` content | structural |
| F | **the WHOLE build-plan, one assert** | byte/structural |

The headline: `silicon_symbol_is_computed_not_table` + the `alp.conf` parity show
`CONFIG_ALP_SOC_ALIF_ENSEMBLE_E7` is **computed** from the silicon ref
(`ALP_SOC_ + silicon.upper().replace(':','_')`) — the `_SILICON_TO_KCONFIG` table dissolves
into a rule, with "the SoC spec exists" as the allowlist (exactly as the maintainer noted).

## How it derives (the four layers, kept explicit)

- **METADATA** — `board.yaml` + the SoM preset (`E1M-AEN701.yaml`: topology, on_module,
  helper_firmware, inference, mailbox) + the board def (`e1m-evk.yaml`: name, populated) +
  the SoC spec (`e7.json`: cores, vector_extension).
- **POLICY** — the derivation rules, **loaded from `spike_fixtures/policy.json`** into a
  `Policy` struct: the base Kconfig set, the SoC/board/chip symbol prefixes, the
  chip→subsystem map, the library expansions (CMSIS_DSP), the log-level table, the
  peripheral→subsystem map, the flash recipes (with a `$machine` placeholder), and the
  inference symbol set. **The engine holds no silicon/board/OS config knowledge** — it reads
  `Policy` and applies it generically. `policy_change_alters_output` swaps one policy value
  (the SoC-symbol prefix) and shows the output changes with **no engine code change** — the
  load-bearing "rules are data" proof; the *default* policy still reproduces the emit exactly.
- **TEMPLATE** — the textual shapes (`local.conf`, `alp.conf`, the IPC/DTS headers) the engine fills.
- **ENGINE** — `resolve → derive → render → assemble`, producing the **shipped** `BuildPlan`
  type the CLI's consumer already parses.

## Honest scope / caveats (not hidden)

- **One SoM** (E1M-AEN701) — the load-bearing case (heterogeneous A32+M55, NPU, blocked IPC).
  Other SoMs are more metadata rows, not more engine code — but they aren't proven here yet.
- **Runtime path inputs are threaded, not derived** — `boardYaml`, `ALP_SDK_ROOT`, and the
  on-disk app dirs in the `west` commands are environment-specific (where files live), so the
  oracle's values are threaded in; every *derived* field is reproduced and matched.
- **The manifest is compared structurally** — it is YAML; PyYAML's line-folding/width is an
  emitter detail, not the engine's derivation. The build-plan (JSON) is matched byte-for-byte.
- **Blocked IPC path only** — AEN's `mailbox.controller` is TBD, so the carve-out is blocked
  (matching the oracle). The resolved/allocated path is the spike's `carve_out_spike.rs`
  (7/7 vs the SDK), not wired into this end-to-end run yet.
- **on_module sub-block recursion (ospi/i2c_devices) is simplified** — TBD on this board, so
  skipping them is byte-exact here; a board that populates them needs the recursion.

## What it means for the RFC

- The engine **consumes the SDK's `--emit` as the parity oracle** — ADR 0014's JSON seam is
  exactly the contract that lets this live on our side without a second planner.
- The migration is **gate-able field-by-field**: each stage is one `assert_eq` against the
  real emit; a rule lands only if the output is unchanged.
- "New silicon = data" is no longer a slogan: the Kconfig symbol, chip drivers, inference
  dispatchers, flash recipes and IPC stubs here all fall out of metadata + rules.

## Run it

```
cargo test -p alp-core proof_aen701   # 12 tests
```
