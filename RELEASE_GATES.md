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
