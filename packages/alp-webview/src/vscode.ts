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

/** Read a value from the webview's persisted state (survives reload + hide). */
export function getUiState<T>(key: string, fallback: T): T {
  const state = (getApi().getState() as Record<string, unknown> | null) ?? {};
  return key in state ? (state[key] as T) : fallback;
}

/** Merge a value into the webview's persisted state. */
export function setUiState(key: string, value: unknown): void {
  const state = (getApi().getState() as Record<string, unknown> | null) ?? {};
  getApi().setState({ ...state, [key]: value });
}

export function onMessage(
  handler: (msg: ExtToWebviewMessage) => void,
): () => void {
  const listener = (event: MessageEvent) =>
    handler(event.data as ExtToWebviewMessage);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
