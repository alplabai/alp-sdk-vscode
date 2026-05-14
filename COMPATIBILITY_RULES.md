# Compatibility Rules

Last revised: 2026-05-14

This document defines backward-compatibility guarantees for schema support, generation targets, and CLI contracts.

## 1. Schema Compatibility

- board-config schema updates must preserve existing valid board.yaml files whenever possible.
- Breaking schema changes require:
  - explicit changelog note,
  - migration guidance,
  - versioned acceptance tests.
- Schema source of truth remains alp-sdk-upstream submodule.

## 2. Generation Target Compatibility

- Supported generation targets are versioned product contract:
  - zephyr-conf
  - dts-overlay
  - cmake-args
  - yocto-conf
- Removing or renaming a target is breaking.
- Output path changes are breaking unless migration guidance is provided.
- Generation target metadata is protected by golden tests.

## 3. CLI Flag and JSON Compatibility

- Existing command names and flag names are stable public API.
- Existing JSON envelope keys are stable:
  - command
  - ok
  - exitCode
  - project
  - data
  - issues
- Command-specific payload keys must not be renamed silently.
- Any additive fields must be backward-compatible (no required-field break for existing parsers).

## 4. Compatibility Change Process

Before merging a potentially breaking change:

1. Update this document and CLI.md if contract changes.
2. Update golden/integration tests for the new contract.
3. Add migration notes in release communication.
