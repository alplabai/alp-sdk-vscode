---
name: New Feature
description: Scaffold a complete feature — message types, host handler, hook, view, and tab registration.
tools:
  - read
  - edit
  - create
---

I want to add a new feature called **$FEATURE_NAME** to this VS Code extension.

## What to build

The feature should: $FEATURE_DESCRIPTION

Data it needs from the extension host: $DATA_DESCRIPTION

## Steps to follow

1. **Message types** — Add to `src/shared/messages.ts`:
   - A `WebviewMessage` variant: `{ type: '$FEATURE_NAME:request', payload: { ... } }`
   - An `ExtensionMessage` variant: `{ type: '$FEATURE_NAME:data', payload: { ... } }`

2. **Extension host handler** — In `src/panels/MainPanel.ts` (or the appropriate panel):
   - Handle the new `WebviewMessage` type in `_handleMessage`
   - Implement the data-fetching or action logic
   - Respond with the `ExtensionMessage`

3. **Feature hook** — Create `webview-ui/src/features/$FEATURE_NAME/use$FEATURE_NAME.ts`:
   - Use `useAsync<DataType>()` for data fetching
   - Use `useRequest()` to call the host
   - Fetch on mount with `useEffect`
   - Return `{ state, ...actions }`

4. **Feature view** — Create `webview-ui/src/features/$FEATURE_NAME/$FEATURE_NAMEView.tsx`:
   - Import the hook
   - Show `<Skeleton lines={4} />` while loading
   - Show `<EmptyState ... />` for empty data or errors with a Retry button
   - Use `<Card>`, `<Stack>`, `<Row>` for layout
   - All colors via CSS tokens

5. **CSS module** — Create `$FEATURE_NAMEView.module.css`:
   - `.root { padding: var(--space-6); animation: fadeIn var(--duration-slow) var(--ease-out); }`

6. **Barrel** — Create `webview-ui/src/features/$FEATURE_NAME/index.ts`:
   - `export { $FEATURE_NAMEView } from './$FEATURE_NAMEView';`

7. **Register in App.tsx** — Add to the `tabs` array:
   - `{ id: '$FEATURE_NAME', label: '$DISPLAY_LABEL', content: <$FEATURE_NAMEView /> }`

8. **Package.json** (if a command is needed):
   - Add to `contributes.commands`
   - Register in `activate()` in `src/extension.ts`

After each step, confirm the file was created and show the key code section.
