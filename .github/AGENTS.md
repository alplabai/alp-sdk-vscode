# AGENTS.md

This is a VS Code extension project with a React + Vite webview UI.
Stack: TypeScript · React 19 · Vite 6 · Tailwind CSS 4 · pnpm workspaces.

---

## Project Structure

```
my-extension/
├── pnpm-workspace.yaml     # workspace: [webview-ui]
├── src/                    # Extension host (Node.js, full VS Code API)
│   ├── extension.ts        # activate() / deactivate()
│   ├── panels/             # WebviewPanel managers
│   ├── providers/          # WebviewViewProvider, TreeDataProvider
│   └── shared/
│       └── messages.ts     # Shared message types — imported by BOTH sides
├── webview-ui/             # React app (browser sandbox, no Node.js)
│   └── src/
│       ├── bridge/         # acquireVsCodeApi singleton, useBridge hook
│       ├── features/       # Feature-sliced: each feature owns state + UI
│       ├── shared/ui/      # Design-system components (CSS Modules)
│       └── styles/         # tokens.css (VS Code token aliases), global.css
├── esbuild.mjs             # Extension host bundler (external: ['vscode'])
└── .github/
    ├── copilot-instructions.md
    ├── agents/vsix-dev.agent.md
    └── instructions/
        ├── extension-host.instructions.md  (applyTo: src/**)
        └── webview-ui.instructions.md      (applyTo: webview-ui/**)
```

---

## Build & Dev Commands

```bash
pnpm install                    # install all workspaces
pnpm compile                    # build extension host (esbuild)
pnpm watch                      # watch extension host
pnpm dev:webview                # start Vite HMR server (port 5173)
pnpm build:webview              # production build of React app
pnpm run package                # vsce package → .vsix
```

Launch the extension: press **F5** in VS Code with the "Run Extension (Dev + HMR)" config.

---

## Architecture Constraints

- The webview is a sandboxed iframe with no Node.js access. All host↔webview communication is via `postMessage`. Never call Node.js APIs from `webview-ui/src/`.
- `src/shared/messages.ts` is the single source of truth for message types. Both sides import from it via `@shared/messages` path alias.
- `acquireVsCodeApi()` may only be called once. Use the singleton in `bridge/vscodeApi.ts`.
- Every `<script>` tag in webview HTML needs a `nonce` matching the CSP header. Generate a fresh nonce per render via `getNonce()`.
- Use `webview.asWebviewUri()` for every local asset URI.
- esbuild bundles the extension host with `external: ['vscode']`. Never bundle the vscode module.
- Vite config uses `base: './'` so asset paths are relative and survive URI replacement.

---

## Coding Standards

- All components use CSS Modules (`.module.css` co-located with `.tsx`).
- All colors and spacing via CSS custom properties: `var(--vscode-*)` directly, or semantic aliases in `tokens.css`. Never hardcode hex values.
- All async data flows use the `useAsync` hook for consistent loading/error/success state.
- All persistent UI state (active tab, scroll, form draft) uses `usePersistedState` so it survives webview hide/show.
- Animations via `--duration-*` and `--ease-*` tokens; `@media (prefers-reduced-motion)` sets these to 0ms automatically.
- Features do not import from each other. Shared data lives in `AppContext`.
- Shared UI components in `shared/ui/` have no bridge imports — they are pure presentational.
- `activationEvents: []` is correct for VS Code 1.74+.

---

## Testing

No test runner is configured yet. When adding tests:
- Extension host: use `@vscode/test-cli` + `@vscode/test-electron`.
- Webview: use `vitest` + `@testing-library/react` inside `webview-ui/`.

---

## Common Pitfalls

- Do NOT import from `webview-ui/src` inside `src/` — they are different runtimes.
- Do NOT add a CSP meta tag to `webview-ui/index.html` — the host injects it dynamically.
- Do NOT call `vscode.postMessage()` at render-time — only inside event handlers or `useEffect`.
- Do NOT use `retainContextWhenHidden: true` without good reason — prefer `getState/setState`.
- Do NOT `import 'vscode'` anywhere inside `webview-ui/` — it only exists in the host.
