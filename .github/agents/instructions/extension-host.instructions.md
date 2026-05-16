---
applyTo: "src/**"
---

# Extension Host Instructions

These instructions apply to all files under `src/` (extension host, Node.js runtime).

## Lifecycle

`activate(context)` is the entry point. Push every disposable to `context.subscriptions` — VS Code will dispose them when the extension deactivates.

```typescript
// Correct — always push to subscriptions
context.subscriptions.push(
    vscode.commands.registerCommand('myExt.open', () => { ... }),
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, new SidebarProvider(context)),
);
```

## WebviewPanel

Use the `MainPanel` singleton pattern: `static currentPanel: MainPanel | undefined`.
Call `panel.reveal()` if it already exists instead of creating a duplicate.
Always pass `localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist')]`.
Dispose the panel in `onDidDispose` and clear `MainPanel.currentPanel = undefined`.

## Message handling

Handle messages with a `switch` on `msg.type` — types come from `src/shared/messages.ts`.
Always send `{ type: 'init', payload: { ... } }` in response to the `'ready'` message from the webview.
For async operations, use the RPC pattern: receive `{ type: 'request', payload: { id, command } }` and respond with `{ type: 'response', payload: { id, result } }` or `{ type: 'response', payload: { id, error } }`.

## VS Code API patterns

Use `vscode.window.withProgress` for operations that take longer than 500ms.
Use `context.secrets` for API tokens — never `context.globalState` for sensitive data.
Use `vscode.workspace.getConfiguration('myExt').get<T>('key', defaultValue)` for settings.
Never use `vscode.window.showInputBox` for passwords — use `context.secrets.store`.

## getWebviewContent

Generate a fresh `nonce` on every call — never reuse nonces.
In dev mode (`VSCODE_DEBUG === 'true'`), load from `http://localhost:${WEBVIEW_DEV_PORT}`.
In prod, read `webview-ui/dist/index.html`, rewrite `./assets/` paths with `webview.asWebviewUri()`, inject `<meta http-equiv="Content-Security-Policy" ...>` with the nonce, and add `nonce="${nonce}"` to every `<script>` tag.
The CSP must include `default-src 'none'` and whitelist only what is needed.
