# v0.6 board.yaml Schema Alignment Plan

Issue: #72

## Goal

Make the VS Code extension, LSP, configurator, wizard, tests, and CLI-adjacent
helpers agree on the v0.6 `board.yaml` shape described by
`schemas/board.schema.json`.

The IDE must not suggest, generate, or normalize fields that its own schema
rejects.

## Current Gaps

- The schema forbids top-level `os` and defines runtime under `cores.<id>.os`.
- LSP completions and quick fixes still offer top-level `schema_version`,
  `carrier`, `os`, `inference`, `libraries`, and `iot`.
- The project wizard still uses the legacy v0.5 `BoardModel`.
- `packages/alp-core/src/configurator/service.ts` keeps legacy v0.5 types alive.
- Existing tests assert legacy behavior in LSP and wizard paths.

## Proposed PR Slices

1. Schema validity test harness
   - Add a small schema-validation helper for generated board fixtures.
   - Validate starter, wizard, and sample outputs against the vendored schema.
   - Keep this PR small and mechanical.

2. Wizard migration to `BoardConfig`
   - Replace legacy `BoardModel` in wizard planning with v0.6 `BoardConfig`.
   - Map selected OS/libraries/iot/inference onto the selected primary core.
   - Use SDK topology when available; otherwise use the existing fallback `app`
     core.
   - Update wizard preview text to speak in core terms.

3. LSP completion/hover/quick-fix migration
   - Remove schema-invalid top-level keys from completions.
   - Add contextual completions under `cores.<coreId>`.
   - Replace `Add missing os field` with a per-core quick fix.
   - Keep hover docs aligned with schema field paths.

4. Legacy configurator cleanup
   - Remove or quarantine the v0.5 `BoardModel` service.
   - Ensure active configurator paths use `BoardConfig`.
   - Add migration helper only if old files are intentionally supported.

5. Documentation and compatibility notes
   - Document v0.5-to-v0.6 migration behavior.
   - Call out intentionally unsupported top-level fields.

## Acceptance Criteria

- New project wizard emits schema-valid v0.6 `board.yaml`.
- LSP top-level completions contain only schema-valid top-level keys.
- LSP quick fixes never insert top-level `os`.
- Active configurator load/save paths operate on `BoardConfig`.
- Tests fail if generated board YAML violates `schemas/board.schema.json`.

## Test Plan

- `CI=true pnpm test`
- New schema-validation unit tests for wizard and starter outputs.
- Golden LSP tests for top-level and `cores.<id>` completion contexts.
- Round-trip tests: parse -> view model -> update -> serialize -> parse.

## Risks

- Existing users may still have v0.5 board files. If that compatibility matters,
  add an explicit migration command instead of silently accepting old shape.
- The wizard currently asks for one OS target; v0.6 is per-core. The first pass
  should map this to the primary generated core and defer multi-core UX to a
  follow-up configurator enhancement.
