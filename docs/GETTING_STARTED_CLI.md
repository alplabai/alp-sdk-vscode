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
#   tan-x86_64-unknown-linux-gnu       (Linux x64)
#   tan-aarch64-unknown-linux-gnu      (Linux arm64)
#   tan-x86_64-apple-darwin            (macOS Intel)
#   tan-aarch64-apple-darwin           (macOS Apple silicon)
#   tan-x86_64-pc-windows-msvc.exe     (Windows x64)
#   tan-aarch64-pc-windows-msvc.exe    (Windows arm64)
curl -L -o /usr/local/bin/tan \
  https://github.com/alplabai/tan-cli/releases/download/v0.1.0/tan-x86_64-unknown-linux-gnu
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

## 9. Exit Codes

- 0: success
- 1: runtime/command failure
- 2: validation/config failure
- 3: generation/scaffold write failure
- 4: doctor/preflight failure
- 5: internal failure

## 10. CI Pipeline Examples

For complete GitHub Actions and GitLab CI examples, see CI_EXAMPLES.md.
