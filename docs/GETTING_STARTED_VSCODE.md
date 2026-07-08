# Getting Started (VS Code)

Last revised: 2026-05-14

This guide covers the fastest path to a productive ALP SDK workflow inside VS Code.

## 1. Prerequisites

- VS Code 1.85+
- Node.js 20+ (for local extension development only — end users don't need it)
- A workspace that includes your ALP project with board.yaml
- ALP SDK checkout (recommended as sibling folder: ../alp-sdk)
- Python 3 and `west` on `PATH` for the build / generate / validate flows — the
  extension's `alp` CLI shells out to the SDK's `scripts/alp_project.py` (and
  `west`) for those; the SDK's `bootstrap` provides them. Run
  **Alp: Toolchain doctor** to check.

### The `alp` CLI is auto-provisioned

The native `alp` CLI is **not** bundled in the VSIX and needs no manual install.
The extension resolves it, in order:

1. the `alpSdk.cliPath` setting (point it at a local build to override),
2. `alp` on your `PATH`,
3. a previously cached copy in the extension's global storage,
4. otherwise it **downloads the matching `cli-rs-v<version>` release** into
   global storage on first use (needs network access).

> **Intel macOS (`darwin/x64`) has no prebuilt release binary.** Build it from
> source — `cargo build --release --manifest-path cli-rs/Cargo.toml` — and set
> `alpSdk.cliPath` to `cli-rs/target/release/alp` (or put an `alp` on `PATH`).
> Apple-silicon macOS, Linux (x64/arm64) and Windows x64 download automatically.

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
