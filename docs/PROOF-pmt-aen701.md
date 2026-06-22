# A policy/metadata/template engine + per-SoM bundle architecture (reproduces the SDK emit from data)

**Branch:** `proof/pmt-aen701` (off `spike/partition-allocator-rust`)
**Module:** `cli-rs/crates/alp-core/src/proof_aen701/` (a module tree, not one file) · **Tests:** 41, all green
**Proven:** the build config reproduces from data for **two vendors** — Alif Ensemble (E7 + E8) **and Renesas RZ/V2N** (DRP-AI, a55+m33, GD32 bridge) — same zero-literal engine, new bundle, vendor-neutral schema.
**Context:** [alplabai/alp-sdk#235](https://github.com/alplabai/alp-sdk/issues/235)

## What this proves

A Rust engine on **our** side, driven by **policy / metadata / template DATA**, reproduces
the SDK's `alp_orchestrate.py --emit` output for a real, heterogeneous board
(`examples/multicore/rpmsg-aen/board.yaml`, **E1M-AEN701** = Alif Ensemble E7: 1× Cortex-A32
cluster + 2× Cortex-M55) — **without re-implementing the Python planner** — and goes beyond a
proof into an **architecture**: a versioned per-SoM bundle, a load-time version/compat gate,
policy-driven peripheral + pin/pad handling, and semantic compatibility diagnostics.

This is the concrete answer to the RFC's central claim: **per-silicon build knowledge is
data, not hardcoded code** — and the seam the CLI already consumes is sufficient to gate it.

## The versioned per-SoM bundle (the architecture, not just the proof)

A new silicon module ships as **one self-contained, versioned folder** — a generic engine
resolves a SoM → loads its bundle → produces the build plan. No Python per silicon.

```
spike_fixtures/
  som/E1M-AEN701/
    bundle.yaml         # the MANIFEST + version gates (loaded FIRST)
    policy.json         # the build RULES (schemaVersion-checked)
    pin-policy.json     # the PIN/peripheral validation RULES (separate from build policy)
    som.yaml            # the SoM METADATA (facts)
    templates/          # every output SHAPE, as data
      local.conf.tmpl  kconfig.tmpl  system_ipc.h.tmpl
      dts-reservations.dtsi.tmpl  dts-partitions.dtsi.tmpl
  e7.json  e1m-evk.yaml                  # SHARED metadata (per-silicon / per-carrier)
  pinmux.alif-ensemble-e7.yaml           # SHARED per-silicon pin-mux CAPABILITY (facts)
  templates/board-routes.h.tmpl          # SHARED (board-level) shape
  oracle/                                # the captured SDK emit (parity ground truth)
```

### Versioning (validated against Helm / OCI / npm / Cargo / Yocto)

Three **orthogonal** axes — separating them is what stops the chaos of version-in-filename:

| Axis | Where | Bumps when |
|---|---|---|
| **schemaVersion** | `bundle.yaml` + each layer + `policy.json` | the *format* changes (rare); engine rejects unknown |
| **bundleVersion** | `bundle.yaml` (semver) | *content* changes (policy/template/metadata) — never on SDK bumps |
| **sdkCompatRange** | `bundle.yaml` (`">=0.6.0,<1.0.0"`) | which SDK releases the bundle serves (checked at load) |

Filenames are **stable and manifest-declared** (`som.yaml`, never `som.v0.7.0.yaml`); release
history lives in **git tags**, not parallel in-tree copies. `load_bundle()` is the engine's
entry gate: it validates the manifest format, every layer schema, and the SDK-compat range
(a tiny dependency-free semver-range check) **before any layer is read** — npm-peerDependencies
style: one clear early error, not a runtime mis-derive.

## E8/AEN801 — the universality proof (a second silicon, vs the v0.7.0 emit)

The maintainer's decisive ask: reproduce the bench on the **lead part, AEN801 (E8)** —
different core mix, **Ethos-U85** — against its `--emit`. Done, against the **v0.7.0 tag**:

- The **only** new authored data is `som/E1M-AEN801/som.yaml` (E8 SoM metadata) + the shared
  `e8.json`. `policy.json`, `pin-policy.json`, and **every template are byte-identical to E7**
  (asserted in `e8_bundle_reuses_the_e7_shapes`).
- The **same** `assemble_full_plan` reproduces the **whole E8 build-plan in one assert**
  (`e8_full_build_plan_matches_sdk_emit`) — **zero engine-code change**. The E8 SoC symbol
  (`CONFIG_ALP_SOC_ALIF_ENSEMBLE_E8`) and the **Ethos-U85** dispatcher fall straight out of the
  new SoM metadata (E7 emits U55 only; E8 adds U85) — `e8_m55_hp_alp_conf_…byte_for_byte`.
- **ALP-B012** keeps the **known-silicon allowlist**: the computed SoC symbol stays
  non-emitting for an out-of-catalogue `silicon:` (membership = a matching `SocSpec.ref`).

**Honest scope of the E8 result.** E7 and E8 are the **same family on the same board**: the two
`board.yaml`s are byte-identical bar the `sku:`, the topology is identical, and the derived delta is
just the SoC symbol + the U85 line + machine/board name strings. This proves **data-driven part
addition *within the Alif Ensemble family*** — it does **not** exercise E8's actual differentiators
(ISP/camera, HexSPI, a resolved carve-out, OSPI/storage) since this RPMsg board leaves
`memory_map`/`mailbox` TBD, and it is **not** a cross-vendor (Renesas/NXP) result. "New part = a
versioned data folder, not planner edits" is proven for a **second same-family part**, not as
vendor-agnostic universality.

## Parity + behaviour — 41 tests (E7 + E8 + V2N cross-vendor)

| Stage | Artefact / check | Result |
|---|---|---|
| A | `a32_cluster` Yocto `local.conf` | **byte-for-byte** |
| B | full `a32_cluster` build-plan `BuildSlice` | byte/structural |
| C | `m55_he` / `m55_hp` Zephyr `alp.conf` (~40-line Kconfig, + CMSIS_DSP) | **byte-for-byte** |
| D | `system_ipc.h` + `dts-reservations.dtsi` + `dts-partitions.dtsi` | **byte-for-byte** |
| E | `system-manifest` content | structural |
| F | **the WHOLE build-plan, one assert** | byte/structural |
| — | bundle manifest: load, gate, reject unknown schema / incompatible SDK | enforced |
| — | **ALP-B010** peripheral not on silicon (policy-aliased coverage) | WARNING |
| — | **ALP-B011** SoM family not hosted by the carrier | ERROR (blocks) |
| — | **ALP-B013** E1M pad double-claimed (minus allowlist) | ERROR (blocks) |
| — | **ALP-B014** pad dispatches via a mediator the SoM lacks | ERROR (blocks) |
| — | pin/pad **compose** (board roles + SoM dispatch) → `routes.h` | structural |
| — | **ALP-P001** silicon pad cannot carry the assigned signal | ERROR (blocks) |
| — | **ALP-P002** two owners contend for one pad | ERROR (blocks) |
| — | **ALP-P003** two peripherals drive one alternate-function block | ERROR (blocks) |
| — | pin-mux **validation source** (`valid_pads_for` / `functions_of` / `pad_supports`) | API |

The headline parity: `CONFIG_ALP_SOC_ALIF_ENSEMBLE_E7` is **computed** from the silicon ref
(`ALP_SOC_ + silicon.upper().replace(':','_')`) — the `_SILICON_TO_KCONFIG` table dissolves
into a rule, with "the SoC spec exists" as the allowlist (as the maintainer noted).
`policy_change_alters_output` swaps one policy value and the output changes with **no engine
code change** — the load-bearing "rules are data" proof; the default policy still reproduces
the emit exactly.

## The module tree (parser → writer, dependencies point downward)

```
proof_aen701/
  macros.rs      check_schema_version! (version gate) · vars! (writer var maps)
  ── PARSER (deserialize → structs + gates + validation) ──
  metadata.rs    board.yaml / SoM / board-def / SoC structs (serde IS the parser)
  policy.rs      Policy (build rules as data) + load_policy (schemaVersion gate)
  pinmux.rs      pin-mux CAPABILITY (metadata) + PinPolicy (rules) + validation API
                 + the pin rule engine (ALP-P001/P002/P003)
  bundle.rs      bundle.yaml manifest + load_bundle (schema/sdk-compat gate) + Templates
  validate.rs    Diagnostic{code,severity,message,hint} + ALP-B010/B011/B013/B014
  ── WRITER (data → config-file strings) ──
  template.rs    domain-free {{var}}/{{#if}}/{{#each}} renderer (+ drift guard)
  render.rs      per-output generators + pin/pad compose + routes.h
  assemble.rs    build-plan + system-manifest assembly
  tests.rs       the parity + behaviour suite
```

## Policy-driven peripheral + pin/pad (the engine holds no hardware knowledge)

- **Peripherals** — coverage is checked against the SoC JSON `peripherals` inventory:
  direct hits, variant suffixes (`i2c`→`i2c_lp`, `can`→`can_fd`, `adc`→`adc_12bit`), and
  **policy `peripheralAliases`** (`counter`→`timer*`, `pwm`→`pwm|timer`, `sensor`→always).
  A gap is **ALP-B010** (WARNING — the inventory may be incomplete / the part may be board-side).
- **Pins/pads** — the engine **composes** the board's `e1m_routes` (board-agnostic role → E1M
  pad) with the SoM's `pad_routes` (per-pad dispatch: a mediator chip like the CC3501E + pin,
  or `direct`). This is what makes a board.yaml **SoM-swappable**. It renders
  `alp_<board>_routes.h` from a template, and runs **ALP-B013** (a pad claimed by two roles,
  minus the policy `padDualClaimAllowlist`) + **ALP-B014** (a pad dispatching via a mediator
  the SoM does not populate). Messages are plain, greppable strings — exactly what a user
  reads to fix their `board.yaml`.
- **Pin-mux capability (separate metadata + pin policy)** — "which pin can carry which
  peripheral signal" is a **silicon FACT**, so it lives in a per-silicon `pinmux.<silicon>.yaml`
  (METADATA: pad→signals, peripheral→signal→pads, alternate-function blocks), while the
  validation **rules** (conflict severities, the B013 allowlist) live in a **separate**
  `pin-policy.json` — *not* in the build policy. The rule engine reads both and produces
  capability diagnostics (**ALP-P001** pad can't carry the signal · **ALP-P002** pad contention
  · **ALP-P003** alternate-function-block conflict) **and** a **validation source** the CLI +
  VS Code extension query (`valid_pads_for(periph, signal)` → the legal pins a picker offers;
  `pad_supports(pad, signal)` → live edit validation). This is what lifts pin config from a
  text editor to a **validated, advanced pin-mux UI**.

## Rust macros — applied where they earn it

- **`check_schema_version!`** (parser) — every layer (bundle / metadata / policy / template)
  enforces the version gate identically through one macro.
- **`vars!`** (writer) — builds a template's scalar var map without `BTreeMap::from([(…)])` noise.
- **serde derives** (parser) — `#[derive(Deserialize)]` + `deny_unknown_fields` on the manifest
  *is* the parser; drift surfaces as a parse error.
- A **drift guard** in `render_template` (`debug_assert`) catches a template referencing a var
  the engine forgot to supply.
- Deliberately **not** macro'd: the writer generators and the compat-check messages stay plain
  functions — readable, debuggable, greppable (per the design memo; a proc-macro would hide the
  exact strings reviewers most need to see).

## Honest scope / caveats (not hidden)

- **Two vendors, build config only** (Alif Ensemble E7+E8 + Renesas RZ/V2N). The cross-vendor port
  generalized three Alif-shaped schemas as DATA (inference `acceleratorBackend` keyed by silicon +
  gated on `soc.npus`; `dispatch_pin` number-or-name; `flash_args` string-or-map) — no per-vendor
  engine branch. The per-core build SLICES reproduce byte-for-byte for both vendors; NXP and other
  accelerators (DEEPX, no-NPU parts) are not yet exercised. The board↔silicon alias bridge is still
  partly hand-maintained.
- **The resolved IPC carve-out / memory-map allocator IS reproduced** (`carveout.rs`): V2N has a live
  `mailbox.controller`, so the engine resolves the memory map (SoM `memory_map` → SoC `memory_regions`),
  picks the region (`accessible_from` ⊇ endpoints, cacheable rank), allocates **top-down page-aligned**,
  and derives the endpoint IDs (`0x400 | (fnv1a_32(name) & 0xFF)`, `dst=src+1`) + the mailbox channel —
  reproducing the SDK's `resolve_carve_outs` from DATA. V2N reproduces the **whole** build-plan
  byte-for-byte *including* the carve-out (`alp_default_rpmsg` @ `0x00010000`, 512 KiB OCRAM,
  `SRC/DST_EPT 0x4e6/0x4e7`); AEN/E8 stay on the blocked stub (their `mailbox` is TBD).
- **The remaining named planner paths ARE reproduced** (byte-for-byte vs the SDK `production-deployment`
  oracle — SKU `E1M-AEN701`, same SoM bundle, a richer board.yaml that declares `storage:`/`boot:`/
  `security:`/`ota:`):
  - **OSPI/storage partitions** (`partition.rs`): the bottom-up bump allocator places the 5 `storage:`
    entries on the variant-derived `mram_main` region (5.5 MiB) → the `dts-partitions` overlay +
    `storage_mount_table.c` reproduce exactly. The 3rd memory-map tier (SoM `memory_map` → SoC
    `memory_regions` → **derive from the SoC variant's MRAM + SRAM banks**) also closes the carve-out's
    last derivation gap.
  - **PSA/TF-M** (`secure.rs`): `tfm-sysbuild.conf` from `security.psa:` + `boot.build_type` — build-type
    canonicalisation, PSA slot count, ITS/PS backing stores, OPTIGA attestation — all `policy.secure`-keyed.
  - **MCUboot signing** (`secure.rs`): `alp_sysbuild.conf` from `boot:` — signing algo, key-file, slot/
    scratch sizes, swap mode, anti-rollback. (The signed *image* is imgtool's job; only the conf is reproduced.)
  - **ISP/camera was a mis-identification, not a gap:** the SDK has no ISP planner path (the 22 "isp"
    grep hits were all "di**sp**atch"); cameras (OV5640, cam-mux) are ordinary `CHIP_<NAME>` drivers the
    engine already reproduces. Of the four originally-named gaps, three were real paths (now done) and
    one was already covered.
- **The full per-slice `alp.conf` is the broader-planner frontier, not the four paths:** its storage +
  OTA sections are reproduced in isolation, but the complete slice file also interleaves `iot:`,
  `cores.<id>.memory:`/`power:`, `diagnostics.modules:`, and top-level project `chips:` — separate board
  features beyond the named paths. Those, plus host-path normalization on the build-plan envelope, are
  the remaining work for a whole-build-plan byte diff on a maximal board (named here, not hidden).
- **Runtime path inputs are threaded, not derived** — `boardYaml`, `ALP_SDK_ROOT`, the on-disk
  `west` app dirs are environment-specific; the oracle's values are threaded, every *derived* field is matched.
- **The manifest is compared structurally** — it is YAML; PyYAML formatting is an emit detail. The build-plan (JSON) is byte-for-byte.
- **`routes.h` is structural** — the SDK's `gen_board_header.py` output is not in the `--emit`
  oracle, so the routing header is asserted structurally (the right `#define`s + dispatch comments), not byte-for-byte.
- **Both IPC paths reproduced** — AEN/E8's `mailbox.controller` is TBD → blocked stub (matching the
  oracle); V2N's is live → the allocator resolves real addresses (`carveout.rs`), also matching the oracle.

## What it means for the RFC

- The engine **consumes the SDK's `--emit` as the parity oracle** — ADR 0014's JSON seam is
  exactly the contract that lets this live on our side without a second planner.
- The migration is **gate-able field-by-field**: each stage is one `assert_eq` against the real emit.
- "New silicon = data" is no longer a slogan: the Kconfig symbol, chip drivers, inference
  dispatchers, flash recipes, IPC stubs, peripheral coverage and pin routing here all fall out of
  metadata + rules + templates — in one versioned bundle the CLI (or any third-party tool) can consume.

## Run it

```
cargo test -p alp-core proof_aen701   # 41 tests (E7 + E8 + V2N)
```
