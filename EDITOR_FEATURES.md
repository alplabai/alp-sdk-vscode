# Editor Features (LSP)

Last revised: 2026-05-14

This document summarizes editor-facing LSP features for board.yaml.

## 1. Diagnostics

- schema and semantic diagnostics are produced through the language server
- issues are mapped to precise ranges where possible
- severity is split into error, warning, and suggestion

## 2. Completion

- top-level and nested key completion
- enum and known value suggestions (for example OS choices)
- completion behavior is context-aware to reduce noise

## 3. Hover

- hover text explains field semantics
- hover includes practical guidance for key config sections

## 4. Document Symbols

- symbol tree provides structural outline for board.yaml
- nested sections appear in the outline for faster navigation

## 5. Quick Fixes

- common missing-block suggestions (for example missing som block)
- generated fixes are conservative and deterministic

## 6. Effective Config Preview

- command-backed preview returns normalized effective config payload
- useful for understanding resolved values before generation/build

## 7. Related Commands

- Alp: Preview effective config (LSP)
- Alp: Validate board.yaml
- Alp: Generate all

## 8. Design Notes

- LSP module owns inline authoring intelligence
- core/shared service functions keep behavior deterministic and testable
- command surfaces call into shared logic instead of duplicating decisions
