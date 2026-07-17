# Source Scaffolding

Last revised: 2026-05-14

This guide covers project bootstrap and module scaffolding workflows.

## 1. Project Bootstrap with init

Initialize a new starter project:

alp init --template minimal-app --name demo-app --destination . --preview

Key flags:

- --template
- --name
- --destination
- --preview
- --force

Expected behavior:

- preview mode reports planned file changes without writing files
- non-preview mode writes files and reports written versus unchanged
- without --force, overwrite-protected paths return exit code 3

## 2. Module Scaffolding with scaffold

Add module starter files to an existing project:

alp scaffold --template sensor-driver --name sensor_mod --destination . --preview

Expected behavior:

- --name is required
- preview mode reports planned changes only
- without --force, overwrite-protected updates fail with explicit issue codes

## 3. VS Code Flows

Use Command Palette:

- Alp: New project wizard
- Alp: Scaffold module

Both flows use the same shared planning logic as CLI handlers.

## 4. Template Discovery

Use explain to inspect available templates:

alp explain --format json

or target a template directly:

alp explain --template minimal-app --format json

## 5. Safety Model

- file changes are categorized as new, update, or unchanged
- update targets are blocked unless overwrite is explicit
- planning and execution are deterministic for a given template + input set
