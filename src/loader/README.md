# loader Module

## Purpose

The `loader` module owns generation plan creation and loader execution behavior.

## Main Responsibilities

- Validate generation target requests.
- Build deterministic loader command plans.
- Execute loader plans through adapter boundaries.
- Summarize generation results for user-facing surfaces.

## Key Files

- `service.ts`: Target selection and plan construction logic.
- `models.ts`: Loader plan and result contracts.
- `adapterCore.ts`: Runtime-independent execution helpers.
- `vscodeAdapter.ts`: VS Code process and workspace integration.

## Notes

This module keeps generation behavior deterministic and testable.
