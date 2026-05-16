# Copilot Instructions

This repository is a VS Code extension with a React + Vite webview UI,
managed with pnpm workspaces. TypeScript everywhere.

## Package manager

Always use `pnpm` — never `npm` or `yarn`.
Use `pnpm --filter webview-ui <cmd>` to run commands in the webview workspace.
Use `pnpm dlx` instead of `npx`.

## Two runtimes — never mix

`src/` runs in Node.js (extension host). `webview-ui/src/` runs in the browser sandbox.
Never import Node.js modules (`fs`, `path`, `crypto`) inside `webview-ui/src/`.
Never import `vscode` inside `webview-ui/src/`.

## Shared types go in `src/shared/messages.ts`

Both sides import from `@shared/messages` (path alias defined in `webview-ui/tsconfig.json`).
Do not duplicate message type definitions.

## Message protocol

The webview sends `WebviewMessage` discriminated unions.
The host sends `ExtensionMessage` discriminated unions.
Add new message types to `src/shared/messages.ts` and handle them in both `_handleMessage` (host) and `onMessage` (webview).
Always send `{ type: 'ready' }` from the webview on mount before expecting any data from the host.

## Nonce + CSP

Generate a fresh nonce per call to `getWebviewContent()` using `getNonce()` in `src/panels/getWebviewContent.ts`.
Inject the CSP meta tag dynamically in `getWebviewContent.ts`, not in `webview-ui/index.html`.
Every `<script>` tag must have `nonce="${nonce}"`.

## Colors

Every color must use a `var(--vscode-*)` CSS variable or a semantic alias from `webview-ui/src/styles/tokens.css`.
Never use hardcoded hex, rgb, or hsl values.
The aliases are: `--text-primary`, `--text-secondary`, `--surface-bg`, `--surface-hover`, `--border-focus`, etc.

## Components

Components live in `webview-ui/src/shared/ui/`.
Each component has a co-located `.module.css` file (CSS Modules).
Use `data-*` attributes for variant styling, not dynamic class concatenation.
Import from the barrel: `import { Button, Card, Field } from '../../shared/ui'`.

## Async patterns

Use the `useAsync` hook for all data fetching — it provides `{ state, run, reset }`.
`state.status` is `'idle' | 'loading' | 'success' | 'error'`.
Show `<Skeleton />` for loading, `<EmptyState />` for empty/error — never a raw spinner.
Show a Retry button when `state.status === 'error'`.

## Feature structure

Each feature lives in `webview-ui/src/features/<name>/`.
Export only `<FeatureView>` from the `index.ts` barrel.
The view calls a `use<Feature>()` hook for all state and actions.
Features do not import from each other.

## Animations

Use `--duration-fast` (100ms), `--duration-base` (150ms), `--duration-slow` (250ms).
Use `--ease-out`, `--ease-in-out`, `--ease-spring` for easing.
All of these are automatically set to `0ms` under `prefers-reduced-motion` in `tokens.css`.
Never set `transition-duration` or `animation-duration` with hard-coded ms values.

## Accessibility

Every interactive element must be keyboard-accessible.
Icons are decorative: add `aria-hidden="true"`.
Form inputs must have a visible `<label>` connected via `htmlFor`/`id` (use `useId()`).
Error messages use `role="alert"`. Loading indicators use `role="status"` or `aria-busy="true"`.

## esbuild (extension host bundle)

`esbuild.mjs` at the repo root handles bundling.
`external: ['vscode']` is mandatory — vscode is provided by the runtime, never bundled.
Run `node esbuild.mjs` to build, `node esbuild.mjs --watch` for watch mode.
`NODE_ENV=production node esbuild.mjs` for minified production builds.

## Webview HTML (dev vs prod)

In dev mode (`VSCODE_DEBUG=true`), `getWebviewContent` loads from `http://localhost:5173`.
In prod mode, it reads `webview-ui/dist/index.html`, rewrites asset paths with `webview.asWebviewUri()`, and injects nonce + CSP.
The `base: './'` in `vite.config.ts` makes asset paths relative — this is required for URI rewriting to work.
