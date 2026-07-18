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

## Gotchas

- Register all `connection.onX` request/notification handlers at module
  scope (top level, before `connection.listen()`), not inside
  `connection.onInitialized`. `connection.workspace.onDidChangeWorkspaceFolders(...)`
  can only be called once the connection has processed the client's
  `initialize` request (its backing emitter is created while handling
  `initialize`); calling it any earlier throws synchronously. If that call
  sits *before* other `connection.onX` registrations in the same
  synchronous callback, the throw aborts the rest of that callback —
  silently unregistering every handler written after it. Keep the
  request/notification handlers at module scope (immune to this) and
  register `onDidChangeWorkspaceFolders` last, inside `onInitialized` — see
  `test/lsp.server.protocol.test.js`.