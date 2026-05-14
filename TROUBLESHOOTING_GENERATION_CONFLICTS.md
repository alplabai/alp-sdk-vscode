# Generation Conflict Troubleshooting

Last revised: 2026-05-14

This guide covers failures where generation or scaffolding cannot safely write files.

## 1. Typical Conflict Cases

- target file exists with user-owned changes
- scaffolding attempts an update without --force
- mixed-target generation where one target fails

## 2. Symptoms

- generate returns exit code 3
- scaffold or init returns exit code 3
- issues array contains command-specific failure or overwrite-blocked codes

## 3. Resolution Strategy

1. Run with preview-first flow where supported.
2. Identify update paths and decide ownership.
3. Back up user-owned files before force writes.
4. Re-run command with --force only when replacement is intentional.

## 4. Suggested Safe Flow

1. validate
2. generate or scaffold in preview mode
3. review planned file changes
4. execute write mode

## 5. CI Guidance

In CI, avoid implicit overwrite behavior.

- fail fast on exit code 3
- upload JSON report artifact for triage
- keep generated outputs deterministic per SDK revision
