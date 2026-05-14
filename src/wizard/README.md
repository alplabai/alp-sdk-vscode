# wizard Module

## Purpose

The `wizard` module provides first-run project creation and module-level scaffolding workflows.

## Main Responsibilities

- Collect template, hardware, and feature selections.
- Build deterministic starter file plans.
- Build deterministic module-level source/header scaffold plans for existing projects.
- Render pre-write preview summaries, scaffold tree view, and generated-output snapshots.
- Write planned files through adapter boundaries.

## Key Files

- `service.ts`: Pure wizard planning and preview rendering.
- `models.ts`: Wizard contracts for inputs, plans, and file changes.
- `vscodeAdapter.ts`: File change detection, generated-output snapshots, and write helpers.

## Notes

Wizard output is intentionally deterministic so previews match writes.
