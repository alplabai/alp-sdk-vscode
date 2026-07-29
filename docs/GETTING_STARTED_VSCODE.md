# Getting Started (VS Code)

Last revised: 2026-07-29

This guide covers the fastest path to a productive ALP SDK workflow inside VS Code.

## 1. Prerequisites

- VS Code 1.85+
- Node.js 20+ (for local extension development only — end users don't need it)
- A workspace that includes your ALP project with board.yaml
- ALP SDK checkout (recommended as sibling folder: ../alp-sdk)
- Python 3 and `west` on `PATH` for the build / generate / validate flows — the
  extension's `tan` CLI shells out to the SDK's `scripts/alp_project.py` (and
  `west`) for those; the SDK's `bootstrap` provides them. Run
  **Alp: Dependencies** for `west` and the other host tools `tan` checks — it
  emits no Python check, so verify that one yourself with `python3 --version`.

### The `tan` CLI is auto-provisioned

The standalone `tan` CLI is downloaded and shelled by the extension — no manual
install. On activation the extension provisions the managed `tan` up front (a
one-time download shown in a progress notification; a no-op once a binary already
resolves), so the first build/validate command doesn't stall on it. It resolves
the binary in this order:

1. the `alpSdk.cliPath` setting (point it at a local build to override),
2. a `bin/tan[.exe]` **bundled** in the VSIX (present only in a platform-specific
   VSIX),
3. a locally-built sibling `tan-cli/target/{release,debug}/tan[.exe]` (source
   checkout),
4. a previously cached copy in the extension's global storage,
5. a verified-native `tan` on your `PATH` (last resort — a `tan` that does not
   emit the native `tan X.Y.Z` version line is treated as not present and falls
   through, so a stale or non-native PATH copy never shadows the managed one),
6. otherwise it **downloads the matching `v<version>` release** of
   `alplabai/tan-cli` (a raw `tan-<triple>[.exe]` binary) into global storage
   (needs network access).

> **Each of the six host targets the extension maps has a prebuilt release
> binary** — Windows (x64 + arm64), Linux (x64 + arm64), and macOS (Intel x64 +
> Apple silicon arm64) — so the download-on-demand path resolves an asset on
> every one of them. To run a local build instead, `cargo build --release` in a
> `tan-cli` checkout and point `alpSdk.cliPath` at `tan-cli/target/release/tan`
> (or put a `tan` on `PATH`).
>
> **That is not the same as "you can build firmware here."** Two of those six
> hosts get a working `tan` and still cannot compile a Zephyr image, and a
> seventh host VS Code itself ships for gets neither. See
> [Host support](#host-support-tan-runs-vs-firmware-builds) below **before** you
> pick a machine.

> **Both Linux assets are static musl builds, not glibc.** The extension
> downloads `tan-x86_64-unknown-linux-musl` / `tan-aarch64-unknown-linux-musl`
> (published from `tan-cli` v0.3.0 on) — fully static, so they run on any
> distro/libc, including musl-only distros like Alpine, with no glibc-version
> floor to worry about.

### Host support: `tan` runs vs. firmware builds

Two different claims, and only the first one is about this extension:

- **`tan` runs here** — Alp Lab publishes a `tan` binary for this OS and CPU, so
  the extension resolves or downloads one and the editor-side features work.
- **Firmware builds here** — the pinned **Zephyr SDK 1.0.1** publishes a host
  toolchain build for this OS and CPU. Without one there is nothing for
  `west sdk install` to fetch, so **Alp: Build** cannot produce an image
  however `tan` got onto the machine.

`zephyrproject-rtos/sdk-ng` `v1.0.1` publishes exactly **four** host families —
`linux-aarch64`, `linux-x86_64`, `macos-aarch64`, `windows-x86_64` — and no
others.

| Host (`process.platform`/`process.arch`) | `tan` binary                       | Zephyr SDK 1.0.1 host build | Firmware builds?               |
| ---------------------------------------- | ---------------------------------- | --------------------------- | ------------------------------ |
| Windows x64 — `win32/x64`                 | `tan-x86_64-pc-windows-msvc.exe`   | `windows-x86_64`            | Yes                            |
| Linux x64 — `linux/x64`                   | `tan-x86_64-unknown-linux-musl`    | `linux-x86_64`              | Yes                            |
| Linux arm64 — `linux/arm64`               | `tan-aarch64-unknown-linux-musl`   | `linux-aarch64`             | Yes                            |
| macOS Apple silicon — `darwin/arm64`      | `tan-aarch64-apple-darwin`         | `macos-aarch64`             | Yes                            |
| Windows on ARM — `win32/arm64`            | `tan-aarch64-pc-windows-msvc.exe`  | never published             | **No** — build inside WSL2     |
| macOS Intel — `darwin/x64`                | `tan-x86_64-apple-darwin`          | dropped in SDK 1.0.0        | **No** — build on a Linux host |
| Linux armhf — `linux/arm`                 | none published                     | none published              | **No** — move to another host  |

Running `tan doctor` yourself, with no flags, reports the same verdict as a
`zephyrSdkHost` check, from `tan` v0.4.0 on. Two things do NOT count as a pass:
an older `tan` omits the check entirely, and `tan doctor --build` omits it by
design — so silence about your host says nothing either way. This table is the
source of truth.

#### Windows on ARM — build inside WSL2

`tan` resolves and runs here, and everything that does not need a compiler
works. The Zephyr SDK has never published a `windows-arm64` host build at any
release, so no native Windows toolchain can be provisioned on this hardware.

Install a WSL2 Linux distribution (`wsl --install`) and do the build from inside
it — a WSL2 distro on ARM hardware is `linux-aarch64`, which the Zephyr SDK does
publish. Open the project through VS Code's WSL remote so the build runs on the
Linux side.

#### macOS Intel — build on a Linux host

`tan-x86_64-apple-darwin` exists and installs, so the extension provisions
cleanly and then the first build fails. The Zephyr SDK published `macos-x86_64`
through **0.17.4** and dropped it in **1.0.0**; the pinned 1.0.1 serves
`macos-aarch64` only.

`macos-aarch64` is not a substitute — Rosetta translates x86_64 **for** Apple
silicon, not aarch64 for an Intel Mac — and macOS has no WSL2 equivalent to fall
back to. Pinning an older Zephyr SDK is not an escape either: the pinned Zephyr
requires 1.0.1, which is past the release that dropped the host.

Build on a Linux host instead — a `linux-x86_64` VM or container on this Mac, or
a remote Linux builder.

#### Linux armhf — neither half is available

VS Code publishes a `linux-armhf` target, where `process.arch` is `arm`. The
extension maps six `platform/arch` keys and `linux/arm` is not one of them, so
download-on-demand refuses with:

```text
No prebuilt tan CLI for linux/arm. Set alpSdk.cliPath to a local build (tan-cli/target/release/tan).
```

**Building `tan` from source does not rescue this host.** The Zephyr SDK
publishes no 32-bit-ARM Linux host build either, so a self-built `tan` would
resolve, run, and then have no toolchain to hand `west` — the same wall, one
step later. Use a `linux-x86_64` or `linux-aarch64` machine (64-bit arm64 Linux
on the same board, where available, is served).

## 2. Install and Open

1. Install the ALP SDK extension from Marketplace or VSIX.
2. Open your project folder in VS Code.
3. Ensure board.yaml exists at workspace root or set alpSdk.boardYamlPath.

## 3. Configure Paths (Optional)

In VS Code settings, configure these values when auto-detection is not enough:

- alpSdk.path
- alpSdk.pythonPath
- alpSdk.boardYamlPath
- alpSdk.westCwd

## 4. Validate and Generate

Use Command Palette (Cmd+Shift+P):

- Alp: Validate board.yaml
- Alp: Generate all (zephyr-conf + dts-overlay + cmake-args + yocto-conf)

Expected outcome:

- Validation diagnostics appear in editor and Problems panel.
- Generated files are written under build/generated.

## 5. Use LSP Authoring Features

While editing board.yaml:

- completion suggests keys and enum values
- hover shows field semantics
- quick fixes suggest common missing blocks
- document symbols show a structural outline
- effective-config preview shows resolved config output

## 6. Run West Workflow

Use:

- Alp: Build (validate + generate + build)
- Alp: West flash
- Alp: Run under native_sim

## 7. Troubleshooting Quick Checks

1. Confirm SDK path resolves to a folder containing scripts/alp_project.py.
2. Confirm board.yaml path is correct.
3. Open Alp: Open troubleshooting panel for inspect/trace/doctor/preflight snapshots.
4. Run Alp: Debug doctor for environment checks.
5. If needed, run Alp: Export debug support bundle.

## 8. Next Steps

- For terminal-first usage, continue with GETTING_STARTED_CLI.md.
- For CI setup examples, see CI_EXAMPLES.md.
