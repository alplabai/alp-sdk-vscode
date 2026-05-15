// VS Code webview API bridge.
// acquireVsCodeApi() is injected by the extension host — not available in the
// Vite dev server, so we fall back to a no-op stub.

import type { ExtToWebviewMessage, WebviewToExtMessage } from "./types";

interface VsCodeApi {
  postMessage(msg: WebviewToExtMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let _api: VsCodeApi | null = null;

function getApi(): VsCodeApi {
  if (_api) return _api;
  if (typeof acquireVsCodeApi !== "undefined") {
    _api = acquireVsCodeApi();
    return _api;
  }
  // Stub for local dev / Storybook
  _api = {
    postMessage: (msg) => console.log("[vscode stub] postMessage", msg),
    getState: () => null,
    setState: () => undefined,
  };
  return _api;
}

export function postMessage(msg: WebviewToExtMessage): void {
  getApi().postMessage(msg);
}

export function onMessage(
  handler: (msg: ExtToWebviewMessage) => void,
): () => void {
  const listener = (event: MessageEvent) =>
    handler(event.data as ExtToWebviewMessage);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
