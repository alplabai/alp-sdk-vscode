---
name: Add VS Code Command
description: Register a new VS Code command — package.json contribution, activation handler, optional keybinding and menu entry.
tools:
  - read
  - edit
---

Add a new VS Code command to the extension.

## Spec

Command ID: `$EXTENSION_ID.$COMMAND_NAME`
Display title: $DISPLAY_TITLE
Category: $CATEGORY (shown in Command Palette as "$CATEGORY: $DISPLAY_TITLE")
Icon (codicon): $ICON (e.g. `$(sync)`, `$(add)`, `$(trash)`)
Keybinding (optional): $KEYBINDING
Menu locations (optional): $MENUS (e.g. `editor/title`, `view/title`, `explorer/context`)
What it does: $DESCRIPTION

## Steps

1. **package.json `contributes.commands`** — add:
   ```json
   {
     "command": "$EXTENSION_ID.$COMMAND_NAME",
     "title": "$DISPLAY_TITLE",
     "category": "$CATEGORY",
     "icon": "$ICON"
   }
   ```

2. **package.json `contributes.keybindings`** (if keybinding provided):
   ```json
   {
     "command": "$EXTENSION_ID.$COMMAND_NAME",
     "key": "$KEYBINDING",
     "mac": "$MAC_KEYBINDING",
     "when": "$WHEN_CLAUSE"
   }
   ```

3. **package.json `contributes.menus`** (if menu locations provided):
   ```json
   "$MENU_LOCATION": [
     { "command": "$EXTENSION_ID.$COMMAND_NAME", "when": "$WHEN", "group": "navigation" }
   ]
   ```

4. **`src/extension.ts` in `activate()`** — register and push to subscriptions:
   ```typescript
   context.subscriptions.push(
       vscode.commands.registerCommand('$EXTENSION_ID.$COMMAND_NAME', async () => {
           // implementation
       })
   );
   ```

5. If the command opens or interacts with a webview panel, call the appropriate method on `MainPanel` or the relevant provider.

Show the diff for each file changed.
