// SPDX-License-Identifier: Apache-2.0
//
// Side-effect module imported FIRST by the webview render harness: stands up a
// jsdom DOM + a captured acquireVsCodeApi so React (react-dom/client) and the
// webview components can render and post messages in a headless Node run.
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://alp.local/",
  pretendToBeVisual: true,
});

// jsdom implements no layout, so it ships no scrollIntoView — but a real VS
// Code webview has one, and handlers call it (SidebarHubView's
// scrollToSdkSection). Stubbing it keeps the error capture below reporting
// real defects instead of this environment gap.
dom.window.Element.prototype.scrollIntoView = function scrollIntoView() {};

const g = globalThis;

// An exception thrown inside an event listener is REPORTED, not propagated —
// the DOM spec says so, and jsdom obeys it. So `button.click()` returns
// normally even when the handler threw, and the try/catch around the click in
// ui-render.tsx can never fire. Without this capture the harness clicked 50
// buttons, swallowed every throw, and printed "0 problem(s)".
//
// React 19 does not rethrow a handler error synchronously either: it reports it
// via `reportError`, which surfaces as the same window `error` event. Both
// paths land here.
g.__ALP_ERRORS__ = [];
dom.window.addEventListener("error", (ev) => {
  const e = ev.error ?? ev.message;
  g.__ALP_ERRORS__.push(e instanceof Error ? e.message : String(e));
});
dom.window.addEventListener("unhandledrejection", (ev) => {
  const e = ev.reason;
  g.__ALP_ERRORS__.push(
    `unhandled rejection: ${e instanceof Error ? e.message : String(e)}`,
  );
});

g.window = dom.window;
g.document = dom.window.document;
// node 24 exposes a read-only global `navigator`; jsdom's is on window anyway.
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MessageEvent = dom.window.MessageEvent;
g.getComputedStyle = dom.window.getComputedStyle;
g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id) => clearTimeout(id);

// Capture every postMessage the webview sends (the "what does this button do").
// The bundled webview resolves a bare `acquireVsCodeApi` against globalThis, so
// define it there (not only on window) — otherwise it falls back to the console
// stub and the clicks are not observed.
g.__ALP_POSTED__ = [];
const vscodeApi = () => ({
  postMessage: (msg) => g.__ALP_POSTED__.push(msg),
  getState: () => undefined,
  setState: () => undefined,
});
g.acquireVsCodeApi = vscodeApi;
dom.window.acquireVsCodeApi = vscodeApi;

// Deliver an extension→webview message the way the real host does: a `message`
// event on window carrying the payload in `.data`. jsdom's postMessage requires
// a serializable structured clone, so dispatch a MessageEvent directly (the
// webview reads only `event.data`).
g.__ALP_POST_TO_WEBVIEW__ = (msg) => {
  const ev = new dom.window.Event("message");
  Object.defineProperty(ev, "data", { value: msg, enumerable: true });
  dom.window.dispatchEvent(ev);
};

module.exports = {};
