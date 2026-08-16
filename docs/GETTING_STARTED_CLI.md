# Getting Started (CLI)

Last revised: 2026-07-20

This guide covers the terminal-first `tan` CLI workflow. Two usage modes are
supported: **standalone install** (download the prebuilt binary, recommended for
end users and CI) and **development from source** (build from a `tan-cli`
checkout).

> **Note.** The build CLI is the standalone native Rust binary `tan`, published
> from [`alplabai/tan-cli`](https://github.com/alplabai/tan-cli); the former
> in-repo `alp` (`cli-rs`) binary and the retired TypeScript CLI are gone. The
> `tan` command and its flags/output honor the envelope contract in
> [`CLI.md`](CLI.md). To run the binary from source instead, build it:
> `cargo build --release` in a `tan-cli` checkout → `tan-cli/target/release/tan`.

## 0. Standalone Install

`tan-cli` publishes a **raw, uncompressed binary per target** as a GitHub release
asset (no `.zip` / `.tar.gz`). Download the one for your host from the
[tan-cli releases](https://github.com/alplabai/tan-cli/releases), put it on your
`PATH`, and (on Unix) mark it executable:

```bash
# Pick the asset for your host target (tag v<version>):
#   tan-x86_64-unknown-linux-musl      (Linux x64, static)
#   tan-aarch64-unknown-linux-musl     (Linux arm64, static)
#   tan-x86_64-apple-darwin            (macOS Intel)
#   tan-aarch64-apple-darwin           (macOS Apple silicon)
#   tan-x86_64-pc-windows-msvc.exe     (Windows x64)
#   tan-aarch64-pc-windows-msvc.exe    (Windows arm64)
curl -L -o /usr/local/bin/tan \
  https://github.com/alplabai/tan-cli/releases/download/v0.3.0/tan-x86_64-unknown-linux-musl
chmod +x /usr/local/bin/tan
tan --help
```

For CI environments, pin to an exact release tag (`v<version>`) to ensure
reproducibility. The VS Code extension provisions the same binary automatically
(see [GETTING_STARTED_VSCODE.md](GETTING_STARTED_VSCODE.md)); this guide is for
terminal/CI use where you manage `tan` yourself.

The `tan` command below is the native Rust binary. For development from source,
substitute `tan-cli/target/release/tan`.

## 1. Prerequisites

- Project folder with board.yaml
- ALP SDK root containing scripts/alp_project.py
- For development from source: Rust toolchain (the binary is built from a
  `tan-cli` checkout)

## 2. Build CLI Artifacts (development from source)

```bash
cargo build --release   # run in a tan-cli checkout -> tan-cli/target/release/tan
```

## 3. Validate Project Config

```bash
tan validate --project . --sdk-root ../alp-sdk
```

CI-friendly variant:

```bash
tan validate --project . --sdk-root ../alp-sdk --format json > validate-report.json
```

Development from source:

```bash
tan-cli/target/release/tan validate --project . --sdk-root ../alp-sdk
```

## 4. Generate Derived Outputs

```bash
tan generate --project . --sdk-root ../alp-sdk --all
```

Single target example:

```bash
tan generate --project . --sdk-root ../alp-sdk --target zephyr-conf
```

## 5. Project Bootstrap and Scaffolding

Initialize a starter project:

```bash
tan init --template minimal-app --name demo-app --destination . --preview
```

Scaffold module files:

```bash
tan scaffold --template sensor-driver --name sensor_mod --destination . --preview
```

## 6. Explain, Presets, Diff, Doctor

```bash
tan explain --format json
tan presets --project . --sdk-root ../alp-sdk --format json
tan diff --project . --format json
tan doctor --project . --sdk-root ../alp-sdk --target-kind native-host --server none --format json
```

## 7. Debug Workflows: Inspect, Trace, Support Bundle

Inspect resolved values and their origins:

```bash
tan inspect --project . --sdk-root ../alp-sdk --path workspaceRoot --show-origin --format json
```

Trace generation decisions for one output target:

```bash
tan trace --project . --sdk-root ../alp-sdk --target zephyr-conf --path sdkRoot --format json
```

Export a support bundle for issue triage:

```bash
tan support-bundle --project . --sdk-root ../alp-sdk --destination ./.alp-support --target-kind native-host --server none --format json
```

## 8. Completion Scripts

Generate completion script for your shell:

```bash
tan completion --shell bash
tan completion --shell zsh
tan completion --shell fish
```

## 9. Model Workflows: Check, Zoo, Add, Prep, Run, A/B

`tan model <cmd>` mirrors the alp-sdk `alp model` surface as a thin envelope
wrapper (`{command,ok,exitCode,project,data,issues}`). Alongside the pre-existing
`build` / `list` / `info` / `doctor` subcommands (compile `board.yaml` `models:`
→ `.alpmodel`, list, decode, toolchains), the model lifecycle commands are below.

Static pre-flight fit/perf check — **offline, conservative**:

```bash
tan model check --board board.yaml
tan model check --board board.yaml --format json
tan model check --board board.yaml --exact          # real vela compile (Ethos-U only)
```

Runs OFFLINE with no toolchain. Per SoM-backend it reports an `npuCoverage` of
`full-eligible` | `partial` | `cpu-only` | `undetermined` at
`basis: "static-screen"`, a MAC-weighted UPPER bound
(`computeOnNpuPctMax`), the operators that are certain CPU fallback, and every
caveat as prose in `notes`.

Read a static screen as ELIGIBILITY, never a guarantee: an eligible operator
still carries quantization, shape and dtype constraints the screen cannot
check, and the model runs either way — an operator the NPU cannot take falls
back to the CPU silently rather than failing.

`undetermined` means NO DATA for that backend (no support table, or a source
format it does not ingest), not a finding that the model will not run.

`--exact` runs the real `vela` for Ethos-U (`pip install
alp-tan[model-compile]`) and upgrades the report to `basis: "compiled"` with
the measured operator placement (`npuPlacementPctReal`). Only `basis:
"compiled"` or `basis: "bench"` may be read as proven.

Browse the curated model zoo (each entry marked whether it runs on your SoM):

```bash
tan model zoo --sku <SKU>
tan model zoo --board board.yaml --format json
```

Add a zoo entry to your `board.yaml` `models:`:

```bash
tan model add <zoo-id> --board board.yaml --name NAME --models-dir DIR
```

Fetches the source (URL sha256-verified, or bundled) and appends `{name, source}`
to `board.yaml` `models:`. Non-destructive — a duplicate name errors.

License-free INT8 quantize + fp32-vs-int8 accuracy report:

```bash
tan model prep <model.onnx|.tflite> --calibration <dir> --out OUT --per-channel --min-samples N
```

Produces an INT8 (onnxruntime QDQ) model plus an accuracy report (top1 agreement
%, mean cosine, max-abs-err, verdict `good` | `degraded` + guidance). A `.tflite`
input is converted to ONNX first via tf2onnx.

Host reference run / A-B compare — **NOT target-SoM performance**:

```bash
tan model run <model.onnx> --input FILE.npy --expected LABEL --runs N
tan model ab <a.onnx> <b.onnx> --input FILE.npy --runs N
```

`run` executes on the HOST (backend `cpu-host`): functional + host-latency +
accuracy. `ab` compares two models on the same input for latency + size delta.
Both are host REFERENCE runs, not the target SoM's performance —
`peak_sram_kib` / `power_mj` are null on host (on-device values are HW-gated).

## 10. Exit Codes

- 0: success
- 1: runtime/command failure
- 2: validation/config failure
- 3: generation/scaffold write failure
- 4: doctor/preflight failure
- 5: internal failure

## 11. CI Pipeline Examples

For complete GitHub Actions and GitLab CI examples, see CI_EXAMPLES.md.
