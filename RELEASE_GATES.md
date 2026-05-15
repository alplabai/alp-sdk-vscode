# Release Gates and Checklist

Last revised: 2026-05-14

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

## 2. Surface Coverage Checklist

- Core/service logic affected: corresponding service tests updated
- LSP behavior affected: lsp.service tests updated
- UI/webview behavior affected: webview smoke tests updated
- CLI behavior affected: cli.service and cli.integration tests updated
- Generation contracts affected: loader golden tests updated

## 3. Pre-Release Manual Checks

- Validate command palette paths still discoverable in VS Code
- Validate CLI JSON output for at least validate/generate/doctor/completion
- Verify CI artifacts contain expected outputs

## 4. Sign-Off

Release should be approved only after all checklist items pass in CI and local verification.

## 5. Semver and Release Channels

Version format: `MAJOR.MINOR.PATCH` following semantic versioning.

CLI releases are tagged `cli-v<version>` (e.g. `cli-v0.3.0`). The tag push triggers
the `release-cli` CI workflow.

| Channel | npm dist-tag | Trigger |
|---------|-------------|---------|
| `latest` | `latest` | `cli-v*` tag push |
| `next` | `next` | `workflow_dispatch` with `publish: true` |

Extension and CLI `MAJOR.MINOR` are kept in sync. `PATCH` may diverge for
standalone CLI-only hotfixes.

Before bumping `MAJOR`:
- all breaking CLI flag or JSON envelope changes must be documented in `COMPATIBILITY_RULES.md`.
- a migration note must be added to the GitHub release.

## 6. Rollback Playbook

If a published CLI version is defective:

1. **Deprecate** (preferred — keeps install history intact):
   ```
   npm deprecate alp-sdk@<bad-version> "Defective release; upgrade to <good-version>"
   ```
2. **Unpublish** (only within 72 h of publish and no significant downloads):
   ```
   npm unpublish alp-sdk@<bad-version>
   ```
3. **Re-release**: cherry-pick or revert to last known good commit, bump PATCH,
   tag `cli-v<new-version>`, push to trigger automated release.
4. **Communicate**: update the GitHub release notes for the bad version with a
   deprecation notice and a pointer to the good version.
5. **Document**: add an incident note to `COMPATIBILITY_RULES.md`.
