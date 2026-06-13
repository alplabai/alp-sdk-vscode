# Contributing to alp-sdk-vscode

<!-- SPDX-License-Identifier: Apache-2.0 -->

## Table of Contents

- [Development setup](#development-setup)
- [Semver policy and release channels](#semver-policy-and-release-channels)
- [Releasing the CLI](#releasing-the-cli)
- [Rollback playbook](#rollback-playbook)
- [Installing the CLI](#installing-the-cli)

---

## Development setup

```bash
git clone --recurse-submodules https://github.com/alplabai/alp-sdk-vscode.git
cd alp-sdk-vscode
pnpm install
pnpm run compile        # tsc + vite (the alp CLI builds separately from cli-rs/)
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

## Semver policy and release channels

The `alp-sdk` npm package (CLI) follows [Semantic Versioning 2.0.0](https://semver.org/).

| Version bump | When to use |
|---|---|
| **patch** (`x.y.Z`) | Bug fixes, documentation, internal refactors with no observable output change. |
| **minor** (`x.Y.0`) | New commands, flags, or JSON envelope fields that are backwards-compatible. |
| **major** (`X.0.0`) | Breaking changes to the JSON envelope schema, removed commands, or changed exit codes. |

### Release channels

| dist-tag | Purpose | When it is updated |
|---|---|---|
| `next` | Canary builds for early adopters and CI pipelines | Every merge to `main` that bumps the CLI version |
| `latest` | Stable production releases | Manual tag push `cli-vX.Y.Z` |

A version published as `next` **may** be promoted to `latest` by re-tagging:

```bash
npm dist-tag add @alplabai/alp-cli@<version> latest
```

### Breaking-change checklist

Before merging any change that bumps the major version:

- [ ] All `CliEnvelope` field removals and renames are documented in `CHANGELOG.md`.
- [ ] Exit code changes are listed in `CHANGELOG.md`.
- [ ] The `cli.compat.test.js` contract tests are updated to match the new schema.
- [ ] `release-cli.yml` workflow passes with the new test suite.
- [ ] Migration notes are added to the relevant section in this file.

---

## Releasing the CLI

The CLI is the native Rust binary in `cli-rs/`.

1. Bump the version in **both** `cli-rs/Cargo.toml` and
   `cli-rs/npm-shim/package.json` (keep them equal) and refresh `cli-rs/Cargo.lock`.
2. Update `cli-rs/CHANGELOG.md`.
3. Commit and push.
4. Create and push a tag:

   ```bash
   git tag cli-rs-v<version>
   git push origin cli-rs-v<version>
   ```

The `release-cli-rs.yml` workflow triggers automatically and attaches
`alp-<target>.tar.gz` archives (linux-x64, macOS-arm64, windows-x64) to the
GitHub release. Publishing the npm shim is a separate manual step:

```bash
cd cli-rs/npm-shim && npm publish     # @alplabai/alp-cli@<version>; postinstall fetches the archive
```

---

## Rollback playbook

### Scenario 1 — Bad patch/minor release (recoverable)

1. Publish a corrected version immediately:

   ```bash
   # Bump patch in package.json, then:
   git tag cli-rs-v<corrected>
   git push origin cli-rs-v<corrected>
   ```

2. Deprecate the bad version with a clear message:

   ```bash
   npm deprecate @alplabai/alp-cli@<bad-version> "Regression in <command>. Upgrade to <corrected>."
   ```

3. Add the bad version to the **Affected version matrix** table below.

### Scenario 2 — Unpublishable (within 72 h of publish, policy allows)

```bash
npm unpublish @alplabai/alp-cli@<version>
```

> **Note:** npm allows unpublish only within 72 hours and only if no other package depends on the version. Prefer `npm deprecate` for older versions.

### Scenario 3 — Breaking major release shipped by mistake

1. Immediately deprecate the version.
2. If the `latest` dist-tag was updated, roll it back:

   ```bash
   npm dist-tag add @alplabai/alp-cli@<last-good-version> latest
   ```

3. Open a post-mortem issue and document the affected version matrix.

### Affected version matrix

| Version | Status | Issue | Notes |
|---|---|---|---|
| _(none yet)_ | | | |

---

## Installing the CLI

### For end users

```bash
# Global install (latest stable)
npm install -g @alplabai/alp-cli

# Check the installed version
alp --help
```

```bash
# One-shot without install (always fetches latest)
npx alp-sdk --help
```

```bash
# Pin to a specific version
npx alp-sdk@0.3.0 --help
```

### For developers (local from source)

```bash
cargo build --release --manifest-path cli-rs/Cargo.toml
cli-rs/target/release/alp --help
```

Point the VS Code extension at a local build via the `alpSdk.cliPath` setting.

### For CI agents

Install a pinned version at the start of your workflow to avoid unexpected
breakage from minor/patch updates:

```yaml
- name: Install alp CLI
  run: npm install -g @alplabai/alp-cli@0.3.0

- name: Validate board config
  run: alp validate --format json board.yaml
```

### For offline environments / air-gapped mirrors

Pack the CLI into a tarball and ship it to your internal registry or artifact
store:

```bash
# On an internet-connected machine:
pnpm --filter alp-sdk run cli:pack    # produces dist/alp-sdk-<version>.tgz

# On the air-gapped machine:
npm install -g /path/to/alp-sdk-<version>.tgz
```

To mirror to a private npm registry:

```bash
npm publish /path/to/alp-sdk-<version>.tgz \
  --registry https://your-internal-registry/
```
