# debug Module

## Purpose

The `debug` module provides shared debug orchestration building blocks for VS Code commands and future CLI reuse.

## Main Responsibilities

- Build debug target and server option matrices.
- Generate debug profiles and launch drafts.
- Produce inspect, doctor, preflight, and support-bundle payloads.
- Keep debug models stable across UI and automation surfaces.

## Key Files

- `service.ts`: The `ALP:`/`Alp:` orphaned-configuration repair — pure planning
  only. Read its header before touching launch.json anywhere in this repo.
- `launchJsonFile.ts`: The `.vscode/launch.json` read/write seam (`fs` only).
- `vscodeAdapter.ts`: VS Code and file-system integration.

The debug workflows, models, panel HTML and runtime-independent adapter
utilities live in `packages/alp-core/src/debug/`, not here. Drafting a launch
configuration is `tan`'s job and belongs in neither (tan-cli, #387).

## Notes

The module focuses on debugger-aware orchestration, not implementing a debugger.