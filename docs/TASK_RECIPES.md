# Task Recipes (GUI and CLI)

Last revised: 2026-08-23

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

## 8. Compile board.yaml Models

VS Code:

- Not available at this pin. `Alp: Models` and `Alp: Build Model` are still
  registered commands, but both carry `"when": "false"` in
  `contributes.menus.commandPalette` (#525), and the `alp-ide` Activity Bar
  container contributes exactly one view (`alp-ide.hub`, "Alp IDE"), so there is
  no Models panel to open. Restoring the surface is tracked by #524.

CLI:

tan model build --board board.yaml --sdk-root ../alp-sdk

`build` is the only subcommand `tan model` accepts in tan 0.6.0-rc1: it compiles
and packages the `models:` entries of board.yaml into `.alpmodel` packages. Its
whole option set is `--board`/`--board-yaml`, `--out` (default `build/models`),
`--metadata-root`, `--project`, `--sdk-root`, `--format` (`text|json`) and
`--help`.

## 9. Model Tooling That Does Not Exist at This Pin

The pinned tan 0.6.0-rc1 implements no `tan model` subcommand other than
`build`, so the four capabilities below have no command line to type today.
They are recorded here as intent: the CLI half of all four is tracked upstream
as tan-cli#674, and the VS Code half needs the Models panel back, which is #524.

- Pre-flight NPU coverage check — an offline, static per SoM-backend
  eligibility screen (`npuCoverage` of `full-eligible`, `partial`, `cpu-only`
  or `undetermined`), with an exact mode that runs the real `vela` compiler for
  Ethos-U backends.
- Quantize a model to INT8 — license-free ONNX QDQ quantization plus an
  fp32-vs-int8 accuracy report (top1 agreement, mean cosine, max-abs-err, and a
  `good` or `degraded` verdict).
- Browse and add model-zoo entries. What follows is the INTENT, not anything
  present in a shipped component — the vendored alp-sdk has no
  `metadata/model_zoo/` at all: curated `<id>.yaml` entries marked `runs_here`
  for the SoM, fetched sha256-verified and appended
  to board.yaml `models:` without redistributing weights.
- Host reference run and A/B compare — a host-backend (`cpu-host`) functional,
  latency and accuracy run and a two-model A/B on one input, which is a host
  reference and never the target SoM's performance.

## 10. CI Integration

See CI_EXAMPLES.md for full GitHub Actions and GitLab recipes.
