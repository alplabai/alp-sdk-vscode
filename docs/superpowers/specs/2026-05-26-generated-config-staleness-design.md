# Generated-config Staleness — Design

**Date:** 2026-05-26
**Status:** Built autonomously — review in the morning.
**Branch:** feat/dev-tools

## Goal

Warn when the generated build inputs are **out of date** — i.e. `board.yaml` was
edited after `build/generated/*` were last written (or they're missing) — and
offer to regenerate. A new **`Alp: Check generated config`** command. Catches the
classic "edited the board but forgot to regenerate, built stale config" trap.

This is the non-hardware, non-python-dependent slice of the deferred
"generated-config viewer + diff": a true content diff needs to *run* the loader
(python) to produce the expected output, so it stays deferred; the staleness
check only needs file mtimes and is fully testable.

## What the generator writes

`listGenerationTargetSupport()` (`@alp-sdk/core/loader/service`) lists the four
targets and their output paths (relative to the workspace root):
`build/generated/alp.conf` (zephyr-conf), `alp.overlay` (dts-overlay),
`alp-cmake-args.txt` (cmake-args), `alp-yocto.conf` (yocto-conf).

## Architecture

### Pure core — `@alp-sdk/core/loader/staleness.ts`

```ts
export type GenerationStatus = "current" | "stale" | "missing";
export interface GenerationStalenessInput { emit: string; displayName: string; generatedMtimeMs: number | null; }
export interface GenerationStalenessEntry { emit: string; displayName: string; status: GenerationStatus; }
export interface GenerationStalenessReport { entries: GenerationStalenessEntry[]; stale: number; missing: number; ok: boolean; }

export function analyzeGenerationStaleness(
  boardMtimeMs: number | null,
  files: GenerationStalenessInput[],
): GenerationStalenessReport;
```
Per file: `generatedMtimeMs === null` → `missing`; else if `boardMtimeMs` is
non-null and `> generatedMtimeMs` → `stale`; else `current`. (When `boardMtimeMs`
is null — no board.yaml — an existing generated file is treated as `current`,
since there's nothing newer to compare against.) `ok` = no stale and no missing.
Pure; fully unit-tested.

### VS Code adapter — `src/generatedConfig.ts`

`alp.checkGeneratedConfig`:
1. `collectProjectContext()`; require `workspaceRoot` + `boardYamlPath`.
2. `boardMtimeMs` = `fs.statSync(boardYamlPath).mtimeMs` if it exists, else null.
3. For each `listGenerationTargetSupport()` target: `outputPath =
   path.join(workspaceRoot, target.outputRelativePath)`; `generatedMtimeMs` =
   `fs.statSync(outputPath).mtimeMs` if it exists, else null.
4. `report = analyzeGenerationStaleness(boardMtimeMs, files)`.
5. Write the report to the Alp output channel; show an info message:
   - `ok` → "Generated config up to date".
   - else → "Generated config — N stale, M missing" with actions **Generate all**
     (`alp.generateAll`) and **Show report** (output channel).

## Components & files

- Create core: `packages/alp-core/src/loader/staleness.ts`.
- Create adapter: `src/generatedConfig.ts`.
- Create test: `test/loader.staleness.test.js`.
- Modify: `src/extension.ts` (register), `package.json` (command `alp.checkGeneratedConfig`).

## Error handling

- No workspace / no board.yaml path → error message, abort.
- `statSync` on a non-existent file → treated as `null` mtime (missing), never throws.

## Testing

Pure core (`node:test`):
- board newer than a generated file → that entry `stale`; `ok:false`; `stale:1`.
- generated file `null` mtime → `missing`; `ok:false`; `missing:1`.
- generated newer than board → `current`.
- all current → `ok:true`, `stale:0`, `missing:0`.
- `boardMtimeMs: null` with an existing file → `current` (not stale).

Adapter (stat + message + action) verified in the dev host.

## Out of scope

- Content diff of generated files (needs running the python loader — deferred).
- Auto-regenerating (the command only offers the existing `Generate all`).
