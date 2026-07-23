# Getting Started (VS Code)

Last revised: 2026-07-20

This guide covers the fastest path to a productive ALP SDK workflow inside VS Code.

## 1. Prerequisites

- VS Code 1.85+
- Node.js 20+ (for local extension development only — end users don't need it)
- A workspace that includes your ALP project with board.yaml
- ALP SDK checkout (recommended as sibling folder: ../alp-sdk)
- Python 3 and `west` on `PATH` for the build / generate / validate flows — the
  extension's `tan` CLI shells out to the SDK's `scripts/alp_project.py` (and
  `west`) for those; the SDK's `bootstrap` provides them. Run
  **Alp: Toolchain doctor** to check.

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

> **All six host targets have a prebuilt release binary** — Windows (x64 +
> arm64), Linux (x64 + arm64), and macOS (Intel x64 + Apple silicon arm64) — so
> the download-on-demand path works on every supported host. To run a local
> build instead, `cargo build --release` in a `tan-cli` checkout and point
> `alpSdk.cliPath` at `tan-cli/target/release/tan` (or put a `tan` on `PATH`).

> **Linux arm64 is a glibc build, not musl.** The published Linux arm64 asset
> (`tan-aarch64-unknown-linux-gnu`) links against glibc; the retired in-repo
> CLI used to ship a static `aarch64-unknown-linux-musl` build specifically so
> it would run on any distro regardless of libc. Two consequences: a musl-only
> distro (e.g. Alpine) has no prebuilt `tan` binary to download and needs to
> point `alpSdk.cliPath` at its own build instead, and a host with a glibc
> older than the one the `tan-cli` release was built against can fail to run
> the downloaded binary.

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

- Alp: West build (validate + generate + build)
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
