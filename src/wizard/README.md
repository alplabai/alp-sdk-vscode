# wizard Module

## Purpose

The `wizard` module provides first-run and on-demand project creation workflows.

## Main Responsibilities

- Collect template, hardware, and feature selections.
- Build deterministic starter file plans.
- Render pre-write preview summaries, scaffold tree view, and generated-output snapshots.
- Write planned files through adapter boundaries.

## Key Files

- `service.ts`: Pure wizard planning and preview rendering.
- `models.ts`: Wizard contracts for inputs, plans, and file changes.
- `vscodeAdapter.ts`: File change detection, generated-output snapshots, and write helpers.

## Notes

Wizard output is intentionally deterministic so previews match writes.
