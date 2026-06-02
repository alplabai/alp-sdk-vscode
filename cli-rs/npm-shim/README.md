# alp-sdk (native CLI shim)

npm distribution wrapper for the native Rust `alp` CLI. Installing this package
downloads the platform-specific binary from the matching GitHub release and
exposes it as the `alp` command — so `npm i -g alp-sdk` keeps working unchanged
after the CLI moves from TypeScript to Rust.

## How it works

- `postinstall.js` maps the host platform/arch to a release target triple,
  downloads `alp-<target>.tar.gz` from
  `https://github.com/alplabai/alp-sdk-vscode/releases/download/cli-rs-v<version>/`,
  and unpacks it into `binary/`.
- `bin/alp.js` forwards `alp …` invocations to that native binary.

Supported: linux x64, macOS x64 + arm64, Windows x64.

## Releasing

1. Bump the version in **both** `cli-rs/Cargo.toml` (workspace `version`) and
   `cli-rs/npm-shim/package.json` to the same value.
2. Tag `cli-rs-v<version>` and push — `.github/workflows/release-cli-rs.yml`
   builds the four platform archives and attaches them to the GitHub release.
3. Publish this package to npm (`npm publish` from `cli-rs/npm-shim`). Its
   `postinstall` then resolves the just-published release.

> Cutover note (Phase 7): publishing this as `alp-sdk` replaces the legacy
> TypeScript CLI package of the same name. Until then it is built/tested but not
> published over the existing package.
