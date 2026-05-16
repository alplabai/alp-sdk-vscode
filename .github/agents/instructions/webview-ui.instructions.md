---
applyTo: "webview-ui/**"
---

# Webview UI Instructions

These instructions apply to all files under `webview-ui/` (React app, browser sandbox).

## Runtime constraint

This code runs in a browser sandbox with no Node.js access. Never import `vscode`, `fs`, `path`, `crypto`, or any other Node.js built-in. The only bridge to VS Code is `vscode.postMessage()` via the singleton in `bridge/vscodeApi.ts`.

## State persistence

Use `usePersistedState(key, initial)` for any UI state that should survive when the panel is hidden and reshown (active tab, filter text, scroll position, form drafts).
Use React `useState` only for ephemeral state that does not need to survive hide/show.

## Data fetching

All async operations use `useAsync<T>()`. The hook returns `{ state, run, reset }`.
Call `run(somePromise)` to start the operation.
`state.status` is always one of `'idle' | 'loading' | 'success' | 'error'`.
Render `<Skeleton lines={N} />` for loading, `<EmptyState ... />` for empty and error states.
Always provide a Retry button when `state.status === 'error'`.

## Bridge usage

Import `useBridge` from `../../bridge/useBridge` (adjust relative path as needed).
Call `send({ type: '...', payload: { ... } })` only inside event handlers or `useEffect`, never at render time.
Register message handlers with `onMessage` inside `useEffect`; return the cleanup function to unregister.

```typescript
// Correct pattern
useEffect(() => {
    return onMessage((msg) => {
        if (msg.type === 'stateSync') { /* handle */ }
    });
}, [onMessage]);
```

## Colors and spacing

Every color must be a `var(--vscode-*)` variable or a semantic alias from `src/styles/tokens.css`.
Spacing must use `var(--space-N)` tokens (N = 1–12, corresponding to 2px–40px).
Border radius uses `var(--radius-sm)` (2px), `var(--radius-md)` (4px), `var(--radius-lg)` (6px).

```css
/* Correct */
color: var(--text-primary);
background: var(--surface-sidebar);
padding: var(--space-4) var(--space-6);

/* Wrong — never do this */
color: #cccccc;
background: #1e1e1e;
padding: 8px 16px;
```

## Animations

Transition with `var(--duration-base)` and `var(--ease-out)` for hover/focus effects.
Use `var(--duration-slow)` and `var(--ease-out)` for page-level `fadeIn` animations.
Use `var(--ease-spring)` only for playful interactions (not critical UI).

```css
/* Correct */
transition: background var(--duration-base) var(--ease-out);
animation: fadeIn var(--duration-slow) var(--ease-out);
```

## Component authoring

New shared components go in `src/shared/ui/` with a co-located `.module.css`.
Export from the barrel `src/shared/ui/index.ts`.
Use `data-variant`, `data-size`, `data-active` attributes to drive CSS variant logic — not dynamic class strings.
Provide accessible markup: `aria-label`, `aria-busy`, `aria-invalid`, `role` as appropriate.
Wrap form controls in `<Field>` (already in `shared/ui`) to get label + error + hint for free.

## Feature structure

New features go in `src/features/<name>/`.
Create `use<Name>.ts` (hook with state + actions), `<Name>View.tsx` (dumb view), and `components/` for sub-components.
Export only the view from `index.ts`: `export { NameView } from './<Name>View'`.
The view must not contain business logic — delegate to the hook.
Features must not import from other features.

## Accessibility

Label every `<input>`, `<select>`, `<textarea>` with a `<label>` via `htmlFor`/`id`. Use `useId()` to generate stable IDs.
Error messages must have `role="alert"` so screen readers announce them.
Loading states must have `aria-busy="true"` or `role="status"`.
Decorative icons must have `aria-hidden="true"`.
All interactive elements must work with keyboard: Tab/Shift+Tab for focus, Enter/Space for activation.
