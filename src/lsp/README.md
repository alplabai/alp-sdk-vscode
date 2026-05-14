# lsp Module

## Purpose

The `lsp` module provides Language Server Protocol capabilities for `board.yaml` authoring.

## Main Responsibilities

- Start and stop the language client/server pair.
- Serve diagnostics, completion, hover, symbols, and quick fixes.
- Expose command-backed effective-config preview responses.
- Keep LSP data transformations reusable and testable.

## Key Files

- `client.ts`: Language client lifecycle and client-side request helpers.
- `server.ts`: LSP capabilities, request handlers, and command execution.
- `service.ts`: Pure helpers for diagnostics ranges, completion/hover data, symbols, and quick-fix suggestions.
- `commands.ts`: VS Code command surface that invokes LSP-backed workflows.

## Notes

This module is the primary editor-intelligence surface for `board.yaml`.