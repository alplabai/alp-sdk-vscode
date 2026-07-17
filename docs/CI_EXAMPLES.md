# ALP CLI CI Integration Examples

Last revised: 2026-05-14

This document provides copy-paste examples for running the ALP CLI in CI.

## 1. CI Baseline

Use the same baseline flow in every CI system:

1. Install the native `alp` CLI (`npm install -g @alplabai/alp-cli`, or download the release binary).
2. Run CLI commands with --format json.
3. Upload generated JSON reports as build artifacts.

Recommended command sequence:

```bash
npm install -g @alplabai/alp-cli
alp validate --project . --sdk-root "$ALP_SDK_ROOT" --format json > validate-report.json
alp generate --project . --sdk-root "$ALP_SDK_ROOT" --all --format json > generate-report.json
alp doctor --project . --sdk-root "$ALP_SDK_ROOT" --target-kind native-host --server none --format json > doctor-report.json
```

## 2. GitHub Actions Example

```yaml
name: alp-cli-ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  validate-generate:
    runs-on: ubuntu-latest
    env:
      ALP_SDK_ROOT: ${{ github.workspace }}/alp-sdk-upstream
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install the alp CLI
        run: npm install -g @alplabai/alp-cli

      - name: Validate board config
        run: |
          alp validate \
            --project . \
            --sdk-root "$ALP_SDK_ROOT" \
            --format json > validate-report.json

      - name: Generate all outputs
        run: |
          alp generate \
            --project . \
            --sdk-root "$ALP_SDK_ROOT" \
            --all \
            --format json > generate-report.json

      - name: Run doctor preflight
        run: |
          alp doctor \
            --project . \
            --sdk-root "$ALP_SDK_ROOT" \
            --target-kind native-host \
            --server none \
            --format json > doctor-report.json

      - name: Upload reports
        uses: actions/upload-artifact@v4
        with:
          name: alp-cli-reports
          path: |
            validate-report.json
            generate-report.json
            doctor-report.json
```

## 3. GitLab CI Example

```yaml
stages:
  - verify

alp_cli_verify:
  stage: verify
  image: node:20
  variables:
    ALP_SDK_ROOT: "$CI_PROJECT_DIR/alp-sdk-upstream"
  script:
    - npm install -g @alplabai/alp-cli
    - alp validate --project . --sdk-root "$ALP_SDK_ROOT" --format json > validate-report.json
    - alp generate --project . --sdk-root "$ALP_SDK_ROOT" --all --format json > generate-report.json
    - alp doctor --project . --sdk-root "$ALP_SDK_ROOT" --target-kind native-host --server none --format json > doctor-report.json
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
