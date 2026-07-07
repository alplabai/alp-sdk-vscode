# Async SDK Job Layer Plan

Issue: #74

## Goal

Move SDK validation, generation, and related command execution off synchronous
subprocess paths so the extension and language server remain responsive as SDKs,
Python environments, and workspaces grow.

## Current Gaps

- LSP save validation uses `cp.spawnSync`.
- Loader generation commands use `cp.spawnSync`.
- Some tool probes use synchronous process calls.
- User-invoked operations do not share progress, cancellation, or structured log
  behavior.

## Design Principles

- Keep pure planning logic in `@alp-sdk/core`.
- Put process execution behind VS Code adapter boundaries.
- Stream output into a consistent ALP SDK job log.
- Let user-invoked jobs show progress and cancellation.
- Let LSP validation debounce/coalesce repeated saves.
- Preserve existing command-line traceability for support bundles.

## Proposed PR Slices

1. Process runner abstraction
   - Add an async process runner interface.
   - Return status, stdout, stderr, duration, and cancellation outcome.
   - Keep existing sync adapters temporarily for CLI compatibility.

2. Extension job service
   - Add a VS Code-side job runner with `withProgress`.
   - Stream stdout/stderr to the ALP SDK output channel.
   - Support cancellation tokens where subprocess termination is safe.
   - Standardize job names and result summaries.

3. Loader and validator command migration
   - Convert `alp.validateBoardYaml` and generation commands to async execution.
   - Add progress and cancellation.
   - Preserve existing status messages and output-channel behavior.

4. LSP validation scheduler
   - Debounce validation after save/change.
   - Cancel stale validation requests for the same URI.
   - Cache latest diagnostics by document version/content hash where useful.
   - Avoid blocking the LSP event loop on Python subprocesses.

5. Tool probing cleanup
   - Convert slow or repeated probes to async where they run on activation or UI
     refresh paths.
   - Add small timeouts and clear error classification.

## Acceptance Criteria

- LSP validation no longer calls `spawnSync`.
- Extension validation/generation commands show progress and preserve logs.
- Repeated saves coalesce validation requests.
- Stale validation results do not overwrite newer diagnostics.
- Unit tests cover process-runner status, cancellation, and debouncing behavior.

## Test Plan

- `CI=true pnpm test`
- Unit tests with fake async process runners.
- LSP service tests for coalescing/stale-result behavior.
- Manual smoke:
  - save `board.yaml` repeatedly,
  - run validate,
  - run generate all,
  - cancel a long-running fake validator command.

## Risks

- Subprocess cancellation semantics differ on Windows and POSIX. The first pass
  should centralize termination behavior and test Windows explicitly.
- CLI paths may intentionally stay sync until the Rust migration lands; the
  extension should not wait for that migration.
