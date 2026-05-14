# project Module

## Purpose

The `project` module resolves environment and workspace context consumed by loader, validation, west, debug, and LSP flows.

## Main Responsibilities

- Resolve workspace root and SDK root.
- Resolve `board.yaml` path and west working directory.
- Resolve Python interpreter defaults.
- Handle ambiguous workspace layouts safely.

## Key Files

- `service.ts`: Core project context resolution logic.
- `models.ts`: Context and settings contracts.
- `vscodeAdapter.ts`: VS Code configuration and workspace integration.

## Notes

Stable project context resolution is foundational for all higher-level commands.