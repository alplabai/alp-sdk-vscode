# Getting Started (CLI)

Last revised: 2026-08-10

This guide covers the terminal-first `tan` CLI workflow. Two usage modes are
supported: **standalone install** (download the prebuilt binary, recommended for
end users and CI) and **development from source** (install from a `tan-cli`
checkout).

> **Note.** The build CLI is the standalone `tan` binary, published from
> [`alplabai/tan-cli`](https://github.com/alplabai/tan-cli) — from v0.5.0 on a
> PyInstaller freeze of `tan-cli`'s Python implementation (earlier releases
> were a Rust binary; see "Host support" below); the former in-repo `alp`
> (`cli-rs`) binary and the retired TypeScript CLI are gone. The `tan` command
> and its flags/output honor the envelope contract in [`CLI.md`](CLI.md). To
> run from source instead, install it: `python3 -m pip install ./python` in a
> `tan-cli` checkout, which puts the `tan` console script on `PATH`.

## 0. Standalone Install

`tan-cli` publishes a **PyInstaller onedir archive per target** as a GitHub
release asset — `.tar.gz` for Linux/macOS, `.zip` for Windows (raw per-target
binaries were retired at v0.5.0, tan-cli#349). Download the archive for your
host from the [tan-cli releases](https://github.com/alplabai/tan-cli/releases),
unpack it, and put the extracted directory on your `PATH`. Move the whole
directory, not just the `tan`/`tan.exe` launcher inside it — the launcher
needs the `_internal/` directory that ships next to it:

```bash
# Pick the asset for your host target (tag v<version>):
#   tan-x86_64-unknown-linux-gnu.tar.gz    (Linux x64)
#   tan-aarch64-apple-darwin.tar.gz        (macOS Apple silicon)
#   tan-x86_64-pc-windows-msvc.zip         (Windows x64)
# This one runs tan but CANNOT build firmware -- see "Host support" below:
#   tan-x86_64-apple-darwin.tar.gz         (macOS Intel)
# Not published for a PyInstaller-built tan (from v0.5.0 on) -- see Host support:
#   Linux arm64, Windows arm64
mkdir -p ~/tan-cli && cd ~/tan-cli
curl -fL --retry 3 -o tan.tar.gz \
  https://github.com/alplabai/tan-cli/releases/download/v0.5.1/tan-x86_64-unknown-linux-gnu.tar.gz
tar -xzf tan.tar.gz   # extracts to ./tan/ (launcher + _internal/, already executable)
export PATH="$HOME/tan-cli/tan:$PATH"   # add to your shell profile to persist
tan --help
```

On Windows, unzip `tan-x86_64-pc-windows-msvc.zip` instead and add the
extracted folder (containing `tan.exe` and `_internal/`) to your `PATH`.

No `tan` release has ever published a 32-bit-ARM Linux asset
(`arm-unknown-linux-*`), and building one from source would not unblock that
host either — see [Host support](#host-support-tan-runs-vs-firmware-builds).

For CI environments, pin to an exact release tag (`v<version>`) to ensure
reproducibility. The VS Code extension provisions the same release asset
automatically (see [GETTING_STARTED_VSCODE.md](GETTING_STARTED_VSCODE.md));
this guide is for terminal/CI use where you manage `tan` yourself.

### Host support: `tan` runs vs. firmware builds

Downloading `tan` for your host and **building firmware** on that host are two
different claims. `tan` publishes binaries for more hosts than the pinned
**Zephyr SDK 1.0.1** publishes a toolchain for, and where the toolchain is
missing there is nothing for `west sdk install` to fetch — so `tan build`
cannot produce an image no matter how `tan` got there.

`zephyrproject-rtos/sdk-ng` `v1.0.1` publishes exactly **four** host families:
`linux-aarch64`, `linux-x86_64`, `macos-aarch64`, `windows-x86_64`.

| Host                | `tan` asset                          | Zephyr SDK 1.0.1 host build | Firmware builds?                                              |
| ------------------- | ------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| Linux x64           | `tan-x86_64-unknown-linux-gnu.tar.gz` | `linux-x86_64`              | Yes                                                            |
| Linux arm64         | none published from v0.5.0 on¹        | `linux-aarch64`             | **No** from v0.5.0 on¹                                         |
| macOS Apple silicon | `tan-aarch64-apple-darwin.tar.gz`     | `macos-aarch64`             | Yes                                                            |
| Windows x64         | `tan-x86_64-pc-windows-msvc.zip`      | `windows-x86_64`            | Yes                                                            |
| Windows on ARM      | none published from v0.5.0 on²        | never published             | **No** — see note 2, `wsl --install` gets a toolchain but not a `tan` |
| macOS Intel         | `tan-x86_64-apple-darwin.tar.gz`      | dropped in SDK 1.0.0        | **No** — build on a `linux-x86_64` VM, container, or remote box |
| Linux armhf         | none published                        | none published              | **No** — move to a `linux-x86_64` / `linux-aarch64` host        |

Four notes worth having before you pick a machine:

- **Intel Mac.** The SDK published `macos-x86_64` through **0.17.4** and dropped
  it in **1.0.0**; the pin is 1.0.1. `macos-aarch64` is not a substitute —
  Rosetta translates x86_64 **for** Apple silicon, not aarch64 for an Intel Mac
  — and macOS has no WSL2 equivalent. Pinning an older SDK is not an escape
  either: the pinned Zephyr requires 1.0.1.
- **Linux armhf.** There is no `tan` asset and no Zephyr SDK host build, so
  **building `tan` from source does not help** — it would run and then have
  no toolchain to hand `west`.
- ¹ **Linux arm64.** Through `tan` v0.4.x (Rust) both `-gnu` and `-musl` Linux
  arm64 assets were published. From `tan` v0.5.0 the binary is a PyInstaller
  freeze of the Python port, and PyInstaller cannot cross-compile — the
  release publishes no arm64 Linux asset at all, so this host has no prebuilt
  `tan` regardless of the Zephyr SDK supporting it. Build from source
  (`pip install`) on an arm64 Linux machine instead.
- ² **Windows on ARM.** Neither route to this host has a prebuilt `tan` under
  the current pin. Natively (`win32/arm64`) there is no asset, same reason as
  note 1. The usual `wsl --install` escape hatch does NOT clear it either — a
  WSL2 distro on ARM hardware is `linux-aarch64`, which is note 1's gap, not a
  workaround for it, so `tan` will not run there any more than natively. The
  Zephyr SDK toolchain itself IS available inside that WSL2 distro
  (`linux-aarch64` is one of its four published host builds) once a `tan`
  actually reaches the machine — build/`pip install` one there from source and
  point `alpSdk.cliPath` (or a `tan` on `PATH`) at it.

From `tan` v0.4.0 on, `tan doctor` reports this as a `zephyrSdkHost` check with
a per-host remedy. Earlier builds omit the check — an older `tan` saying nothing
about your host is not a pass.

The `tan` command below is the standalone `tan` CLI (a PyInstaller freeze of
the Python implementation from v0.5.0 on). For development from source,
`python3 -m pip install ./python` in a `tan-cli` checkout puts the same `tan`
console script on `PATH`.

## 1. Prerequisites

- Project folder with board.yaml
- ALP SDK root containing scripts/alp_project.py
- For development from source: Python 3.12+ (`tan` is installed via
  `pip install ./python` from a `tan-cli` checkout)

## 2. Build CLI Artifacts (development from source)

```bash
python3 -m pip install ./python   # run in a tan-cli checkout -> installs the `tan` console script on PATH
```

## 3. Validate Project Config

```bash
tan validate --project . --sdk-root ../alp-sdk
```

CI-friendly variant:

```bash
tan validate --project . --sdk-root ../alp-sdk --format json > validate-report.json
```

Development from source: after `python3 -m pip install ./python` in a
`tan-cli` checkout, the `tan` console script is on `PATH` — invoke the same
command shown above.

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
tan doctor --project . --sdk-root ../alp-sdk --format json
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

## 9. Model Workflows: Check, Zoo, Add, Prep, Run, A/B

`tan model <cmd>` mirrors the alp-sdk `alp model` surface as a thin envelope
wrapper (`{command,ok,exitCode,project,data,issues}`). Alongside the pre-existing
`build` / `list` / `info` / `doctor` subcommands (compile `board.yaml` `models:`
→ `.alpmodel`, list, decode, toolchains), the model lifecycle commands are below.

Static pre-flight fit/perf check — **offline, conservative**:

```bash
tan model check --board board.yaml
tan model check --board board.yaml --format json
tan model check --board board.yaml --exact          # real vela compile (Ethos-U only)
```

Runs OFFLINE with no toolchain. Per SoM-backend it reports an `npuCoverage` of
`full-eligible` | `partial` | `cpu-only` | `undetermined` at
`basis: "static-screen"`, a MAC-weighted UPPER bound
(`computeOnNpuPctMax`), the operators that are certain CPU fallback, and every
caveat as prose in `notes`.

Read a static screen as ELIGIBILITY, never a guarantee: an eligible operator
still carries quantization, shape and dtype constraints the screen cannot
check, and the model runs either way — an operator the NPU cannot take falls
back to the CPU silently rather than failing.

`undetermined` means NO DATA for that backend (no support table, or a source
format it does not ingest), not a finding that the model will not run.

`--exact` runs the real `vela` for Ethos-U (`pip install
alp-tan[model-compile]`) and upgrades the report to `basis: "compiled"` with
the measured operator placement (`npuPlacementPctReal`). Only `basis:
"compiled"` or `basis: "bench"` may be read as proven.

Browse the curated model zoo (each entry marked whether it runs on your SoM):

```bash
tan model zoo --sku <SKU>
tan model zoo --board board.yaml --format json
```

Add a zoo entry to your `board.yaml` `models:`:

```bash
tan model add <zoo-id> --board board.yaml --name NAME --models-dir DIR
```

Fetches the source (URL sha256-verified, or bundled) and appends `{name, source}`
to `board.yaml` `models:`. Non-destructive — a duplicate name errors.

License-free INT8 quantize + fp32-vs-int8 accuracy report:

```bash
tan model prep <model.onnx|.tflite> --calibration <dir> --out OUT --per-channel --min-samples N
```

Produces an INT8 (onnxruntime QDQ) model plus an accuracy report (top1 agreement
%, mean cosine, max-abs-err, verdict `good` | `degraded` + guidance). A `.tflite`
input is converted to ONNX first via tf2onnx.

Host reference run / A-B compare — **NOT target-SoM performance**:

```bash
tan model run <model.onnx> --input FILE.npy --expected LABEL --runs N
tan model ab <a.onnx> <b.onnx> --input FILE.npy --runs N
```

`run` executes on the HOST (backend `cpu-host`): functional + host-latency +
accuracy. `ab` compares two models on the same input for latency + size delta.
Both are host REFERENCE runs, not the target SoM's performance —
`peak_sram_kib` / `power_mj` are null on host (on-device values are HW-gated).

## 10. Exit Codes

- 0: success
- 1: runtime/command failure
- 2: validation/config failure
- 3: generation/scaffold write failure
- 4: doctor/preflight failure
- 5: internal failure

## 11. CI Pipeline Examples

For complete GitHub Actions and GitLab CI examples, see CI_EXAMPLES.md.
