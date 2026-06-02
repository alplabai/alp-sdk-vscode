# ALP CLI — Rust Rewrite Plan

> **Goal:** Extract the `alp` CLI from the TypeScript monorepo and ship it as an
> independent, statically-linked native binary — without letting CLI behavior
> diverge from the rest of the SDK.

## 0. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Repo layout | **Polyglot monorepo** — Rust lives in `cli-rs/` inside `alp-sdk-vscode` | Keeps history + fixtures together while contracts are young. Revisit splitting to its own repo once the schema contract stabilizes. |
| Anti-divergence | **Schema-first contract** (share `board.schema.json` + golden fixtures, run an identical conformance suite on TS and Rust) | Satisfies CLI.md "no business-logic divergence" without sharing code. Simpler than a napi-rs/WASM bridge (deferred). |
| Arg parsing | `clap` 4.6 (derive) | Confirmed by user; de-facto standard. |
| Prompts | `inquire` 0.9 | For `init`/scaffold flows. alp is headless/scriptable, **not** a TUI → no ratatui. |
| Edition | Rust 2024 | Stable since 1.85; toolchain is 1.96. |
| Distribution | `dist` (formerly cargo-dist) | Multi-platform binaries + installers, incl. an npm shim so `npm i -g alp-sdk` keeps working. |
| YAML | `serde_yaml` 0.9 (PoC) | Standard but unmaintained → revisit (`serde_yml` fork or `yaml-rust2`) before GA. |

### Contract invariants (must never drift from TS)
- **Envelope JSON shape** (byte-for-byte): `{ command, ok, exitCode, project:{root,boardYaml}, data, issues:[{code,severity,message}] }`.
- **Output channels:** JSON mode → exactly one JSON doc on **stdout**; human text → **stderr**.
- **Exit codes** (`CLI_EXIT_CODE`): `0` success · `1` runtimeFailure · `2` validationFailure · `3` writeFailure · `4` doctorFailure · `5` internalFailure.
- **Global flags** (CLI.md §3.1): `--project --board-yaml --sdk-root --format --verbose --quiet --no-color --non-interactive --ci`.

---

## Phase 0 — `validate` PoC  ✅ DONE
Prove the surface end-to-end against the **offline** local validator.

- [x] Cargo workspace `cli-rs/` (members `alp-core`, `alp-cli`); optimized release profile.
- [x] `alp-core`: `model.rs` (BoardModel/Som/CoreEntry, `effective_schema_version`), `validate.rs` (`validate_board_yaml_local` mirroring TS) + 4 unit tests.
- [x] `alp-cli`: `cli.rs` (clap surface, all global flags), `exit.rs` (ExitCode), `envelope.rs` (Serialize, camelCase), `commands/validate.rs`, `main.rs`.
- [x] `cargo build` + `cargo test` green; manual parity check vs TS on real `board.yaml`.
- [x] Seed `contract/fixtures/{valid,invalid}/`.

**Parity caveat:** Phase 0 targets the **offline** `validateBoardYamlLocally`
(used by LSP/tests). The real `alp validate` command spawns the Python SDK
validator (`executeValidatorPlanWithSpawn`); full spawn parity is **Phase 5**.

---

## Phase 1 — Contract harness  ✅ DONE
Make divergence detectable by CI instead of by humans.

- [x] Author `contract/board.schema.json` from the TS board model.
- [x] Define golden-fixture format: `board.yaml` → `expected.json` (envelope) + `expected.exit`.
- [x] Build an initial fixture corpus from clean examples + hand-crafted violations.
- [x] `contract/run.sh`: runs the Rust binary and the TS **offline validator runner** over every fixture, diffs stdout JSON + exit code, fails on mismatch.
- [x] Wire the harness into CI (`.github/workflows`), gating Rust PRs.

## Phase 2 — Deepen `alp-core`  (ACTIVE)
Port the remaining offline-computable domain logic, fixture-driven.

- [x] Expand Rust BoardModel mirror with carrier, inference, IoT, libraries, IPC, diagnostics, chips/routes scaffolding.
- [x] Port `normalizeBoardModel` cleanup rules (`v1` empty optional blocks, `v2` top-level `os` removal).
- [x] Add Rust effective-config preview payload helper mirroring TS `createEffectiveConfigPreviewPayload`.
- [x] Port SDK-catalogue parser helpers (`parse_board_preset`, `parse_chip_def`, `parse_som_preset`, `parse_soc_spec`).
- [ ] Full BoardModel parity for board/schematic-specific fields (pins/populated routes/board presets + strict enums).
- [x] Port SDK-catalogue derive helpers for SoM capability lookups (`boards_for_som`, `core_ids_for_som`, `chips_for_som`, `chip_family_for_sku`, `accelerator_availability`).
- [x] Add board-level overlay helpers for effective chip enablement (`effective_populated`, `effective_chip_choices`).
- [ ] Integrate Phase 2 core helpers into upcoming commands (`generate`, `diff`, `inspect`) so runtime outputs are fixture-verified end-to-end.
- [x] Expand unit + contract fixtures per ported rule.

## Phase 3 — `generate`
Highest-value command after validate.

- [ ] Port generation outputs (see `GENERATION_OUTPUTS.md`) deterministically.
- [ ] Byte-for-byte file-output parity via golden trees in `contract/fixtures/generate/`.
- [ ] Honor `writeFailure` (exit 3) semantics.

## Phase 4 — `init` / scaffold (interactive)
- [ ] `inquire`-driven prompts; `--non-interactive`/`--ci` must fully bypass prompts.
- [ ] Scaffold parity with `SOURCE_SCAFFOLDING.md`.

## Phase 5 — Remaining commands + SDK spawn
- [ ] `doctor` (exit 4), `validate` **full** (Python validator spawn parity), and the rest of the 14 commands.
- [ ] Decide spawn strategy: shell out to the same Python entrypoint the TS CLI uses → guarantees parity.

## Phase 6 — Distribution
- [ ] Adopt `dist`: generate `release.yml` producing macOS/Linux/Windows binaries + installers.
- [ ] npm shim package wrapping the native binary so `npm i -g alp-sdk` is unchanged.
- [ ] Add `cli-rs/` to `.vscodeignore` so it is **not** packaged into the VSIX.

## Phase 7 — Cutover
- [ ] Flip docs (`CLI.md`, `GETTING_STARTED_CLI.md`) to the Rust binary.
- [ ] Deprecate the TS CLI entrypoint; keep core for the VS Code extension + LSP.
- [ ] Run the contract harness as a release gate (`RELEASE_GATES.md`).

## Phase 8 — Optional TUI
- [ ] Only if a genuinely interactive dashboard is wanted (`ratatui`/`iocraft`); not required for CLI parity.

---

## Layout

```
cli-rs/
├── Cargo.toml                 # workspace
├── contract/
│   ├── board.schema.json      # (Phase 1)
│   ├── run.sh                 # TS vs Rust conformance (Phase 1)
│   └── fixtures/validate/
└── crates/
    ├── alp-core/   # domain logic, zero IO/clap; fixture-tested
    │   └── src/{lib,model,validate}.rs
    └── alp-cli/    # bin "alp"; clap + envelope + IO
        └── src/{main,cli,exit,envelope}.rs + commands/
```

## Build / test
```sh
cd cli-rs
cargo build              # debug
cargo test               # unit + (later) contract
cargo build --release    # optimized, stripped, panic=abort
target/debug/alp validate --board-yaml <path> --format json
```
