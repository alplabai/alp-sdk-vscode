# Contributing to alp-sdk-vscode

<!-- SPDX-License-Identifier: Apache-2.0 -->

## Table of Contents

- [Development setup](#development-setup)
- [The build CLI lives in its own repo](#the-build-cli-lives-in-its-own-repo)
- [Semver policy](#semver-policy)
- [Installing the CLI for development](#installing-the-cli-for-development)

---

## Development setup

```bash
git clone --recurse-submodules https://github.com/alplabai/alp-sdk-vscode.git
cd alp-sdk-vscode
pnpm install
pnpm run compile        # tsc + vite (extension + webview)
node --test test/*.test.js
```

Open the workspace in VS Code and press **F5** to launch the extension host.

### Dev note — the `alp-sdk-upstream` submodule shows as a "Linked" SDK

When you run the extension host **on this repo**, the SDK Manager discovers the
`alp-sdk-upstream` submodule (a valid SDK checkout under the workspace) and lists
it on the **Local** tab tagged **Linked** — as opposed to **Installed** SDKs that
Alp downloads to `~/.alp/sdk/<version>`. This is expected and only happens while
developing the extension; a real user's project won't contain that submodule.

- **Use This / Deactivate** behave normally on it (it's a real SDK).
- **Remove** will **delete the submodule's working tree** from disk (the confirm
  modal warns that it isn't Alp-managed). If you do, restore it with:

  ```bash
  git submodule update --init alp-sdk-upstream
  ```

Alp-managed installs (the **Installed** badge) live under `~/.alp/sdk` and carry
no such caveat — removing one just deletes that cached version.

---

## The build CLI lives in its own repo

The build CLI is the standalone native Rust binary `tan`, developed and released
from [`alplabai/tan-cli`](https://github.com/alplabai/tan-cli). This extension
**consumes** it — it downloads and shells `tan`, parsing its JSON envelope (see
[CLI.md](CLI.md)) — but does **not** build or release it. The former in-repo
`alp` (`cli-rs`) binary, its npm shim, and the TypeScript CLI (`packages/alp-cli`)
are gone.

To release a new `tan` version, follow the process in the `tan-cli` repo (bump
`[workspace.package] version` in its `Cargo.toml`, push a `v<version>` tag —
which must equal the crate version, or the `verify-version` job fails — and its
`release` workflow builds the six per-target binaries and publishes each as a
**raw** GitHub release asset, `tan-<triple>[.exe]`). See that repo's release-asset
contract for the tag scheme and asset names.

When adopting a new `tan` release here, bump the pinned version the extension
targets — `SUPPORTED_CLI_VERSION` in `src/alpCli/service.ts` — in lockstep, and
keep the envelope-parsing code (`src/alpCli/`) in step with any envelope change.

---

## Semver policy

Both the extension and the `tan` CLI follow
[Semantic Versioning 2.0.0](https://semver.org/).

| Version bump | When to use |
|---|---|
| **patch** (`x.y.Z`) | Bug fixes, documentation, internal refactors with no observable output change. |
| **minor** (`x.Y.0`) | New commands, flags, or JSON envelope fields that are backwards-compatible. |
| **major** (`X.0.0`) | Breaking changes to the JSON envelope schema, removed commands, or changed exit codes. |

### Breaking-change checklist

Before merging any change that bumps the `tan` CLI major version (in the
`tan-cli` repo):

- [ ] All envelope field removals and renames are documented in that repo's `CHANGELOG.md`.
- [ ] Exit code changes are listed in the `CHANGELOG.md`.
- [ ] The envelope-contract tests are updated to match the new schema.
- [ ] Migration notes are added to the GitHub release.
- [ ] This extension's `SUPPORTED_CLI_VERSION` and `src/alpCli/` parser are updated in lockstep.

---

## Installing the CLI for development

### End users

No manual install — the extension provisions the managed `tan` on activation
(download-on-demand into global storage, shown in a progress notification). See
[GETTING_STARTED_VSCODE.md](GETTING_STARTED_VSCODE.md).

### Local from source

```bash
# in a tan-cli checkout:
cargo build --release
tan-cli/target/release/tan --help
```

Point the VS Code extension at a local build via the `alpSdk.cliPath` setting.

### Terminal / CI

Download the pinned release asset for your host target from the
[tan-cli releases](https://github.com/alplabai/tan-cli/releases) (tag
`v<version>`), put it on `PATH`, and (on Unix) `chmod +x` it. Through
v0.5.0-rc4 the asset is named `tan-<triple>[.exe]` and IS the binary; a
release built with the archive freeze (tan-cli#349) publishes a DIFFERENT
name instead — `tan-<triple>.zip` (win32) / `tan-<triple>.tar.gz`
(elsewhere) — holding a onedir tree that needs unpacking first, not the same
name with different contents. Check the release's `checksums.txt` to see
which name it actually published — the example below is the raw-binary case:

```yaml
- name: Install tan CLI
  run: |
    curl -L -o /usr/local/bin/tan \
      https://github.com/alplabai/tan-cli/releases/download/v0.3.0/tan-x86_64-unknown-linux-gnu
    chmod +x /usr/local/bin/tan

- name: Validate board config
  run: tan validate --format json board.yaml
```

### Offline environments / air-gapped mirrors

Through v0.5.0-rc4 the release asset is named `tan-<triple>[.exe]` and is a
**raw** binary (no archive) — download it on an internet-connected machine
and copy it to the air-gapped host's `PATH`; no unpack step. A release built
with the archive freeze (tan-cli#349) instead publishes a DIFFERENT asset
name — `tan-<triple>.zip` (win32) / `tan-<triple>.tar.gz` (elsewhere) —
holding a onedir tree; unpack it first and copy the `tan[.exe]` launcher plus
its `_internal/` sibling it contains:

```bash
# On the connected machine, grab the asset for the target platform from the
# GitHub release (tag v<version>) — check that release's checksums.txt to see
# which of the two names it actually published:
#   https://github.com/alplabai/tan-cli/releases
#   tan-<triple>[.exe]              (raw binary, through v0.5.0-rc4)
#   tan-<triple>.zip / .tar.gz      (archive, tan-cli#349 on)

# On the air-gapped machine, put `tan` on PATH:
install -m 0755 tan-x86_64-unknown-linux-gnu /usr/local/bin/tan
tan --help
```
