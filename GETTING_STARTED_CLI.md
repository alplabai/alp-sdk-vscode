# Getting Started (CLI)

Last revised: 2026-05-15

This guide covers the terminal-first ALP CLI workflow. Two usage modes are
supported: **standalone install** (npm, recommended for end users and CI) and
**development from source** (build from this repository).

> **Heads up (migration in progress).** The `alp-sdk` npm package currently ships
> the TypeScript CLI. A native Rust binary (`cli-rs/`) is feature-complete and
> will replace it at cutover — the `alp` command and its flags/output stay the
> same, so the workflow below is unchanged. To try the native binary today, build
> from source: `cargo build --release --manifest-path cli-rs/Cargo.toml` →
> `cli-rs/target/release/alp`.

## 0. Standalone Install

Install the `alp-sdk` npm package to get the `alp` command globally:

```bash
npm install -g alp-sdk
alp --help
```

Or use without installing via npx:

```bash
npx alp-sdk --help
```

For CI environments, pin to an exact version to ensure reproducibility:

```bash
npm install -g alp-sdk@0.3.0
```

For air-gapped or offline environments, download the tarball from the
[GitHub release artifacts](https://github.com/alplabai/alp-sdk-vscode/releases)
and install from the local file:

```bash
npm install -g ./alp-sdk-0.3.0.tgz
```

Once installed, replace `node ./packages/alp-cli/dist/cli/main.js` with `alp`
in all commands below.

## 1. Prerequisites

- Node.js 20+
- Project folder with board.yaml
- ALP SDK root containing scripts/alp_project.py
- For development from source: compiled CLI at `packages/alp-cli/dist/cli/main.js`

## 2. Build CLI Artifacts (development from source)

```bash
pnpm install
pnpm run compile
```

## 3. Validate Project Config

```bash
alp validate --project . --sdk-root ../alp-sdk
```

CI-friendly variant:

```bash
alp validate --project . --sdk-root ../alp-sdk --format json > validate-report.json
```

Development from source:

```bash
node ./packages/alp-cli/dist/cli/main.js validate --project . --sdk-root ../alp-sdk
```

## 4. Generate Derived Outputs

```bash
alp generate --project . --sdk-root ../alp-sdk --all
```

Single target example:

```bash
alp generate --project . --sdk-root ../alp-sdk --target zephyr-conf
```

## 5. Project Bootstrap and Scaffolding

Initialize a starter project:

```bash
alp init --template minimal-app --name demo-app --destination . --preview
```

Scaffold module files:

```bash
alp scaffold --template sensor-driver --name sensor_mod --destination . --preview
```

## 6. Explain, Presets, Diff, Doctor

```bash
alp explain --format json
alp presets --project . --sdk-root ../alp-sdk --format json
alp diff --project . --format json
alp doctor --project . --sdk-root ../alp-sdk --target-kind native-host --server none --format json
```

## 7. Debug Workflows: Inspect, Trace, Support Bundle

Inspect resolved values and their origins:

```bash
alp inspect --project . --sdk-root ../alp-sdk --path workspaceRoot --show-origin --format json
```

Trace generation decisions for one output target:

```bash
alp trace --project . --sdk-root ../alp-sdk --target zephyr-conf --path sdkRoot --format json
```

Export a support bundle for issue triage:

```bash
alp support-bundle --project . --sdk-root ../alp-sdk --destination ./.alp-support --target-kind native-host --server none --format json
```

## 8. Completion Scripts

Generate completion script for your shell:

```bash
alp completion --shell bash
alp completion --shell zsh
alp completion --shell fish
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
