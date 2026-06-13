<!-- SPDX-License-Identifier: Apache-2.0 -->

# @alplabai/alp-cli

npm distribution shim for the native Rust **`alp`** CLI. Installing this package
downloads the platform-specific binary from the matching GitHub release and exposes it
as the `alp` command — no Rust toolchain and no runtime Node dependency required.

```bash
npm install -g @alplabai/alp-cli
alp --version
```

For the full command reference, JSON output contract, and other install channels
(`cargo install alp-cli`, `cargo binstall alp-cli`, prebuilt archives), see the
[`cli-rs` README](../README.md).

## How it works

- `postinstall.js` maps the host platform/arch to a release target triple, downloads
  `alp-<target>.tar.gz` from
  `https://github.com/alplabai/alp-sdk-vscode/releases/download/cli-rs-v<version>/`, and
  unpacks it into `binary/`.
- `bin/alp.js` forwards `alp …` invocations to that native binary.

Prebuilt targets: **Linux x64**, **macOS arm64**, **Windows x64**. Any other
platform/arch (including Intel macOS) has no prebuilt archive — install via
`cargo install alp-cli` or build from source instead.

## Releasing

1. Bump the version in **both** `cli-rs/Cargo.toml` (workspace `version`) and
   `cli-rs/npm-shim/package.json` to the same value.
2. Tag `cli-rs-v<version>` and push — `release-cli-rs.yml` builds the platform archives
   and attaches them to the GitHub release. **Do this first**, so the archives exist.
3. Tag `cli-v<version>` and push — `release-cli.yml` publishes this package to npm
   (`--provenance --access public`, gated on the `NPM_TOKEN` secret). Its `postinstall`
   then resolves the binary from the `cli-rs-v<version>` release.
