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
pnpm run compile        # tsc + alp-cli tsc + vite
node --test test/*.test.js
```

Open the workspace in VS Code and press **F5** to launch the extension host.

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
npm dist-tag add alp-sdk@<version> latest
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

### Automated (recommended)

1. Bump the version in `packages/alp-cli/package.json`.
2. Update `CHANGELOG.md`.
3. Commit and push to `main`.
4. Create and push a tag:

   ```bash
   git tag cli-v<version>
   git push origin cli-v<version>
   ```

The `release-cli.yml` workflow triggers automatically, runs contract and smoke tests, publishes with provenance to npm under the `latest` dist-tag, and then verifies the published version with `npx`.

### Manual (workflow_dispatch)

Trigger the `release-cli` workflow from the GitHub Actions UI:

- Set **Publish** to `true`.
- Choose a dist-tag (`next` or `latest`).

The workflow will bundle, test, publish, and verify the package.

---

## Rollback playbook

### Scenario 1 — Bad patch/minor release (recoverable)

1. Publish a corrected version immediately:

   ```bash
   # Bump patch in package.json, then:
   git tag cli-v<corrected>
   git push origin cli-v<corrected>
   ```

2. Deprecate the bad version with a clear message:

   ```bash
   npm deprecate alp-sdk@<bad-version> "Regression in <command>. Upgrade to <corrected>."
   ```

3. Add the bad version to the **Affected version matrix** table below.

### Scenario 2 — Unpublishable (within 72 h of publish, policy allows)

```bash
npm unpublish alp-sdk@<version>
```

> **Note:** npm allows unpublish only within 72 hours and only if no other package depends on the version. Prefer `npm deprecate` for older versions.

### Scenario 3 — Breaking major release shipped by mistake

1. Immediately deprecate the version.
2. If the `latest` dist-tag was updated, roll it back:

   ```bash
   npm dist-tag add alp-sdk@<last-good-version> latest
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
npm install -g alp-sdk

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
pnpm --filter alp-sdk run bundle       # build the esbuild bundle
node packages/alp-cli/dist/cli/main.js --help
```

Or use the npm script shortcut:

```bash
pnpm --filter alp-sdk run cli -- --help
```

### For CI agents

Install a pinned version at the start of your workflow to avoid unexpected
breakage from minor/patch updates:

```yaml
- name: Install alp CLI
  run: npm install -g alp-sdk@0.3.0

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
