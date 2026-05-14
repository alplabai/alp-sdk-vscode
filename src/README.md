# Source Folder Guide

This document explains the purpose of each module folder under `src`.

## Module Map

- `boardSummary/`: Parses and summarizes `board.yaml` for quick UI status rendering.
- `configurator/`: Owns board model parsing, normalization, and YAML regeneration logic.
- `debug/`: Contains debug profile generation, doctor/preflight workflows, and related adapters.
- `loader/`: Encapsulates generation plan building and loader command execution contracts.
- `lsp/`: Implements language-server features for `board.yaml` (diagnostics, completion, hover, symbols, quick fixes, and command-backed previews).
- `project/`: Resolves workspace, SDK, and toolchain context from settings and folder layout.
- `validation/`: Builds and analyzes board validation commands and outputs.
- `west/`: Handles west build/flash/run planning and execution orchestration.

## Design Rule

Each module keeps reusable business logic in `service.ts` or `adapterCore.ts`, while runtime/editor interactions live in `vscodeAdapter.ts` or command-facing files.