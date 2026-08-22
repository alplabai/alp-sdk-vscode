# Task Recipes (GUI and CLI)

Last revised: 2026-07-25

This guide maps common tasks to both VS Code and CLI workflows.

## 1. Validate Configuration

VS Code:

- Alp: Validate board.yaml

CLI:

tan validate --project . --sdk-root ../alp-sdk

## 2. Generate All Derived Outputs

VS Code:

- Alp: Generate all

CLI:

tan generate --project . --sdk-root ../alp-sdk --all

## 3. Preview Effective Config

VS Code:

- Alp: Preview effective config (LSP)

CLI alternative:

- Use validate + explain + diff for non-interactive analysis

## 4. Initialize a New Starter Project

VS Code:

- Alp: New project wizard

CLI:

tan init --template minimal-app --name demo-app --destination . --preview

## 5. Scaffold a Module in Existing Project

VS Code:

- Alp: Scaffold module

CLI:

tan scaffold --template sensor-driver --name sensor_mod --destination . --preview

## 6. Run Debug/Environment Checks

VS Code:

- Alp: Debug doctor

CLI:

tan doctor --project . --sdk-root ../alp-sdk --format json

## 7. Setup Shell Completion

CLI:

tan completion --shell bash
tan completion --shell zsh
tan completion --shell fish

## 8. Pre-flight NPU Coverage Check

VS Code:

- Alp: Models panel — "Check NPU coverage", then a per-model badge per SoM backend (before build)

CLI:

tan model check --board board.yaml [--format text|json]
tan model check --board board.yaml --exact          # real vela compile (Ethos-U only)

Static NPU-eligibility screen, OFFLINE, no toolchain. Per SoM-backend
npuCoverage of full-eligible | partial | cpu-only | undetermined, at
basis: static-screen, plus a MAC-weighted UPPER bound (computeOnNpuPctMax)
and the operators that are certain CPU fallback.

Read it as eligibility, not a promise: an eligible operator still carries
quantization/shape/dtype constraints the screen cannot check, and the model
runs either way — an operator the NPU cannot take falls back to the CPU
silently rather than failing.

`undetermined` means NO DATA (no support table for that backend, or a source
format it does not ingest). It is not a finding that the model will not run.

`--exact` upgrades Ethos-U to basis: compiled by running the real `vela`
(`pip install alp-tan[model-compile]`), which reports the measured operator
placement (npuPlacementPctReal). Only basis: compiled or basis: bench may be
read as proven.

## 9. Quantize a Model to INT8

VS Code:

- Alp: Models panel — Prep Model (pick model + calibration folder -> quantize -> accuracy report)

CLI:

tan model prep <model.onnx|.tflite> --calibration <dir> [--out] [--per-channel] [--min-samples N]

LICENSE-FREE INT8 quantize (onnxruntime QDQ) plus an fp32-vs-int8 ACCURACY report
(top1 agreement %, mean cosine, max-abs-err, verdict good|degraded + guidance).
.tflite is converted to ONNX first via tf2onnx. Toolchain extras: model-prep
(onnxruntime/onnx/numpy/sympy); model-convert (tf2onnx/tensorflow-cpu) for
.tflite input.

## 10. Browse and Add Model-Zoo Entries

VS Code:

- Alp: Models panel — Model Zoo gallery (browse "runs on your SoM" + one-click Add)

CLI:

tan model zoo [--sku <SKU> | --board board.yaml] [--format]
tan model add <zoo-id> [--board board.yaml] [--name NAME] [--models-dir DIR]

zoo browses curated model-zoo entries (metadata/model_zoo/<id>.yaml), each marked
runs_here for the SoM (via validated_soms) — link+fetch+layer, no weight
redistribution. add fetches the source (URL sha256-verified, or bundled) and
appends {name,source} to board.yaml models:. Non-destructive (duplicate name
errors).

## 11. Host Reference Run and A/B Compare

VS Code:

- Alp: Models panel — Run Model / A-B Compare (host reference run)

CLI:

tan model run <model.onnx> [--input FILE.npy] [--expected LABEL] [--runs N]
tan model ab <a.onnx> <b.onnx> [--input] [--runs]

run is a HOST reference run (backend "cpu-host"): functional + host-latency +
accuracy. ab runs A/B two models on the same input (host reference): latency +
size delta. This is a reference, NOT the target SoM's performance —
peak_sram_kib/power_mj are null on host (on-device values are HW-gated).

## 12. CI Integration

See CI_EXAMPLES.md for full GitHub Actions and GitLab recipes.
