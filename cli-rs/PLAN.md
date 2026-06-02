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

## Phase 3 — `generate`  ✅ DONE
Highest-value command after validate.

- [x] Add `alp generate` command skeleton in Rust CLI (target/all flags, JSON/text envelope, exit-code contract).
- [x] Honor `writeFailure` (exit 3) semantics.
- [x] Use as-given paths (not resolved absolutes) in JSON envelope so golden fixtures are reproducible.
- [x] Error-path golden contract fixtures: `missing-board` (exit 2), `sdk-unresolved` (exit 2), `invalid-target` (exit 5).
- [x] Extended `contract/run.sh` to run generate fixtures (reads `args.txt` per fixture).
- [x] Full success-path parity with Python SDK requires PyYAML; tracked as Phase 5 (spawn parity).

## Phase 4 — `init` / scaffold (interactive)  ✅ DONE
- [x] `inquire`-driven prompts; `--non-interactive`/`--ci` must fully bypass prompts.
- [x] Scaffold parity with `SOURCE_SCAFFOLDING.md`.
- [x] 6 project templates (minimal-app, sensor-starter, iot-starter, edge-ai-starter, board-diagnostics, host-tooling-starter).
- [x] 4 module templates (sensor-driver, connectivity-service, inference-stage, diagnostics-check).
- [x] `--preview`, `--force`, `--name`, `--destination`, `--template` as subcommand args on Init/Scaffold.
- [x] `alp-core/src/wizard/` module: models, service (file generators), filesystem (collect/write).
- [x] 23 unit tests pass; contract harness passes.

## Phase 5 — Remaining commands + SDK spawn  (ACTIVE)
- [x] `doctor` (exit 4). Ported the debug-doctor domain to `alp-core`
      (`debug.rs`: target/server kinds, `build_doctor_report`,
      `server_choices_for_target`, runtime-capability + workspace-context
      adapters), plus `project.rs` (`resolve_project_context`, the canonical
      `ProjectContext` now shared with `preview.rs`) and `clock.rs`
      (`format_iso8601_utc`, pure, honors `SOURCE_DATE_EPOCH`). CLI command in
      `commands/doctor.rs`: `--target-kind`/`--server`, `which`/`where` probe,
      unsupported-server → exit 4 (`project: null`), invalid kind → exit 5.
  - **Parity is unit-tested, not golden-fixtured.** Doctor output is machine
    dependent (absolute workspace/sdk paths; `which jlink/openocd/lldb/python`
    presence varies per host), so a byte-for-byte golden fixture would be
    flaky. The TS↔Rust logic parity lives in deterministic `alp-core` unit
    tests (runtime capabilities + contexts injected as predicates). The
    contract harness stays focused on IO-shaped envelope determinism
    (validate/generate).
- [x] **Spawn strategy: shell out** to the same Python entrypoint the TS CLI
      uses (the validator is a Python script — `generate` already shells out the
      same way). napi-rs/WASM is irrelevant here and stays deferred (§0).
- [x] `validate` **full** (Python validator spawn parity). Default `alp validate`
      now spawns `<sdk>/scripts/validate_board_yaml.py --input <board>`, mirroring
      TS `runValidateCommand`: context resolve → guards (board-missing /
      sdk-unresolved → exit 2) → spawn → classify exit status (0 clean · 1
      schema-violation · 2 missing-preset · 3 hardware-revision · else failed) →
      parse stderr → outcome→exit (clean 0 · {missing-preset,schema,hw} 2 ·
      failed 1). Ported `analyze_validation_result` + `parse_validation_issues`
      (rich `error[ALP-B*]` blocks + legacy `FAIL`/`WARN` + `hint:`, hand-rolled,
      no `regex` dep) to `alp-core/validate.rs`.
  - `--offline` flag runs the structural validator only (no Python/SDK); the
    existing offline fixtures pin TS↔Rust offline parity via `--offline`.
  - **Contract: hermetic Python stubs.** `fixtures/validate-full/*` ship a fake
    `validate_board_yaml.py` (canned stderr + exit) so the spawn→classify→parse→
    envelope path is exercised deterministically (python3 only, no PyYAML/SDK).
    `run.sh` runs them Rust-only and normalizes absolute path prefixes so
    goldens are machine-independent.
- [x] Offline batch (1/2): `completion`, `diff`, `presets`.
  - `completion` — bash/zsh/fish scripts embedded verbatim via `include_str!`
    (captured byte-for-byte from the TS CLI; `--shell`, invalid → exit 1).
  - `diff` — parse vs `normalize_board_model`, diffed as JSON trees in
    `alp-core/diff.rs` (`collect_diff_entries` + `prune_nulls` to match TS's
    sparse model); board-missing → exit 2.
  - `presets` — `empty_preset_catalogue` defaults in `alp-core/presets.rs` +
    SDK metadata discovery (`metadata/e1m_modules/*/som.yaml`,
    `metadata/carriers/*/board.yaml`); sdk-unresolved → warning, still exit 0.
  - All three verified byte-for-byte against the live TS CLI; golden fixtures
    added under `fixtures/{completion,diff,presets}` via a generic, path-
    normalized harness loop. Shared `util::resolve_cli_project_context` now
    backs validate/diff/presets/doctor.
- [x] Offline batch (2/2): `explain`. Ported the generation-target catalog to
      `alp-core/loader.rs` (`list_generation_target_support`); explain reads it
      plus the wizard project/module templates. Overview / project-template /
      module-template / generation-target selectors; both selectors → exit 1
      (ambiguous), unknown id → exit 1. Verified byte-for-byte vs the live TS
      CLI across all 18 selector/error cases; 6 golden fixtures added.
  - **Fixed a latent Phase-4 divergence:** the Rust wizard had rewritten the
    template `label`s (Title Case) and `description`s, and module templates
    lacked `description`. Realigned all 6 project + 4 module
    labels/descriptions to the TS source and added `ModuleTemplateDefinition.description`
    (display-only fields; file generation unaffected, all wizard tests still pass).
- [x] Debug-domain (read-only): `inspect`, `trace`. Ported `collect_resolved_values`
      + `DebugResolvedValue`/`DebugValueSource` (+ `west_cwd` on the debug context)
      and `create_loader_plan` + `ALL_EMIT_MODES` + `DebugGenerationTraceDecision`
      to `alp-core`. `inspect` lists resolved context values (`--path` filter,
      `--show-origin`, board-missing/path-not-found warnings); `trace` reports
      per-target planned loader decisions (sdk/board guards → exit 2, unknown
      `--target` → exit 5). Shared `util::generated_at_iso` (SOURCE_DATE_EPOCH).
      Verified byte-for-byte vs the live TS CLI across 10 cases; 8 golden fixtures.
- [x] `debugConfig` (`debug-config`). Ported the launch-profile machinery to
      `alp-core/debug_launch.rs` (`create_launch_draft` per target/server +
      `create_launch_json_write_plan` merge). `--preview` prints the draft;
      otherwise it merges into `<workspace>/.vscode/launch.json` (replace by
      name). Invalid kind / unsupported backend → exit 5, write failure → exit 3.
      Enabled serde_json `preserve_order` so emitted JSON keeps JS key order.
      Verified byte-for-byte vs the live TS CLI: 9 preview envelopes + 6 written
      launch.json shapes + merge/replaced. 5 golden fixtures (preview + errors).
- [x] `supportBundle` (`support-bundle`). Assembles an inspect report + generation
      trace + doctor report into one JSON bundle written under `.alp-support`
      (or `--destination`); the envelope carries the written path + decision
      count, and the exit code follows the doctor summary (fail > 0 → exit 4,
      unsupported backend → exit 4, bad kind/target → exit 5). Added `Serialize`
      (camelCase, `codeLLDB`) to the debug context so the bundle file matches TS.
      Verified byte-for-byte vs the live TS CLI: success envelope + full bundle
      file + 3 error paths. 3 golden fixtures (deterministic, no-write paths);
      success-path issues are doctor-derived (machine-dependent), so — like
      `doctor` — that path is verified directly, not golden-fixtured.
- [x] `sdk` (`list`/`install`/`current`/`switch`) — the last command. Ported the
      IO-free parts (release-payload parse, `check_sdk_readiness`,
      `resolve_active_sdk`) to `alp-core/sdk.rs`; the CLI does `list` over HTTP
      (`ureq`, the one new dependency), `install` via `git clone --branch`,
      and `current`/`switch` over the `.alp/sdk-path` pointer. Verified
      byte-for-byte vs the live TS CLI: the offline subcommands + switch/current
      success; 5 deterministic golden fixtures (the network paths `list`/
      `install` aren't fixtured — non-deterministic/network, like `doctor`).

**Phase 5 complete — all 14 commands ported.** Contract harness covers every
deterministic command path (TS-offline parity + Rust goldens); machine-/network-
dependent paths (`doctor`, `support-bundle` success, `sdk list/install`) are
verified directly against the live TS CLI and unit-tested. Next: Phase 6
(distribution) + Phase 7 (cutover).

## Phase 6 — Distribution  ✅ DONE
Hand-rolled release pipeline (chose in-repo + reviewable over `dist`, which can't
be generated in this environment without running the tool).
- [x] `.github/workflows/release-cli-rs.yml`: on `cli-rs-v*` tags, build `alp`
      for four targets (x86_64/aarch64 macOS, x86_64 linux-gnu, x86_64 windows-msvc)
      on native runners, archive each as `alp-<target>.tar.gz`, and attach to the
      GitHub release. Distinct `cli-rs-v*` tag namespace (legacy TS CLI uses `cli-v*`).
- [x] npm shim `cli-rs/npm-shim` (package **`alp-sdk`**, bin `alp`): `postinstall.js`
      maps platform/arch → target, downloads the matching archive from the
      `cli-rs-v<version>` release (Node `fetch` + system `tar`, no deps), and
      `bin/alp.js` forwards argv to the native binary. Keeps `npm i -g alp-sdk`
      working. Launcher verified locally (forwards args + exit codes); downloaded
      `binary/` is gitignored.
- [x] `cli-rs/**` already in `.vscodeignore` — the Rust CLI + shim are excluded
      from the VSIX.
- Release flow: bump `cli-rs/Cargo.toml` + `cli-rs/npm-shim/package.json` to the
  same version, tag `cli-rs-v<version>`, push (builds + attaches archives), then
  `npm publish` the shim. Publishing the shim as `alp-sdk` is held until Phase 7
  cutover (it would replace the legacy TS package of the same name).

## Phase 7 — Cutover
Pre-release prep (safe now — no cli-rs release published yet):
- [x] Contract harness is a release gate — `RELEASE_GATES.md` §1.6 (already wired
      as the `rust_cli_contract` CI job).
- [x] Migration notes added to `CLI.md` (single contract for both impls) and
      `GETTING_STARTED_CLI.md` (build-from-source instructions for the native
      binary); `RELEASE_GATES.md` §5 documents the `cli-rs-v*` channel.

Gated on the first real `cli-rs-v<version>` release (would break users if done early):
- [ ] Flip the published `alp-sdk` npm package to `cli-rs/npm-shim`; npm-publish it.
- [ ] Flip install instructions (`npm i -g alp-sdk` → native binary) once published.
- [ ] Deprecate/retire the TS CLI entrypoint (`packages/alp-cli`); keep `alp-core`
      (TS) for the VS Code extension + LSP.

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
    ├── alp-core/   # domain logic, zero IO/clap; fixture- + unit-tested
    │   └── src/{lib,model,validate,preview,sdk_catalogue,project,debug,clock}.rs + wizard/
    └── alp-cli/    # bin "alp"; clap + envelope + IO
        └── src/{main,cli,exit,envelope}.rs + commands/{validate,generate,init,scaffold,doctor}.rs
```

## Build / test
```sh
cd cli-rs
cargo build              # debug
cargo test               # unit + (later) contract
cargo build --release    # optimized, stripped, panic=abort
target/debug/alp validate --board-yaml <path> --format json
```
