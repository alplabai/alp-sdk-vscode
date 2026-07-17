<!-- SPDX-License-Identifier: Apache-2.0 -->

# `alp` — the ALP SDK command-line tool

[![crates.io](https://img.shields.io/crates/v/alp-cli.svg?label=crates.io%2Falp-cli)](https://crates.io/crates/alp-cli)
[![npm](https://img.shields.io/npm/v/@alplabai/alp-cli.svg?label=npm%2F%40alplabai%2Falp-cli)](https://www.npmjs.com/package/@alplabai/alp-cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../LICENSE)

`alp` is the native CLI for **ALP SDK** embedded projects — a single, dependency-free
Rust binary for schema-aware `board.yaml` editing, code generation (Zephyr conf / DTS
overlay / CMake args / Yocto conf), per-OS toolchain bootstrap, and heterogeneous
`build` / `flash` orchestration across Alif, Renesas, and NXP targets on Zephyr, Yocto,
and baremetal.

It is the same engine the [ALP SDK VS Code extension](https://github.com/alplabai/alp-sdk-vscode)
runs under the hood, exposed for the terminal and CI. Every machine-readable command
emits a **stable JSON envelope** with a fixed exit-code matrix, so it scripts cleanly.

> This directory (`cli-rs/`) is the binary's Cargo workspace. It is **not** bundled in
> the VS Code extension's VSIX — it ships independently via the channels below.

## Install

Pick whichever matches your toolchain — all install the same `alp` binary at version
`0.1.6`.

### npm (no Rust toolchain needed)

```bash
npm install -g @alplabai/alp-cli
```

A thin shim: its `postinstall` downloads the prebuilt binary for your platform from the
matching GitHub release and exposes it as `alp`. No runtime Node dependency. See
[`npm-shim/README.md`](npm-shim/README.md).

### cargo

```bash
cargo install alp-cli            # compile from crates.io
cargo binstall alp-cli           # or fetch the prebuilt archive (no compile)
```

`cargo binstall` reads the binstall metadata in the crate and pulls the same
`alp-<target>.tar.gz` archive `cargo install` would otherwise build. The library crate
[`alp-core`](https://crates.io/crates/alp-core) (pure domain logic, no I/O) is published
alongside it.

### Prebuilt archive (manual)

Download `alp-<target>.tar.gz` from the
[latest `cli-rs-v*` release](https://github.com/alplabai/alp-sdk-vscode/releases?q=cli-rs-v),
extract, and put `alp` on your `PATH`.

### From source

```bash
cargo build --release --manifest-path cli-rs/Cargo.toml
# binary at cli-rs/target/release/alp
```

This is the path for any platform without a prebuilt archive — notably **Intel macOS**
(`x86_64-apple-darwin`), which is intentionally not prebuilt (see [Platforms](#platforms)).

## Quick start

```bash
# Scaffold a project for a specific module
alp init --template sensor-starter --som E1M-AEN801 --name my-board

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

`alp` resolves the active project from the current directory (override with
`--project <path>` or `--board-yaml <path>`). Run `alp <command> --help` for the full,
authoritative flag list.

### Project & schema

| Command | What it does |
| --- | --- |
| `alp validate` | Validate schema + semantic rules for the active `board.yaml`. `--offline` runs the structural validator only (no Python SDK spawn). Never writes. |
| `alp generate` | Generate build artifacts from `board.yaml`. Select emits with `--target <emit>` (`zephyr-conf`, `dts-overlay`, `cmake-args`, `yocto-conf`) or `--all`. |
| `alp init` | Scaffold a new project from a template. `--template <id>`, `--name`, `--destination`, `--som <sku>`, `--cores id[:os],…` (heterogeneous multi-core board.yaml with RPMsg IPC), `--preview`, `--force`. |
| `alp scaffold` | Add a module to an existing project. `--template <id>`, `--name` (required), `--destination`, `--preview`, `--force`. |
| `alp diff` | Show how `board.yaml` normalization changes the effective config. |
| `alp presets` | List SDK presets — SKUs/SoMs (with `cores` topology) and built-in catalogue defaults. |
| `alp explain` | Explain a project/module template (`--template <id>`) or a generation target. |

### Build & flash orchestration

These wrap the SDK's `west alp-*` driver (which owns the per-core Zephyr / Yocto /
baremetal dispatch). Trailing args after the command are forwarded verbatim — e.g.
`--core <id>`, `--sequential`, `-b <board>`.

| Command | What it does |
| --- | --- |
| `alp bootstrap` | Set up the SDK build environment (west install + `west init/update` + Zephyr Python deps). `--no-pip`, `--no-west`, `--print-env`. |
| `alp build` | Build the project (`west alp-build`), fanning `board.yaml` into per-core slices. Plan/manifest inspection without building: `--plan` / `--plan-from <file>`, `--manifest` / `--manifest-from <file>`; `--materialise` / `--native` to write or run the plan locally. |
| `alp image` | Assemble a flashable image (`west alp-image`). |
| `alp flash` | Flash the assembled image to the device (`west alp-flash`). |
| `alp clean` | Remove build dirs + orchestrator cache (`west alp-clean`). |
| `alp renode` | Boot the system manifest in Renode (`west alp-renode`). |

### Environment & SDK

| Command | What it does |
| --- | --- |
| `alp doctor` | Diagnose debug readiness for a `--target-kind`/`--server` pair. `--build` runs the build-readiness preflight instead (host toolchains per backend; includes the Yocto `bmaptool`/`dd` flash check). |
| `alp sdk list` | List available + installed SDK releases. |
| `alp sdk install <version>` | Install an SDK release into `~/.alp/sdk/<version>` (`--destination` to override). |
| `alp sdk current` | Show the active SDK install and its readiness. |
| `alp sdk switch <version\|path>` | Switch the active SDK to an installed version or path. |

### Inspection & debug

| Command | What it does |
| --- | --- |
| `alp inspect` | Inspect resolved project/debug context values. `--path <key>`, `--show-origin`. |
| `alp trace` | Trace the generation decisions a build would make. `--path <key>`. |
| `alp debug-config` | Generate or `--preview` a VS Code `launch.json` debug configuration for a `--target-kind`/`--server` pair. |
| `alp support-bundle` | Export a diagnostic bundle (inspect + trace + doctor) to `--destination` (default `<workspace>/.alp-support`). |

### Shell

| Command | What it does |
| --- | --- |
| `alp completion` | Emit a shell completion script. `--shell bash\|zsh\|fish` (default `bash`). |

### Global flags

| Flag | Meaning |
| --- | --- |
| `--project <path>` | Project root (default: current directory). |
| `--board-yaml <path>` | Explicit `board.yaml` path (overrides project resolution). |
| `--sdk-root <path>` | `alp-sdk` checkout root. |
| `--target <emit>` / `--all` | Generation target selection (for `generate`). |
| `--format text\|json` | Output format (default `text`). |
| `--verbose` / `--quiet` | Verbosity. |
| `--no-color` | Disable colored output. |
| `--non-interactive` | Disable interactive prompts. |
| `--ci` | CI mode: implies `--non-interactive` and disables color. |

## Output contract

With `--format json`, every command writes a single JSON envelope to stdout (logs and
progress go to stderr). The shape and exit codes are **byte-for-byte stable**, gated by
the [`cli-rs/contract`](contract/run.sh) harness.

```json
{
  "command": "validate",
  "ok": false,
  "exitCode": 2,
  "project": {
    "root": "/home/user/my-board",
    "boardYaml": "/home/user/my-board/board.yaml"
  },
  "data": {
    "valid": false,
    "generatedAt": "2026-06-13T12:00:00Z"
  },
  "issues": [
    {
      "code": "schema/required",
      "severity": "error",
      "message": "missing required property 'soc'"
    }
  ]
}
```

- `command` — the command that produced the envelope.
- `ok` — `true` only when `exitCode == 0`.
- `exitCode` — matches the process exit code (table below).
- `project` — resolved `{ root, boardYaml }` (either may be `null`).
- `data` — command-specific payload.
- `issues` — diagnostics, each `{ code, severity, message }`; empty when there are none.

### Exit codes

| Code | Name | Meaning |
| --- | --- | --- |
| `0` | success | Command succeeded (the only code with `ok: true`). |
| `1` | runtime | Generic runtime failure. |
| `2` | validation | Validation failed (e.g. `board.yaml` schema errors). |
| `3` | write | Failed to write output/files. |
| `4` | doctor | Doctor / environment check failed. |
| `5` | internal | Internal / unexpected error. |

**Reproducible timestamps.** Command payloads that carry a `generatedAt` honor
`SOURCE_DATE_EPOCH`: set it to a fixed epoch-second value and the timestamp is pinned to
that instant (zero milliseconds), so JSON output is deterministic in tests and CI.
Unset, it uses the wall clock.

## Platforms

Prebuilt archives are attached to each `cli-rs-v*` release:

| Target triple | Platform |
| --- | --- |
| `x86_64-unknown-linux-gnu` | Linux x64 |
| `aarch64-apple-darwin` | macOS (Apple Silicon / arm64) |
| `x86_64-pc-windows-msvc` | Windows x64 |

Any other platform — including **Intel macOS** (`x86_64-apple-darwin`), Linux/Windows
arm64 — has no prebuilt archive (GitHub's Intel-mac runners stall the release) and is
served by `cargo install` / a [from-source](#from-source) build.

## Relationship to the VS Code extension

The extension locates this binary via the `alpSdk.cliPath` setting → `PATH` →
download-on-demand, and invokes it for bootstrap/build (terminal) and
validate/generate/sdk-list (JSON envelope). Host-coupled commands (live debug readiness,
the in-process configurator/LSP) stay inside the extension. See
[`docs/EXTENSION_CLI_INTEGRATION.md`](../docs/EXTENSION_CLI_INTEGRATION.md).

## Develop

```bash
cargo build  --manifest-path cli-rs/Cargo.toml
cargo test   --manifest-path cli-rs/Cargo.toml
cargo clippy --manifest-path cli-rs/Cargo.toml --all-targets
bash cli-rs/contract/run.sh          # envelope conformance vs golden fixtures; --bless to update
```

The workspace is split `alp-core` (pure domain logic — no `vscode`/`fs`/process I/O,
deterministic in/out) ← `alp-cli` (the binary + I/O seams), mirroring the same
pure/adapter discipline as the extension host.

## Releasing

Two independent tag families (see [`cli-rs/CHANGELOG.md`](CHANGELOG.md) for history):

1. Bump the workspace version in `cli-rs/Cargo.toml` **and** `cli-rs/npm-shim/package.json`
   (and `SUPPORTED_CLI_VERSION` in the extension) to the same value; refresh `Cargo.lock`.
2. Tag **`cli-rs-v<version>`** and push → builds + attaches the three archives to the
   GitHub release, then publishes `alp-core` then `alp-cli` to crates.io.
3. Tag **`cli-v<version>`** and push → publishes the `@alplabai/alp-cli` npm shim.

Push `cli-rs-v…` **first** — the npm shim's postinstall downloads the binary from that
release. Publish steps are secret-gated (`CARGO_REGISTRY_TOKEN`, `NPM_TOKEN`) and skip
(not fail) when a secret is absent.

## Docs

- [docs/CLI.md](../docs/CLI.md) — the command/output contract (single source of truth).
- [docs/GETTING_STARTED_CLI.md](../docs/GETTING_STARTED_CLI.md) — CLI-first workflow.
- [docs/CI_EXAMPLES.md](../docs/CI_EXAMPLES.md) — GitHub Actions / GitLab CI pipelines.
- [docs/BUILD_ORCHESTRATION.md](../docs/BUILD_ORCHESTRATION.md) — how `build`/`flash` consume the SDK's emitted plan.
- [docs/EXTENSION_CLI_INTEGRATION.md](../docs/EXTENSION_CLI_INTEGRATION.md) — extension ↔ CLI split.
- [cli-rs/CHANGELOG.md](CHANGELOG.md) · [cli-rs/PLAN.md](PLAN.md) — release notes & roadmap.

## License

[Apache-2.0](../LICENSE).
