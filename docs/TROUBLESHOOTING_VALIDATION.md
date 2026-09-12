# Validation Troubleshooting

Last revised: 2026-05-14

This guide helps diagnose board.yaml validation failures.

## 1. Common Failure Types

- schema violations
- missing preset or unresolved metadata
- hardware revision mismatch
- unresolved board.yaml path
- unresolved sdk-root path

## 2. Fast Diagnostic Flow

1. Run validate in JSON mode.
2. Inspect exitCode and issues array.
3. Fix highest-severity issues first.
4. Re-run validate before generate/build.

Command:

tan validate --project . --sdk-root ../alp-sdk --format json > validate-report.json

## 3. Path Resolution Problems

If validate says board.yaml is unresolved:

- confirm workspace root
- confirm --board-yaml value
- confirm file exists on disk

If validate says sdk-root is unresolved:

- pass --sdk-root explicitly
- ensure scripts/alp_project.py exists under that root

## 4. Interpreting Exit Codes

- 0: clean validation
- 2: validation/config failure
- 1 or 5: runtime/internal issues

## 5. Editor Assistance

In VS Code, use board.yaml LSP features:

- diagnostics
- quick fixes
- hover guidance
- effective-config preview

These often shorten the fix loop before re-running CLI validate.

## 6. `memory:` Squiggle in `system-manifest.yaml`

An alp-sdk that carries alp-sdk#1365's `memory[]` pane can emit one inside
`build/system-manifest.yaml` (landed in alp-sdk#2030; not yet in a tagged
release, alp-sdk#2047). If this extension's bundled
`schemas/system-manifest-v1.schema.json` predates that producer, the
editor underlines `memory:` as an unknown property.

- This is a stale BUNDLED SCHEMA, not a bad manifest — the file itself is
  fine and the Build Plan panel's Memory tab reads it normally.
- Confirm by opening the panel: if the Memory tab shows a "SoM regions"
  table, the manifest parsed correctly regardless of the squiggle.
- Safe to ignore until the extension's next vendored-schema bump.
