# ALP SDK VSCode Extension — Project Context

## Repository layout

```text
.                        ← VS Code extension (TypeScript, pnpm workspace root)
├─ src/                  ← Extension source (entry: src/extension.ts)
├─ packages/
│  ├─ alp-core/          ← Shared domain logic (workspace dep @alp-sdk/core)
│  ├─ alp-cli/           ← Standalone Node.js CLI (to be migrated to Rust — see below)
│  └─ alp-webview/       ← Vite/React webview source; built output goes to media/
├─ media/                ← Webview assets included in VSIX (CSS, JS, images)
├─ schemas/              ← board.yaml JSON schema
├─ out/                  ← Compiled + bundled extension (git-ignored)
└─ vite.config.ts        ← vp (vite-plus) config: pack (bundle) + run (cache)
```

## Toolchain

| Tool | Role |
|------|------|
| pnpm v11 (`node-linker=hoisted`) | Package manager — flat node_modules so tsc/rolldown resolve deps without following symlinks |
| TypeScript 6 (`tsc --build`) | Compile extension + packages to JS for development |
| vp (vite-plus) — local `vite-plus ^0.1.22` | `vp pack`: bundle for packaging; `vp run`: cached script runner |
| @vscode/vsce v3 | VSIX packaging — always use `--no-dependencies` flag (see below) |

**vp reads only `vite.config.ts`**, not `vp.config.ts`.

## Build pipeline

```text
pnpm run compile
  → tsc --build                                    (extension src → out/)
  → pnpm --filter ./packages/alp-cli run compile  (alp-cli → packages/alp-cli/dist/)

pnpm run bundle     (= vp pack)
  → out/extension.js    ~657 KB  all deps bundled, vscode external
  → out/service.js      ~385 KB  shared chunk (required by extension.js)
  → out/lsp/server.js   ~116 KB  standalone LSP server

vscode:prepublish = compile + bundle
```

`alp-cli` uses its own esbuild bundle: `pnpm --filter ./packages/alp-cli run bundle`.

## VSIX packaging — key constraints

```bash
vp run package        # recommended entry point (cached)
pnpm run package      # direct: vsce package --no-dependencies
```

**`--no-dependencies` is mandatory.** `@vscode/vsce` v3 has no pnpm support — it falls back to `npm list --production` which reports every transitive devDep as missing (ELSPROBLEMS). This flag skips that check. Safe because all runtime deps are bundled by `vp pack`.

`pnpm.onlyBuiltDependencies` lives in `pnpm-workspace.yaml`, not `package.json` (pnpm v11 change).

VSIX result: ~18 files, ~260 KB. `.vscodeignore` excludes `node_modules/**`, `packages/**`, `.venv/**`, `alp-sdk-upstream/**`, `docs/**`, `dist/**`.

## vite.config.ts — pack config

```typescript
pack: {
  entry: { extension: 'src/extension.ts', 'lsp/server': 'src/lsp/server.ts' },
  platform: 'node',
  format: { cjs: { outputOptions: { entryFileNames: '[name].js', chunkFileNames: '[name].js' } } },
  outDir: 'out',
  dts: false,
  deps: { alwaysBundle: [/.+/], neverBundle: ['vscode'] },
}
```

**`run.tasks` must not reuse package.json script names** — vp throws a conflict error. Only `run: { cache: true }` is set at root level.

## Planned: alp-cli → Rust migration

`packages/alp-cli` is a Node.js/TypeScript CLI. The plan is to rewrite it in Rust as a native binary. Until the migration is complete, keep the TypeScript CLI as-is. When the Rust CLI lands:

- Remove `packages/alp-cli` from the pnpm workspace
- Update `pnpm-workspace.yaml` (remove alp-cli from packages)
- The Rust binary will be distributed separately (not bundled inside the VSIX)
- The VS Code extension will locate it via PATH or a configurable setting
