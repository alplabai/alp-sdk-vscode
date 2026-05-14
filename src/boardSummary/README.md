# boardSummary Module

## Purpose

The `boardSummary` module provides a lightweight summary of `board.yaml` data for quick UI surfaces such as the status bar.

## Main Responsibilities

- Read the configured `board.yaml` path.
- Parse minimal fields needed for compact display.
- Return `null` safely when input is missing or invalid.

## Key Files

- `adapterCore.ts`: Pure logic for loading and parsing board summary data.
- `vscodeAdapter.ts`: VS Code-facing file system and workspace integration.
- `models.ts`: Summary data contracts used by callers.
- `service.ts`: Summary composition helpers.

## Notes

This module is intentionally narrow and optimized for fast, low-risk reads.