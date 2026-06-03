---
name: New UI Component
description: Create a new shared design-system component with CSS Module, accessibility, and VS Code theme support.
tools:
  - read
  - edit
  - create
---

Create a new shared UI component called **$COMPONENT_NAME** for the design system.

## Spec

Purpose: $COMPONENT_DESCRIPTION
Props: $PROPS_DESCRIPTION
Variants (if any): $VARIANTS

## Requirements

1. **File location**: `webview-ui/src/shared/ui/$COMPONENT_NAME.tsx` + `$COMPONENT_NAME.module.css`

2. **TypeScript interface** — export `interface $COMPONENT_NAMEProps` with full JSDoc on non-obvious props.

3. **CSS module** — all styles in `$COMPONENT_NAME.module.css`:
   - Use `var(--vscode-*)` or token aliases for ALL colors
   - Use `var(--space-*)` for ALL spacing
   - Use `var(--radius-*)` for border radius
   - Use `var(--duration-*)` and `var(--ease-*)` for transitions
   - Variants via `[data-variant="..."]` selectors, not className logic

4. **Accessibility**:
   - Decorative icons: `aria-hidden="true"`
   - Interactive: proper `role`, `aria-label` or linked visible label
   - Loading state: `aria-busy="true"` or `role="status"`
   - Error state: `role="alert"`
   - Focus ring: handled globally via `:focus-visible` in `global.css` — do not add custom outline

5. **Barrel export** — add to `webview-ui/src/shared/ui/index.ts`:
   ```typescript
   export { $COMPONENT_NAME } from './$COMPONENT_NAME';
   export type { $COMPONENT_NAMEProps } from './$COMPONENT_NAME';
   ```

6. **Example usage** — show a one-line usage example after creating the files.

Check the existing components (Button, Card, Field, Skeleton, EmptyState, Badge) for patterns to follow.
