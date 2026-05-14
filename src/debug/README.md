# debug Module

## Purpose

The `debug` module provides shared debug orchestration building blocks for VS Code commands and future CLI reuse.

## Main Responsibilities

- Build debug target and server option matrices.
- Generate debug profiles and launch drafts.
- Produce inspect, doctor, preflight, and support-bundle payloads.
- Keep debug models stable across UI and automation surfaces.

## Key Files

- `service.ts`: Core debug workflows and serialization helpers.
- `models.ts`: Shared debug contracts and payload schemas.
- `launchJsonCore.ts`: Launch JSON update and merge plan logic.
- `adapterCore.ts`: Runtime-independent adapter utilities.
- `vscodeAdapter.ts`: VS Code and file-system integration.

## Notes

The module focuses on debugger-aware orchestration, not implementing a debugger.