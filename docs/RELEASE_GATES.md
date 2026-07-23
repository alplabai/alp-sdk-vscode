# Release Gates and Checklist

Last revised: 2026-07-20

This document defines mandatory release gates for core, LSP, UI, CLI, and docs.

## 1. Mandatory Gates

A release candidate is valid only when all gates pass:

1. Build gate
   - npm ci
   - npm run compile
2. Test gate
   - npm test
3. Packaging gate
   - vsce package succeeds
4. Documentation gate
   - README documentation map is updated for new public docs
   - CLI/public behavior changes are reflected in docs
5. Compatibility gate
   - Compatibility Rules reviewed for breaking changes

> **CLI envelope contract.** The extension consumes the standalone `tan` CLI's
> JSON envelope (see [CLI.md](CLI.md)). `tan` and its envelope/exit-code contract
> are gated **in the `alplabai/tan-cli` repo**, not here — the former in-repo
> `rust_cli_contract` job (which ran `bash cli-rs/contract/run.sh` against the
> TypeScript CLI) is retired along with the `cli-rs/` tree and the TypeScript CLI.

## 2. Surface Coverage Checklist

- Core/service logic affected: corresponding service tests updated
- LSP behavior affected: lsp.service tests updated
- UI/webview behavior affected: webview smoke tests updated
- CLI-seam behavior affected: alpCli.service and alpCli.adapterCore tests updated
- Generation contracts affected: loader golden tests updated

## 3. Pre-Release Manual Checks

- Validate command palette paths still discoverable in VS Code
- Validate CLI JSON output for at least validate/generate/doctor/completion
- Verify CI artifacts contain expected outputs

## 4. Sign-Off

Release should be approved only after all checklist items pass in CI and local verification.

## 5. Semver and Release Channels

Version format: `MAJOR.MINOR.PATCH` following semantic versioning.

Extension releases are tagged and published to the VS Code Marketplace from this
repo. The build CLI is released **separately** from
[`alplabai/tan-cli`](https://github.com/alplabai/tan-cli): a `v<version>` tag
push there triggers its `release` workflow, which builds the eight per-target
binaries (Windows x64/arm64, macOS x64/arm64, Linux x64/arm64 gnu, Linux
x64/arm64 musl — musl published from v0.3.0 on; the extension downloads musl)
and publishes each as a **raw** GitHub release asset
(`tan-<triple>[.exe]`, no archive). The extension resolves the matching
`v<version>` asset on activation; the tag scheme and asset names are a stable
contract (see the `tan-cli` release-asset contract).

The extension pins the `tan` version it targets (`SUPPORTED_CLI_VERSION` in
`src/alpCli/service.ts`) — bump it in lockstep when adopting a new `tan` release.

Before bumping `MAJOR`:
- all breaking CLI flag or JSON envelope changes must be documented in `COMPATIBILITY_RULES.md`.
- a migration note must be added to the GitHub release.

## 6. Rollback Playbook

If a published extension release is defective, publish a corrected VSIX
(bump `PATCH`, re-tag) and update the Marketplace/GitHub release notes with a
pointer to the good version.

If a published **`tan` CLI** release is defective, the rollback lives in the
[`alplabai/tan-cli`](https://github.com/alplabai/tan-cli) repo (re-release a
corrected `v<version>` and update its release notes). Because the extension pins
`SUPPORTED_CLI_VERSION`, hold or advance that pin to keep the extension on a
known-good `tan` binary, and add an incident note to `COMPATIBILITY_RULES.md`.
**Floor:** the pin cannot go below `v0.3.0` — the extension downloads the
Linux musl asset (see `TARGETS` in `src/alpCli/service.ts`), and musl assets
don't exist on any earlier tag; holding/rolling back below `v0.3.0` 404s the
Linux download.
