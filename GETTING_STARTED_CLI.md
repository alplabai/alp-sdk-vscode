# Getting Started (CLI)

Last revised: 2026-05-14

This guide covers the terminal-first ALP CLI workflow for local development and CI.

## 1. Prerequisites

- Node.js 20+
- Compiled CLI entrypoint at out/cli/main.js
- Project folder with board.yaml
- ALP SDK root containing scripts/alp_project.py

## 2. Build CLI Artifacts

```bash
npm ci
npm run compile
```

## 3. Validate Project Config

```bash
node ./out/cli/main.js validate --project . --sdk-root ../alp-sdk
```

CI-friendly variant:

```bash
node ./out/cli/main.js validate --project . --sdk-root ../alp-sdk --format json > validate-report.json
```

## 4. Generate Derived Outputs

```bash
node ./out/cli/main.js generate --project . --sdk-root ../alp-sdk --all
```

Single target example:

```bash
node ./out/cli/main.js generate --project . --sdk-root ../alp-sdk --target zephyr-conf
```

## 5. Project Bootstrap and Scaffolding

Initialize a starter project:

```bash
node ./out/cli/main.js init --template minimal-app --name demo-app --destination . --preview
```

Scaffold module files:

```bash
node ./out/cli/main.js scaffold --template sensor-driver --name sensor_mod --destination . --preview
```

## 6. Explain, Presets, Diff, Doctor

```bash
node ./out/cli/main.js explain --format json
node ./out/cli/main.js presets --project . --sdk-root ../alp-sdk --format json
node ./out/cli/main.js diff --project . --format json
node ./out/cli/main.js doctor --project . --sdk-root ../alp-sdk --target-kind native-host --server none --format json
```

## 7. Debug Workflows: Inspect, Trace, Support Bundle

Inspect resolved values and their origins:

```bash
node ./out/cli/main.js inspect --project . --sdk-root ../alp-sdk --path workspaceRoot --show-origin --format json
```

Trace generation decisions for one output target:

```bash
node ./out/cli/main.js trace --project . --sdk-root ../alp-sdk --target zephyr-conf --path sdkRoot --format json
```

Export a support bundle for issue triage:

```bash
node ./out/cli/main.js support-bundle --project . --sdk-root ../alp-sdk --destination ./.alp-support --target-kind native-host --server none --format json
```

## 8. Completion Scripts

Generate completion script for your shell:

```bash
node ./out/cli/main.js completion --shell bash
node ./out/cli/main.js completion --shell zsh
node ./out/cli/main.js completion --shell fish
```

## 9. Exit Codes

- 0: success
- 1: runtime/command failure
- 2: validation/config failure
- 3: generation/scaffold write failure
- 4: doctor/preflight failure
- 5: internal failure

## 10. CI Pipeline Examples

For complete GitHub Actions and GitLab CI examples, see CI_EXAMPLES.md.
