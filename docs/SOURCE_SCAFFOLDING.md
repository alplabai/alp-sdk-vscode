# Source Scaffolding

Last revised: 2026-08-31

This guide covers project bootstrap and module scaffolding workflows.

## 1. Project Bootstrap with init

Initialize a new starter project:

tan init --template minimal-app --name demo-app --destination . --preview

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

tan scaffold --template sensor-driver --name sensor_mod --destination . --preview

Expected behavior:

- --name is required
- preview mode reports planned changes only
- without --force, overwrite-protected updates fail with explicit issue codes

## 3. VS Code Flows

Use Command Palette:

- Alp: New project wizard
- Alp: Scaffold module

Both flows run the CLI; neither generates project or module files itself.
`Alp: Scaffold module` runs `tan scaffold --preview` first, shows every path
the CLI reported in a confirmation dialog, and only then runs the write.

`--force` is never sent up front. When a file on disk differs from the
template, `tan scaffold` refuses with `scaffold.would-overwrite` and the
extension raises a second dialog naming those files. Only if you confirm that
dialog does it retry with `--force`; declining leaves every file untouched.
That retry REPLACES the named files: any edits in a previously scaffolded file
are lost, and the editor cannot undo it.

## 4. Template Discovery

Use explain to inspect available templates:

tan explain --format json

or target a template directly:

tan explain --template minimal-app --format json

## 5. Safety Model

- file changes are categorized as new, update, or unchanged
- update targets are blocked unless overwrite is explicit
- planning and execution are deterministic for a given template + input set

## 6. Wiring a Scaffolded Module Into the Build

Neither the CLI nor the extension edits your build files. A scaffolded module
is not compiled until you add it yourself, and `tan scaffold` writes the exact
lines into the module's `README.md` under `## Wiring`. Read that section: which
edit applies depends on the project template — most build Zephyr's `app`
target, while `minimal-app` builds `alp_app` and needs the source entry only.

Without the source entry the module is never compiled; without an include
directory `#include "modules/<name>.h"` does not resolve.
