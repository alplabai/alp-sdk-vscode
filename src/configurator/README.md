# configurator Module

## Purpose

The `configurator` module owns the board configuration model used by the configurator UI and related workflows.

## Main Responsibilities

- Parse YAML text into the board model.
- Normalize optional sections to stable output shape.
- Generate canonical board YAML text from the current model.
- Expose default catalog data for form-like experiences.

## Key Files

- `service.ts`: Parsing, normalization, and YAML generation logic.
- `models.ts`: Board model and catalog type definitions.
- `vscodeAdapter.ts`: Workspace/file integration for configurator operations.

## Notes

Normalization logic in this module is shared by multiple surfaces to reduce drift.