# CLAUDE.md

Operational guide for working in this repo. Last revised: 2026-06-02.

## What this is

`alp-sdk` — a VS Code extension (publisher `alplabai`, v0.3.0) giving first-class IDE
support for ALP SDK embedded projects: schema-aware `board.yaml` editing, per-OS
toolchain bootstrap, code generation (Zephyr conf / DTS overlay / CMake args / Yocto
conf), and `west build/flash/run` workflows. Targets Alif, Renesas, NXP across Zephyr,
Yocto, and baremetal.

A standalone CLI (`alp`) ships separately to npm. A Rust rewrite of that CLI is in
progress under `cli-rs/` (see "Rust CLI migration" below).

## Repo layout

This is a **pnpm monorepo** + a separate **Rust workspace** + a **git submodule**.

```
src/                      VS Code extension host (TypeScript). Entry: src/extension.ts
packages/alp-core/        Shared domain logic (pure). Published as @alp-sdk/core (workspace:*)
packages/alp-webview/     Activity Bar UI — React 19 + Vite, builds to dist/main.{js,css}
packages/alp-cli/         The TypeScript CLI published to npm (@alp-sdk/cli)
cli-rs/                   Rust rewrite of the CLI (own Cargo workspace, NOT in the VSIX)
alp-sdk-upstream/         git submodule (github.com/alplabai/alp-sdk) — source of truth for
                          board.yaml JSON schemas referenced by package.json yamlValidation
test/                     Node-native tests (node --test). test/golden/ holds snapshots
out/, dist/, *.vsix       Build artifacts — gitignored, do not commit
```

`packages/alp-core` has no barrel; import from subpaths, e.g.
`import { ... } from "@alp-sdk/core/board/models"` (maps to `dist/*.js` via `exports`).

## Build / test / package

Toolchain: pnpm 11, Node 22+ (CI uses 22; local may be newer), TypeScript 6,
esbuild (extension bundle), Vite (webview, invoked as `vp build`), `vsce` (packaging).

```bash
pnpm install --frozen-lockfile      # always; submodule schemas needed for full build
pnpm run compile                    # tsc --build + alp-cli compile + webview (vp build)
pnpm test                           # compiles, then node --test test/*.test.js
pnpm run bundle:ext                 # esbuild src/extension.ts + src/lsp/server.ts -> out/
pnpm run package                    # full prepublish build, then vsce package --no-dependencies
pnpm run install:vscode             # build + package + install the VSIX locally
```

`vsce` runs with `--no-dependencies` because `workspace:*` deps are resolved at compile
time; only `packages/alp-webview/dist/**` is kept in the VSIX (see `.vscodeignore`).

Rust CLI:

```bash
cargo build  --manifest-path cli-rs/Cargo.toml
cargo test   --manifest-path cli-rs/Cargo.toml
bash cli-rs/contract/run.sh          # conformance harness (TS vs Rust parity); --bless to update
```

## Architecture rules (enforced — see ARCHITECTURE_RULES.md)

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

The same pure/adapter split is mirrored in `packages/alp-core` and in `cli-rs/crates/alp-core`.

## Webview <-> extension host

Typed message protocol in `src/ideHub/messages.ts`, mirrored by `packages/alp-webview/src/types.ts`
(kept in sync **manually** — change both). A protocol version constant guards mismatches.
Extension pushes state down (`stateUpdate`, `sdkReleasesLoaded`, `sdkInstallProgress`,
`projectTemplatesData`); webview posts up (`ready`, `runCommand`, mutations).
Webview styling: CSS Modules + design tokens in `src/styles/tokens.css` + VS Code theme vars.

## board.yaml schema source

The JSON schema for `board.yaml` is **not** stored here — it comes from the
`alp-sdk-upstream` submodule (`metadata/schemas/board-config-v2.schema.json`, referenced
in `package.json` `contributes.yamlValidation`). Run `git submodule update --init` before
a full build, or the schema reference and CI schema-sync check will fail.

## Rust CLI migration (cli-rs/)

Schema-first rewrite of `packages/alp-cli`. The two CLIs share **no code**; parity is
guaranteed by a shared `cli-rs/contract/board.schema.json` + golden fixtures + a
conformance suite run against both (gated in CI). The JSON output envelope is byte-for-byte
fixed and exit codes are stable (0 success, 1 runtime, 2 validation, 3 write, 4 doctor,
5 internal). See `cli-rs/PLAN.md` for the 8-phase roadmap.

Status (phases 0–4 done): `validate`, `generate`, `init`, `scaffold` ported (4 of 14
commands). Next (phase 5): `doctor`, full `validate` with Python SDK spawn, and the
remaining commands. The Python-spawn strategy (shell vs napi-rs) is still undecided.
Until cutover (phase 7), npm continues to ship the TypeScript CLI.

## Conventions

- TypeScript `strict` with `noUnused*` and `noImplicitReturns` on — keep it clean.
- Formatting: Prettier is the single source of truth (`pnpm run format` / `format:check`).
  Run it before committing; don't hand-format or rely on editor defaults.
- Tests are Node-native (`node --test`), no framework; they require compiled
  `packages/alp-core/dist`, so `pnpm run compile` runs first (the `test` script does this).
- Keep `test/golden/*` snapshots deterministic; loader plans must not drift.
- Before merging architecture-sensitive changes, run the ARCHITECTURE_RULES.md §6 checklist.

## Docs map

`PLAN.md` / `BACKLOG.md` (roadmap), `ARCHITECTURE_RULES.md` (the layer contract above),
`CLI.md` (CLI command families + output contract), `DEBUG.md`, `RELEASE_GATES.md`,
`COMPATIBILITY_RULES.md`, and getting-started / troubleshooting guides. All are excluded
from the VSIX.
