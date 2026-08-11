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
3. a locally-built sibling `tan-cli/python/dist/tan/tan[.exe]` (source
   checkout — where `cd python && bash scripts/build_binary.sh` puts its
   PyInstaller freeze),
4. a previously cached copy in the extension's global storage,
5. a verified-native `tan` on your `PATH` (last resort — a `tan` that does not
   emit the native `tan X.Y.Z` version line is treated as not present and falls
   through, so a stale or non-native PATH copy never shadows the managed one),
6. otherwise it **downloads the matching `v<version>` release** of
   `alplabai/tan-cli` into global storage (needs network access) — named
   `tan-<triple>[.exe]` and holding a raw binary through v0.5.0-rc4, or named
   `tan-<triple>.zip` (win32) / `tan-<triple>.tar.gz` (elsewhere) and holding
   an archive from tan-cli#349 on. Which name a given release actually
   published is resolved from that release's own `checksums.txt`, never
   guessed from the version.

> **Four of the six host targets the extension maps have a prebuilt release
> binary** — Windows x64, Linux x64, and macOS (Intel x64 + Apple silicon
> arm64). Windows on ARM and Linux arm64 get an explained "no build for this
> platform" message instead of a download 404 (see the two rows below),
> because the pinned `tan` is a PyInstaller freeze and PyInstaller cannot
> cross-compile. To run a local build instead, `python3 -m pip install ./python`
> in a `tan-cli` checkout and point `alpSdk.cliPath` at the resulting `tan` (or
> put it on `PATH`). There is no `cargo` route any more — tan-cli#269 removed
> `Cargo.toml`, so `cargo build --release` errors out.
>
> **That is not the same as "you can build firmware here."** Even a host
> with a working `tan` binary may not be able to compile a Zephyr image. See
> [Host support](#host-support-tan-runs-vs-firmware-builds) below **before**
> you pick a machine.

> **The Linux asset is a glibc build, not musl.** The extension downloads
> `tan-x86_64-unknown-linux-gnu.tar.gz`. A PyInstaller musl freeze is musl-*dynamic*,
> not static — it needs `/lib/ld-musl-x86_64.so.1` present and would not
> start on Ubuntu/Debian/Fedora at all — so `-gnu` is the only usable Linux
> asset the Python `tan` publishes. It is built inside `python:3.12-slim-bullseye`
> (Debian 11, glibc 2.31), and the measured floor over the PyInstaller payload
> is `GLIBC_2.30` — a manylinux2014 container is NOT used: static CPython in
> that container fails PyInstaller's own build (`Python was built without a
> shared library, which is required by PyInstaller`).

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

| Host (`process.platform`/`process.arch`) | `tan` release asset                | Zephyr SDK 1.0.1 host build | Firmware builds?               |
| ---------------------------------------- | ---------------------------------- | --------------------------- | ------------------------------ |
| Windows x64 — `win32/x64`                 | `tan-x86_64-pc-windows-msvc.zip`  | `windows-x86_64`            | Yes                            |
| Linux x64 — `linux/x64`                   | `tan-x86_64-unknown-linux-gnu.tar.gz` | `linux-x86_64`           | Yes                            |
| Linux arm64 — `linux/arm64`               | none published for this pin        | `linux-aarch64`             | **No** — see below             |
| macOS Apple silicon — `darwin/arm64`      | `tan-aarch64-apple-darwin.tar.gz`  | `macos-aarch64`             | Yes                            |
| Windows on ARM — `win32/arm64`            | none published for this pin        | never published             | **No** — see below             |
| macOS Intel — `darwin/x64`                | `tan-x86_64-apple-darwin.tar.gz`   | dropped in SDK 1.0.0        | **No** — build on a Linux host |
| Linux armhf — `linux/arm`                 | none published                     | none published              | **No** — move to another host  |

Running `tan doctor` yourself, with no flags, reports the same verdict as a
`zephyrSdkHost` check, from `tan` v0.4.0 on. Two things do NOT count as a pass:
an older `tan` omits the check entirely, and `tan doctor --build` omits it by
design — so silence about your host says nothing either way. This table is the
source of truth.

#### Linux arm64 — no `tan` binary for this pin

The Zephyr SDK publishes `linux-aarch64` and would happily build firmware here,
but the pinned `tan` is a PyInstaller freeze and PyInstaller cannot
cross-compile — the release this extension is pinned to ships no `linux/arm64`
binary at all. The extension's download path explains this (point
`alpSdk.cliPath` at a `tan` you build or `pip install` locally) rather than
attempting a download and failing with a 404. A later `tan` release may add
this host; check `docs.alplab.ai` or `alplabai/tan-cli`'s releases.

#### Windows on ARM — no `tan` binary either natively or via WSL2

Neither route to this host has a prebuilt `tan` under the current pin. Natively
(`win32/arm64`) there is no asset, for the same PyInstaller-cannot-cross-compile
reason as Linux arm64 above. The usual WSL2 escape hatch does not clear
it either: a WSL2 distro on ARM hardware is `linux-aarch64`, which is a
**different** declared gap (above) with the same root cause, not a workaround
for it — so `tan` will not run there any more than it runs natively.

The Zephyr SDK toolchain itself IS available inside that WSL2 distro
(`linux-aarch64` is one of its four published host builds), so once a `tan`
is on the machine, firmware builds work. Getting one there means building or
`pip install`ing `tan` from source (`git clone
https://github.com/alplabai/tan-cli && pip install ./tan-cli/python`, inside
the WSL2 distro so it lands on `linux-aarch64`) and pointing `alpSdk.cliPath`
at it — the extension's own download-on-demand cannot help on either hop of
this host. A later `tan` release may add the missing binary; check
`docs.alplab.ai` or `alplabai/tan-cli`'s releases.

#### macOS Intel — build on a Linux host

`tan-x86_64-apple-darwin.tar.gz` exists and installs, so the extension provisions
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
No prebuilt tan CLI for linux/arm — tan v0.5.1 publishes binaries for other platforms only, so this is a limit of that release rather than a broken install. Point alpSdk.cliPath at a tan you build locally or install with pip.
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

**First run: tan CLI download consent.** The first time nothing else resolves
a `tan` binary on your machine, the extension shows a one-time consent dialog
(artifact, source, size, licence) before downloading it; your answer is
remembered, so it asks only once. `alpSdk.tanCliDownloadConsent` (`ask`
default / `allow` / `deny`, machine-overridable) pre-answers it for a
managed/CI image. A later stale-cache update or one-time re-verification of an
already-downloaded binary is never gated by this setting — both act on a `tan`
you already have.

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
