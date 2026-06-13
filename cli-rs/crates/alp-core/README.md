<!-- SPDX-License-Identifier: Apache-2.0 -->

# alp-core

[![crates.io](https://img.shields.io/crates/v/alp-core.svg)](https://crates.io/crates/alp-core)
[![docs.rs](https://img.shields.io/docsrs/alp-core)](https://docs.rs/alp-core)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/alplabai/alp-sdk-vscode/blob/main/LICENSE)

Pure, **I/O-free** domain logic for the [ALP SDK](https://github.com/alplabai/alp-sdk-vscode)
embedded toolchain — the shared engine behind the
[`alp`](https://crates.io/crates/alp-cli) CLI.

This crate is the Rust home of the `board.yaml` model, parsing, and validation, plus the
build-plan / system-manifest contracts, the SoM/SKU catalogue, and the debug/doctor
reports. It contains **no** terminal, filesystem-walking, or process logic — only
deterministic, serde-based transforms — so the same logic can be reused by the CLI today
and bridged to the TypeScript extension/LSP (via napi-rs or WASM) later.

## What's inside

| Module | Responsibility |
| --- | --- |
| `model` | The `board.yaml` data model + `normalize_board_model`. |
| `validate` | Schema + semantic validation; outcome classification. |
| `loader` | Generation-target planning (Zephyr conf / DTS overlay / CMake args / Yocto conf). |
| `build_plan` | Parse + summarize the SDK's build-plan contract. |
| `system_manifest` | The post-build system-manifest v1 contract (per-core slices, ipc, helper MCUs). |
| `build_readiness` | Per-OS build-toolchain readiness reports. |
| `presets`, `sdk_catalogue` | SoM/SKU catalogue, chip/board presets, topology. |
| `project` | Workspace / project / `board.yaml` resolution. |
| `sdk` | SDK release listing + active-SDK resolution + readiness. |
| `debug`, `debug_launch` | Debug-doctor reports + `launch.json` drafting. |
| `diff`, `preview` | Model-vs-normalized diff; effective-config preview. |
| `wizard` | Project / module scaffolding plans. |
| `clock` | Deterministic ISO-8601 UTC timestamps (`SOURCE_DATE_EPOCH`-aware). |

## Usage

```toml
[dependencies]
alp-core = "0.1"
```

The full API reference is on [docs.rs/alp-core](https://docs.rs/alp-core).

> **Stability.** `alp-core` is published primarily as the implementation crate for the
> `alp` CLI. It is pre-1.0 — the public API may change between minor versions. If you
> depend on it directly, pin a minor range.

## License

[Apache-2.0](https://github.com/alplabai/alp-sdk-vscode/blob/main/LICENSE).
