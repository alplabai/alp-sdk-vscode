# CLAUDE.md

Operational guide for working in this repo. Last revised: 2026-06-02.

## What this is

`alp-sdk` — a VS Code extension (publisher `alplabai`, v0.3.0) giving first-class IDE
support for ALP SDK embedded projects: schema-aware `board.yaml` editing, per-OS
toolchain bootstrap, code generation (Zephyr conf / DTS overlay / CMake args / Yocto
conf), and `west build/flash/run` workflows. Targets Alif, Renesas, NXP across Zephyr,
Yocto, and baremetal.

A standalone CLI (`alp`) ships separately. It is the **native Rust binary** under
`cli-rs/` (distributed via GitHub releases + the `cli-rs/npm-shim` npm package).
The former TypeScript CLI (`packages/alp-cli`) has been **retired** — the Rust CLI
is the sole implementation (see "Rust CLI migration" below).

## Repo layout

This is a **pnpm monorepo** + a separate **Rust workspace** + a **git submodule**.

```
src/                      VS Code extension host (TypeScript). Entry: src/extension.ts
packages/alp-core/        Shared domain logic (pure). Published as @alp-sdk/core (workspace:*)
packages/alp-webview/     Activity Bar UI — React 19 + Vite, builds to dist/main.{js,css}
cli-rs/                   The native `alp` CLI (own Cargo workspace, NOT in the VSIX).
                          Replaced the retired TypeScript packages/alp-cli.
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

The same pure/adapter split is mirrored in `packages/alp-core` and in `cli-rs/crates/alp-core`.

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

## Rust CLI (cli-rs/) — the `alp` binary

`cli-rs/` is the native `alp` CLI: a schema-first Rust rewrite that **replaced** the
former TypeScript `packages/alp-cli` (now retired). The JSON output envelope is
byte-for-byte fixed and exit codes are stable (0 success, 1 runtime, 2 validation,
3 write, 4 doctor, 5 internal). Parity is gated by `cli-rs/contract/run.sh`, which now
compares the Rust binary against **committed golden fixtures** (the TS reference is gone;
one small `offline-validate-ts.mjs` cross-checks the offline validator against
`@alp-sdk/core`). See `cli-rs/PLAN.md` for the roadmap.

Status: all 14 commands ported + the orchestration surface (`bootstrap`, `build`/`image`/
`flash`/`clean`/`renode`, `doctor --build`). First release `cli-rs-v0.1.0` (GitHub
archives for linux-x64 / macOS-arm64 / windows-x64). Distributed via the
`cli-rs/npm-shim` package (`@alplabai/alp-cli`) + the VS Code extension's binary resolver
(`src/alpCli/`, setting `alpSdk.cliPath` → PATH → download-on-demand). The extension now
invokes the CLI for bootstrap/build (terminal) and validate/generate/sdk-list (envelope);
host-coupled debug commands stay in-process (see docs/EXTENSION_CLI_INTEGRATION.md §4a).

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
(Note: `cli-rs/PLAN.md` is the CLI's own roadmap and stays under `cli-rs/`.)
