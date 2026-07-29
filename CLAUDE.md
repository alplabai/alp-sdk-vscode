# CLAUDE.md

Operational guide for working in this repo. Last revised: 2026-07-20.

## What this is

`alp-sdk` — a VS Code extension (publisher `alplabai`, v0.3.0) giving first-class IDE
support for ALP SDK embedded projects: schema-aware `board.yaml` editing, per-OS
toolchain bootstrap, code generation (Zephyr conf / DTS overlay / CMake args / Yocto
conf), and `west build/flash/run` workflows. Targets Alif, Renesas, NXP across Zephyr,
Yocto, and baremetal.

A standalone CLI (`tan`) is developed and released separately, from
[`alplabai/tan-cli`](https://github.com/alplabai/tan-cli) — this repo no longer
ships or builds any CLI binary itself. The extension downloads and shells the
`tan` binary (see "The `tan` CLI" below); the former in-repo Rust CLI (`cli-rs/`)
and the TypeScript CLI (`packages/alp-cli`) have both been **retired**.

## Repo layout

This is a **pnpm monorepo** + a **git submodule**.

```
src/                      VS Code extension host (TypeScript). Entry: src/extension.ts
packages/alp-core/        Shared domain logic (pure). Published as @alp-sdk/core (workspace:*)
packages/alp-webview/     Activity Bar UI — React 19 + Vite, builds to dist/main.{js,css}
alp-sdk-upstream/         git submodule (github.com/alplabai/alp-sdk) — source of truth for
                          board.yaml JSON schemas referenced by package.json yamlValidation
test/                     Node-native tests (node --test). test/golden/ holds snapshots
out/, dist/, *.vsix       Build artifacts — gitignored, do not commit
```

`packages/alp-core` has no barrel; import from subpaths, e.g.
`import { ... } from "@alp-sdk/core/board/models"` (maps to `dist/*.js` via `exports`).

## Build / test / package

Toolchain: pnpm 11, Node 24 (CI pins 24; local may differ), TypeScript 6,
esbuild (extension bundle), Vite (webview, invoked as `vp build`), `vsce` (packaging).

```bash
pnpm install --frozen-lockfile      # always; submodule schemas needed for full build
pnpm run compile                    # tsc --build + webview (vp build)
pnpm run contract:fetch             # once per clone/pin bump; pnpm test FAILS without it
pnpm test                           # compiles, then node --test test/*.test.js
pnpm run bundle:ext                 # esbuild src/extension.ts + src/lsp/server.ts -> out/
pnpm run package                    # full prepublish build, then vsce package --no-dependencies
pnpm run install:vscode             # build + package + install the VSIX locally
```

`vsce` runs with `--no-dependencies` because `workspace:*` deps are resolved at compile
time; only `packages/alp-webview/dist/**` is kept in the VSIX (see `.vscodeignore`).

## Architecture rules (enforced — see docs/ARCHITECTURE_RULES.md)

Strict four-layer contract with a one-directional dependency rule:

```
surface  ->  service        surface = src/extension.ts + top-level command/UI files
surface  ->  adapter        service = src/*/service.ts (PURE domain logic)
adapter  ->  service        adapter = src/*/vscodeAdapter.ts, src/*/adapterCore.ts
service  ->  models         models  = src/*/models.ts (types only)
```

Hard rules — do not break these:

- **Service layer is pure**: no `vscode`, `fs`, `child_process`, or terminal imports.
  Deterministic inputs/outputs only. This is what makes core shareable + testable.
- **Adapters may call services, never the reverse.** No `service -> adapter`.
- **No domain logic in surface files** — orchestration only (collect input, call
  service/adapter, map outcome to UX message).
- **No cross-slice copy-paste of domain rules.** Each concern has one owner.
- `src/project/service.ts` is the **single source of truth** for workspace root, SDK
  root, board.yaml path, west cwd, and python binary. Don't reimplement resolution.
- Validation classification lives in `src/validation/service.ts`; debug launch drafting
  in `src/debug/service.ts`; launch.json merge planning in `src/debug/launchJsonCore.ts`.

The same pure/adapter split is mirrored in `packages/alp-core`.

## Webview <-> extension host

Typed message protocol in `src/ideHub/messages.ts`, mirrored by `packages/alp-webview/src/types.ts`
(kept in sync **manually** — change both). A protocol version constant guards mismatches.
Extension pushes state down (`stateUpdate`, `sdkReleasesLoaded`, `sdkInstallProgress`,
`projectTemplatesData`); webview posts up (`ready`, `runCommand`, mutations).
Webview styling: CSS Modules + design tokens in `src/styles/tokens.css` + VS Code theme vars.

## board.yaml schema source

The board schema ships **vendored** at `schemas/board.schema.json` (so it's in the
VSIX — `alp-sdk-upstream/**` is excluded). It is derived from the `alp-sdk-upstream`
submodule's board schema; `package.json` `contributes.yamlValidation` points at the
vendored path. Presence + structure are enforced by `test/board.schema.vendored.test.js`
and the CI "vendored schema" step. After bumping the submodule, re-vendor by copying its
board schema over `schemas/board.schema.json` (the submodule's filename has varied across
versions — `board.schema.json` / `board-config-v2.schema.json`).

## The `tan` CLI (external, `alplabai/tan-cli`)

The build CLI is **not** part of this repo. It is the standalone native Rust
binary `tan`, developed and released from
[`alplabai/tan-cli`](https://github.com/alplabai/tan-cli) (public repo). What
this repo depends on and holds stable is the JSON output envelope — byte-for-byte
fixed (`{command, ok, exitCode, project, data, issues}`) with stable exit codes
(0 success, 1 runtime, 2 validation, 3 write, 4 doctor, 5 internal); see
docs/CLI.md for the full contract. This repo does not build, test, or release
`tan` — that CLI's own gates live in the `tan-cli` repo.

The VS Code extension resolves and shells `tan` via its own binary resolver
(`src/alpCli/`, setting `alpSdk.cliPath` → bundled → local build → cached →
verified-native PATH → download-on-demand), invoking it for bootstrap/build
(terminal) and validate/generate/sdk-list (envelope); host-coupled debug
commands stay in-process (see docs/EXTENSION_CLI_INTEGRATION.md §4a). See
docs/CLI.md for the command/envelope contract this repo depends on.

## Conventions

- TypeScript `strict` with `noUnused*` and `noImplicitReturns` on — keep it clean.
- Formatting: Prettier is the single source of truth (`pnpm run format` / `format:check`).
  Run it before committing; don't hand-format or rely on editor defaults.
- Tests are Node-native (`node --test`), no framework; they require compiled
  `packages/alp-core/dist`, so `pnpm run compile` runs first (the `test` script does this).
- Keep `test/golden/*` snapshots deterministic; loader plans must not drift.
- Before merging architecture-sensitive changes, run the docs/ARCHITECTURE_RULES.md §6 checklist.

## Docs map

All project docs live under `docs/` (the repo root holds only `README.md` +
this file). `docs/PLAN.md` / `docs/BACKLOG.md` (roadmap), `docs/ARCHITECTURE_RULES.md`
(the layer contract above), `docs/CLI.md` (CLI command families + output contract),
`docs/DEBUG.md`, `docs/RELEASE_GATES.md`, `docs/COMPATIBILITY_RULES.md`,
`docs/EXTENSION_CLI_INTEGRATION.md`, and the getting-started / troubleshooting guides.
`README.md` has the full index. All of `docs/**` is excluded from the VSIX.
(Note: the `tan` CLI's own roadmap lives in the `alplabai/tan-cli` repo, not here.)
