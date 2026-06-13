<!-- SPDX-License-Identifier: Apache-2.0 -->

# alp-cli

[![crates.io](https://img.shields.io/crates/v/alp-cli.svg)](https://crates.io/crates/alp-cli)
[![npm](https://img.shields.io/npm/v/@alplabai/alp-cli.svg?label=npm%2F%40alplabai%2Falp-cli)](https://www.npmjs.com/package/@alplabai/alp-cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/alplabai/alp-sdk-vscode/blob/main/LICENSE)

The native **`alp`** command-line tool for [ALP SDK](https://github.com/alplabai/alp-sdk-vscode)
embedded projects — a single, dependency-free Rust binary for schema-aware `board.yaml`
editing, code generation (Zephyr conf / DTS overlay / CMake args / Yocto conf), per-OS
toolchain bootstrap, and heterogeneous `build` / `flash` orchestration across Alif,
Renesas, and NXP targets on Zephyr, Yocto, and baremetal.

This crate installs the **`alp`** binary. It is the same engine the
[ALP SDK VS Code extension](https://github.com/alplabai/alp-sdk-vscode) runs under the
hood, exposed for the terminal and CI. Every machine-readable command emits a stable JSON
envelope with a fixed exit-code matrix, so it scripts cleanly.

## Install

```bash
cargo install alp-cli            # compile from crates.io
cargo binstall alp-cli           # or fetch the prebuilt archive (no compile)
```

Without a Rust toolchain, install the npm shim instead (it downloads the matching
prebuilt binary):

```bash
npm install -g @alplabai/alp-cli
```

Prebuilt `alp-<target>.tar.gz` archives (Linux x64, macOS arm64, Windows x64) are also
attached to each
[`cli-rs-v*` release](https://github.com/alplabai/alp-sdk-vscode/releases?q=cli-rs-v).
Other platforms — including Intel macOS — build from source via `cargo install`.

## Quick start

```bash
# Scaffold a project for a specific module
alp init --template sensor-starter --som E1M-AEN701 --name my-board

# Validate board.yaml (schema + semantic rules; never writes)
alp validate

# Generate the Zephyr .conf for the active board.yaml
alp generate --target zephyr-conf

# Set up the SDK build environment, then build every core
alp bootstrap
alp build

# Machine-readable output for scripts / CI
alp validate --format json
```

## Commands

Run `alp <command> --help` for the authoritative flag list.

- **Project & schema** — `validate`, `generate`, `init`, `scaffold`, `diff`, `presets`, `explain`
- **Build & flash orchestration** — `bootstrap`, `build`, `image`, `flash`, `clean`, `renode` (thin wrappers over the SDK's `west alp-*` driver)
- **Environment & SDK** — `doctor` (`--build` for build-readiness), `sdk list|install|current|switch`
- **Inspection & debug** — `inspect`, `trace`, `debug-config`, `support-bundle`
- **Shell** — `completion` (bash/zsh/fish)

## Output contract

With `--format json`, every command writes a single JSON envelope to stdout (logs and
progress go to stderr). Shape and exit codes are byte-for-byte stable:

```json
{
  "command": "validate",
  "ok": false,
  "exitCode": 2,
  "project": { "root": "/path", "boardYaml": "/path/board.yaml" },
  "data": {},
  "issues": [{ "code": "schema/required", "severity": "error", "message": "…" }]
}
```

Exit codes: `0` success · `1` runtime · `2` validation · `3` write · `4` doctor · `5`
internal. `ok` is `true` only when `exitCode == 0`.

## Documentation

- [`cli-rs` README](https://github.com/alplabai/alp-sdk-vscode/tree/main/cli-rs) — full command reference, install channels, platform matrix.
- [docs/CLI.md](https://github.com/alplabai/alp-sdk-vscode/blob/main/docs/CLI.md) — the command/output contract (single source of truth).
- [docs/GETTING_STARTED_CLI.md](https://github.com/alplabai/alp-sdk-vscode/blob/main/docs/GETTING_STARTED_CLI.md) — CLI-first workflow.
- [CHANGELOG](https://github.com/alplabai/alp-sdk-vscode/blob/main/cli-rs/CHANGELOG.md) — release notes.

The shared, I/O-free domain logic lives in the [`alp-core`](https://crates.io/crates/alp-core) library crate.

## License

[Apache-2.0](https://github.com/alplabai/alp-sdk-vscode/blob/main/LICENSE).
