# ALP SDK VS Code extension

First-class IDE support for projects built against the
[ALP SDK](https://github.com/alplabai/alp-sdk):

* **`board.yaml` schema-aware editing.**  Inline hover docs +
  autocomplete + validation against the canonical
  `board-config-v1.schema.json`.  Schema comes from the
  alp-sdk submodule (see "Schema-sync" below) so the editor's
  view always matches the loader's view.
* **`alp_project.py` loader commands.**  Generate Zephyr-conf /
  CMake-args / Yocto-conf from `board.yaml` directly from the
  command palette.
* **`west` workflow wrappers** where build runs
  `validate board.yaml` -> `generate all` -> `west build`, plus
  dedicated `flash` / `run` wrappers with progress reporting.
* **Per-OS dependency bootstrap.**  Validates Zephyr / west /
  Yocto toolchain availability before running a build.

## Install

VS Code Marketplace: search for "ALP SDK".  Or grab the latest
`.vsix` from the [Releases page](../../releases) and install via
`Extensions: Install from VSIX`.

## Repo layout

```text
.
├── README.md
├── LICENSE                  -- Apache-2.0
├── package.json             -- VS Code extension manifest
├── tsconfig.json
├── src/                     -- TypeScript source
│   ├── extension.ts         -- activation entry point
│   ├── configuratorPanel.ts -- board.yaml editor
│   ├── diagnostics.ts       -- inline validator
│   ├── loader.ts            -- alp_project.py wrapper
│   ├── statusBar.ts
│   ├── west.ts              -- validate+generate+build, flash, run orchestration
│   └── ...
├── snippets/                -- board.yaml + main.c snippets
├── media/                   -- icons + walkthrough assets
└── alp-sdk-upstream/        -- git submodule -> alplabai/alp-sdk
                                (single source of truth for schemas)
```

## Why a separate repo

The extension previously lived at `alp-sdk/vscode/`.  Split out
because:

* **Different toolchain.**  TypeScript + esbuild + vsce against
  Node 18+; nothing in common with the SDK's CMake / Zephyr /
  Yocto build context.
* **Different release cadence.**  VS Code Marketplace releases
  follow extension-side changes; SDK quarterly tags lag.
* **Different contributors.**  Some folks build extensions, some
  build firmware -- splitting lowers the barrier for the former.

The alp-sdk consumer still gets a one-line install via the
Marketplace; no functionality changed.

## Schema-sync

The extension's schema-aware validation depends on
`alp-sdk-upstream/metadata/schemas/board-config-v1.schema.json`.
That submodule pins to an alp-sdk commit; the extension's
`package.json::contributes.yamlValidation.url` references the
exact submodule path.

When alp-sdk bumps the schema:

```bash
cd alp-sdk-upstream
git fetch && git checkout main
cd ..
git add alp-sdk-upstream
git commit -m "deps(alp-sdk): bump submodule to <sha>"
npm test          # re-runs the schema-snapshot tests
npm run package   # builds the .vsix against the new schema
```

## Build

```bash
git clone --recurse-submodules https://github.com/alplabai/alp-sdk-vscode.git
cd alp-sdk-vscode
npm install
npm run compile     # tsc -> out/
npm test            # compile + lightweight service / adapter tests
npm run package     # vsce package -> alp-sdk-<version>.vsix
```

Load the local build via `Extensions: Install from VSIX`.

## Development

Use `npm test` as the default verification step while changing the
extension.

The current test setup is intentionally lightweight:

* pure service modules are tested directly
* thin adapter seams with injected dependencies are tested without
  booting VS Code
* compile stays part of the test run so API drift is caught early

When changing architecture-sensitive code, prefer keeping this split:

* `service` for pure decision logic
* `vscodeAdapter` for VS Code, filesystem, and subprocess access
* surface files such as commands, panels, status bar, and diagnostics
  for presentation and orchestration only

For the full implementation contract, see
[ARCHITECTURE_RULES.md](ARCHITECTURE_RULES.md).

## License

Apache-2.0, same as the SDK.
