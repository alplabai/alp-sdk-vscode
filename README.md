# ALP SDK VS Code extension

First-class IDE support for projects built against the
[ALP SDK](https://github.com/alplabai/alp-sdk):

* **`board.yaml` LSP-native editing.** Inline diagnostics,
  completion, hover, symbols, quick fixes, and effective-config preview
  run through the language server.
* **`alp_project.py` loader commands.**  Generate Zephyr-conf /
  DTS overlay / CMake-args / Yocto-conf from `board.yaml` directly
  from the command palette.
* **`west` workflow wrappers** where build runs
  `validate board.yaml` -> `generate all` -> `west build`, plus
  dedicated `flash` / `run` wrappers with progress reporting.
* **Debug-aware orchestration.** Inspect, doctor, preflight,
  launch-profile planning, and support-bundle surfaces are available
  without embedding debugger implementation into the extension.

## Install

VS Code Marketplace: search for "ALP SDK".  Or grab the latest
`.vsix` from the [Releases page](../../releases) and install via
`Extensions: Install from VSIX`.

## Repo layout

```text
.
├── ARCHITECTURE_RULES.md    -- layering and dependency contract
├── BACKLOG.md               -- epic/issue tracking checklist
├── CLI.md                   -- CLI contract and exit-code policy
├── DEBUG.md                 -- debug support matrix and launch design
├── PLAN.md                  -- product roadmap and phased delivery
├── README.md
├── LICENSE                  -- Apache-2.0
├── package.json             -- VS Code extension manifest
├── tsconfig.json
├── src/                     -- TypeScript source
│   ├── README.md            -- source folder/module guide
│   ├── extension.ts         -- activation entry point
│   ├── bootstrap.ts         -- extension bootstrap and service wiring
│   ├── configuratorPanel.ts -- board.yaml panel surface
│   ├── diagnostics.ts       -- diagnostics surface wiring
│   ├── loader.ts            -- loader command surface
│   ├── debug.ts             -- debug command surface
│   ├── west.ts              -- west command surface
│   ├── statusBar.ts         -- status bar surface
│   ├── lsp/                 -- LSP client/server/service/commands
│   ├── validation/          -- validation plans and issue classification
│   ├── loader/              -- generation planning and execution contracts
│   ├── debug/               -- debug models and orchestration logic
│   ├── project/             -- workspace and toolchain context resolution
│   ├── boardSummary/        -- compact board summary parsing
│   ├── configurator/        -- board model parse/normalize/serialize
│   └── west/                -- west plan/orchestration logic
├── test/                    -- service and adapter-core unit tests
├── snippets/                -- board.yaml + main.c snippets
├── media/                   -- icons + walkthrough assets
└── alp-sdk-upstream/        -- git submodule -> alplabai/alp-sdk
                                (single source of truth for schemas)
```

## Documentation Map

- [ARCHITECTURE_RULES.md](ARCHITECTURE_RULES.md): Layering,
  dependency direction, and testing contracts.
- [PLAN.md](PLAN.md): Product goals and phased roadmap.
- [BACKLOG.md](BACKLOG.md): Epic and issue checklist with current
  implementation state.
- [CLI.md](CLI.md): Proposed CLI command families, output contract,
  and exit-code policy.
- [CI_EXAMPLES.md](CI_EXAMPLES.md): GitHub Actions and GitLab CI
  examples for ALP CLI validation/generation/doctor flows.
- [GETTING_STARTED_VSCODE.md](GETTING_STARTED_VSCODE.md): VS Code
  first-run workflow from install to validation and generation.
- [GETTING_STARTED_CLI.md](GETTING_STARTED_CLI.md): CLI-first workflow
  for local terminal and CI usage.
- [EDITOR_FEATURES.md](EDITOR_FEATURES.md): LSP/editor capabilities for
  board.yaml authoring.
- [GENERATION_OUTPUTS.md](GENERATION_OUTPUTS.md): Generation targets,
  output paths, and deterministic output expectations.
- [SOURCE_SCAFFOLDING.md](SOURCE_SCAFFOLDING.md): Project bootstrap and
  module scaffolding workflows.
- [TROUBLESHOOTING_VALIDATION.md](TROUBLESHOOTING_VALIDATION.md):
  Validation failure diagnosis and recovery flow.
- [TROUBLESHOOTING_GENERATION_CONFLICTS.md](TROUBLESHOOTING_GENERATION_CONFLICTS.md):
  Generation/scaffolding conflict handling and overwrite safety.
- [TROUBLESHOOTING_ENVIRONMENT.md](TROUBLESHOOTING_ENVIRONMENT.md):
  Runtime/toolchain troubleshooting for CLI and VS Code workflows.
- [TASK_RECIPES.md](TASK_RECIPES.md): Common GUI/CLI task mapping for
  daily workflows.
- [TEST_MATRIX.md](TEST_MATRIX.md): Test coverage map by surface and
  test type.
- [COMPATIBILITY_RULES.md](COMPATIBILITY_RULES.md): Backward
  compatibility guarantees for schema, generation targets, and CLI
  contracts.
- [RELEASE_GATES.md](RELEASE_GATES.md): Required release checks for
  core, LSP, UI, CLI, and docs.
- [PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md): Performance
  budgets and regression-check guidance.
- [DEBUG.md](DEBUG.md): Debug support matrix and launch strategy.
- [src/README.md](src/README.md): Source module map.
- [src/lsp/README.md](src/lsp/README.md): LSP module responsibilities.
- [src/debug/README.md](src/debug/README.md): Debug module boundaries.
- [src/loader/README.md](src/loader/README.md): Loader module responsibilities.
- [src/validation/README.md](src/validation/README.md): Validation module ownership.
- [src/project/README.md](src/project/README.md): Workspace/toolchain context rules.
- [src/wizard/README.md](src/wizard/README.md): First-run project wizard responsibilities.

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
* `adapterCore` for runtime-independent seam logic
* surface files such as commands, panels, status bar, and diagnostics
  for presentation and orchestration only

For the full implementation contract, see
[ARCHITECTURE_RULES.md](ARCHITECTURE_RULES.md).

For slice-level ownership and file conventions, see
[src/README.md](src/README.md) and each module-local README.

## License

Apache-2.0, same as the SDK.
