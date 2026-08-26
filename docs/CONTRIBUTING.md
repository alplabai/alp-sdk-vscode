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

The build CLI is the standalone `tan` binary — from v0.5.0 on a PyInstaller
freeze of `tan-cli`'s Python implementation (earlier releases were a Rust
binary) — developed and released from
[`alplabai/tan-cli`](https://github.com/alplabai/tan-cli). This extension
**consumes** it — it downloads and shells `tan`, parsing its JSON envelope (see
[CLI.md](CLI.md)) — but does **not** build or release it. The former in-repo
`alp` (`cli-rs`) binary, its npm shim, and the TypeScript CLI (`packages/alp-cli`)
are gone.

To release a new `tan` version, follow the process in the `tan-cli` repo (bump
`TAN_VERSION` in `python/tan/version.py` — the single source of truth its
`version_check.py` gate enforces against `pyproject.toml` and the npm shim;
`Cargo.toml` no longer exists, tan-cli#269 — push a matching `v<version>` tag,
and its `release` workflow builds the four per-target PyInstaller onedir
archives and publishes each as a GitHub release asset, `tan-<triple>.tar.gz` /
`tan-<triple>.zip`). See that repo's release-asset contract for the tag scheme
and asset names.

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
python3 -m pip install ./python
tan --help
```

Point the VS Code extension at a local build via the `alpSdk.cliPath` setting.

### Terminal / CI

Download the pinned release archive for your host target from the
[tan-cli releases](https://github.com/alplabai/tan-cli/releases) (tag
`v<version>`) — `tan-<triple>.tar.gz` (Linux/macOS) or `tan-<triple>.zip`
(Windows); tan-cli retired raw per-target binaries at v0.5.0 in favour of
these PyInstaller onedir archives (tan-cli#349). Unpack the archive into a
directory and put that directory on `PATH` (or symlink the launcher) — the
`tan`/`tan.exe` launcher inside already ships executable and needs its
`_internal/` sibling next to it, so don't move or `chmod` it in isolation:

```yaml
- name: Install tan CLI
  run: |
    curl -fL --retry 3 -o tan.tar.gz \
      https://github.com/alplabai/tan-cli/releases/download/v0.6.0/tan-x86_64-unknown-linux-gnu.tar.gz
    tar -xzf tan.tar.gz -C /usr/local/lib   # -> /usr/local/lib/tan/{tan,_internal/}
    ln -s /usr/local/lib/tan/tan /usr/local/bin/tan

- name: Validate board config
  run: tan validate --format json board.yaml
```

### Offline environments / air-gapped mirrors

`tan-cli` publishes a **PyInstaller onedir archive** per target —
`tan-<triple>.tar.gz` (Linux/macOS) or `tan-<triple>.zip` (Windows); no raw
per-target binaries since v0.5.0 (tan-cli#349). Download the archive on an
internet-connected machine and transfer it to the air-gapped host, unpacking
there — `tan`/`tan.exe` needs its `_internal/` sibling next to it, so
transfer and unpack the archive as a whole rather than copying the launcher
alone:

```bash
# On the connected machine, grab the archive for the target platform from the
# GitHub release (tag v<version>):
#   https://github.com/alplabai/tan-cli/releases
#   tan-<triple>.tar.gz (Linux/macOS) or tan-<triple>.zip (Windows)
curl -fL --retry 3 -o tan.tar.gz \
  https://github.com/alplabai/tan-cli/releases/download/v0.6.0/tan-x86_64-unknown-linux-gnu.tar.gz

# Transfer tan.tar.gz to the air-gapped machine, then there:
tar -xzf tan.tar.gz -C /usr/local/lib   # -> /usr/local/lib/tan/{tan,_internal/}
ln -s /usr/local/lib/tan/tan /usr/local/bin/tan
tan --help
```
