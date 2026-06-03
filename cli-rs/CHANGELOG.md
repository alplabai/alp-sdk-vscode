<!-- SPDX-License-Identifier: Apache-2.0 -->

# Changelog — native `alp` CLI (cli-rs)

All notable changes to the native Rust `alp` binary. This is the schema-first
rewrite of the legacy TypeScript CLI (`packages/alp-cli`); the JSON envelope and
exit codes are byte-for-byte compatible (gated by the contract harness).

The native CLI is versioned and tagged independently of the VS Code extension:
release tags are `cli-rs-v<version>`, and the npm shim (`alp-sdk`) carries the
same version.

## Unreleased

## 0.1.1

- **`alp init --som <sku>`** — scaffold a project whose `board.yaml` targets a
  specific SoM. The SKU is written verbatim into `som.sku` (default
  `E1M-AEN701` when omitted); it is not validated against the SDK catalogue
  here — `alp validate` owns that — so `init` stays SDK-free. Lets the VS Code
  New Project flow delegate scaffolding (template + hardware) entirely to the CLI.

- **Spinners for `sdk list` and `sdk install`.** The GitHub releases fetch and
  the SDK git-clone now show a steady braille spinner (drawn to stderr) so
  latency-bound work gives live feedback. Shown only in genuine interactive use
  (a TTY with none of `--format json` / `--quiet` / `--ci` / `--non-interactive`);
  hidden otherwise, so logs and the JSON envelope stay clean. `sdk install` now
  runs `git clone --quiet` with captured output (surfacing git's stderr only on
  failure) instead of inheriting the terminal — which also stops git chatter
  from leaking in JSON/non-interactive runs. New `progress` module.

## 0.1.0 — first native release

First public release of the native binary. Full command parity with the
TypeScript CLI plus the new build/bootstrap surface.

### Output

- **Styled `doctor` / `doctor --build` text.** Modern, colorized human-readable
  rendering: a bold heading + dim subtitle, colored status glyphs
  (green ✓ / yellow ! / red ✗), aligned check names, a colored
  `N passed · N warnings · N failed` summary (zero counts stay muted), and cyan
  next-step arrows. Color is emitted only on a TTY with `NO_COLOR` unset and
  neither `--no-color` nor `--ci` passed; non-TTY/piped output falls back to
  equal-width ASCII markers (`[+]` / `[!]` / `[x]`). The JSON envelope is never
  styled.

### Commands (14, full parity with the TypeScript CLI)

`validate` (offline + Python-SDK spawn), `generate`, `init`, `scaffold`,
`doctor`, `completion`, `diff`, `presets`, `explain`, `inspect`, `trace`,
`debug-config`, `support-bundle`, `sdk` (list/install/current/switch).

### New in the native CLI (Wave A — orchestration surface)

- **`alp bootstrap`** — sets up the SDK build environment by orchestrating the
  SDK's own `scripts/bootstrap.sh` (west install + `west init/update` + Zephyr
  Python requirements). Text mode streams output live; JSON mode captures and
  wraps it in an envelope. Flags: `--no-pip`, `--no-west`, `--print-env`.
- **`alp build`** and `image` / `flash` / `clean` / `renode` — thin terminal
  wrappers that forward arguments verbatim to the SDK's `west alp-*` driver
  (which owns the heterogeneous per-core dispatch: Zephyr / Yocto / baremetal).
- **`alp doctor --build`** — build-readiness preflight. Resolves the build OS
  set from the active `board.yaml` and reports the host toolchains each backend
  needs (west / cmake / ninja / Zephyr SDK; bitbake; vendor toolchains), with
  installer next-steps. The default `alp doctor` (debug readiness) is unchanged.

### Contract / compatibility

- JSON envelope `{command, ok, exitCode, project, data, issues}` and exit codes
  (0 success, 1 runtime, 2 validation, 3 write, 4 doctor, 5 internal) are fixed
  and verified against the TypeScript CLI by `cli-rs/contract/run.sh`.
- `generatedAt` honors `SOURCE_DATE_EPOCH` for reproducible output.

### Distribution

- GitHub Release assets `alp-<target>.tar.gz` for three targets: macOS arm64
  (Apple Silicon), Linux x64 (gnu), Windows x64 (msvc), built by the
  `release-cli-rs` workflow on `cli-rs-v*` tags. Intel macOS
  (`x86_64-apple-darwin`) is not prebuilt — GitHub's Intel runners stall the
  release; Intel-mac users build from source (`cargo build --release`).
- npm shim package `alp-sdk` downloads the matching archive in its postinstall
  step (no runtime dependencies) and forwards `argv` to the native binary.
