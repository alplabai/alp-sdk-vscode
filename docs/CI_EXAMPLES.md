# tan CLI CI Integration Examples

Last revised: 2026-08-10

This document provides copy-paste examples for running the `tan` CLI in CI.

## 1. CI Baseline

Use the same baseline flow in every CI system:

1. Install the `tan` CLI (download the release archive from
   [`alplabai/tan-cli`](https://github.com/alplabai/tan-cli), pinned to an
   exact release tag; or point at a local build). `tan-cli` publishes a
   PyInstaller onedir archive per target (`.tar.gz` for Linux/macOS, `.zip`
   for Windows) — raw per-target binaries were retired at v0.5.0
   (tan-cli#349) — so unpack it into a directory and put that directory on
   `PATH` (or symlink the launcher); the launcher already ships executable
   and needs its `_internal/` sibling next to it.
2. Run CLI commands with --format json.
3. Upload generated JSON reports as build artifacts.

Recommended command sequence:

```bash
TAN_VERSION=v0.5.1
curl -fL --retry 3 -o tan.tar.gz \
  "https://github.com/alplabai/tan-cli/releases/download/${TAN_VERSION}/tan-x86_64-unknown-linux-gnu.tar.gz"
tar -xzf tan.tar.gz -C /usr/local/lib   # -> /usr/local/lib/tan/{tan,_internal/}
ln -s /usr/local/lib/tan/tan /usr/local/bin/tan
tan validate --project . --sdk-root "$ALP_SDK_ROOT" --format json > validate-report.json
tan generate --project . --sdk-root "$ALP_SDK_ROOT" --all --format json > generate-report.json
tan doctor --project . --sdk-root "$ALP_SDK_ROOT" --target-kind native-host --server none --format json > doctor-report.json
```

## 2. GitHub Actions Example

```yaml
name: tan-cli-ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  validate-generate:
    runs-on: ubuntu-latest
    env:
      ALP_SDK_ROOT: ${{ github.workspace }}/alp-sdk-upstream
      TAN_VERSION: v0.5.1
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Install the tan CLI
        run: |
          curl -fL --retry 3 -o tan.tar.gz \
            "https://github.com/alplabai/tan-cli/releases/download/${TAN_VERSION}/tan-x86_64-unknown-linux-gnu.tar.gz"
          tar -xzf tan.tar.gz -C /usr/local/lib   # -> /usr/local/lib/tan/{tan,_internal/}
          ln -s /usr/local/lib/tan/tan /usr/local/bin/tan

      - name: Validate board config
        run: |
          tan validate \
            --project . \
            --sdk-root "$ALP_SDK_ROOT" \
            --format json > validate-report.json

      - name: Generate all outputs
        run: |
          tan generate \
            --project . \
            --sdk-root "$ALP_SDK_ROOT" \
            --all \
            --format json > generate-report.json

      - name: Run doctor preflight
        run: |
          tan doctor \
            --project . \
            --sdk-root "$ALP_SDK_ROOT" \
            --target-kind native-host \
            --server none \
            --format json > doctor-report.json

      - name: Upload reports
        uses: actions/upload-artifact@v4
        with:
          name: tan-cli-reports
          path: |
            validate-report.json
            generate-report.json
            doctor-report.json
```

## 3. GitLab CI Example

```yaml
stages:
  - verify

tan_cli_verify:
  stage: verify
  # node:20, not ubuntu:24.04: the job image needs git (for the runner's own
  # clone step, before `script:` runs) + curl/ca-certificates (for the
  # download below) preinstalled — a bare ubuntu image ships neither.
  image: node:20
  variables:
    ALP_SDK_ROOT: "$CI_PROJECT_DIR/alp-sdk-upstream"
    TAN_VERSION: "v0.5.1"
  script:
    - curl -fL --retry 3 -o tan.tar.gz "https://github.com/alplabai/tan-cli/releases/download/${TAN_VERSION}/tan-x86_64-unknown-linux-gnu.tar.gz"
    - tar -xzf tan.tar.gz -C /usr/local/lib   # -> /usr/local/lib/tan/{tan,_internal/}
    - ln -s /usr/local/lib/tan/tan /usr/local/bin/tan
    - tan validate --project . --sdk-root "$ALP_SDK_ROOT" --format json > validate-report.json
    - tan generate --project . --sdk-root "$ALP_SDK_ROOT" --all --format json > generate-report.json
    - tan doctor --project . --sdk-root "$ALP_SDK_ROOT" --target-kind native-host --server none --format json > doctor-report.json
  artifacts:
    when: always
    paths:
      - validate-report.json
      - generate-report.json
      - doctor-report.json
```

## 4. Notes

- CLI exit codes are CI-safe. Any non-zero exit code fails the job.
- JSON mode writes one envelope per command to stdout.
- Keep ALP_SDK_ROOT explicit in CI to avoid path ambiguity.
