# validation Module

## Purpose

The `validation` module owns board validation command planning and result interpretation.

## Main Responsibilities

- Build validator execution plans.
- Execute validator commands via adapter boundaries.
- Classify validator outcomes and severity.
- Produce structured validation issues for diagnostics and command output.

## Key Files

- `service.ts`: Validation plan and output-analysis logic.
- `models.ts`: Validation plan/result contracts.
- `adapterCore.ts`: Runtime-independent execution helpers.
- `vscodeAdapter.ts`: VS Code process and context integration.

## Notes

The module converts external validator process output into stable domain-level signals.