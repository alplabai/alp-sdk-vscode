// SPDX-License-Identifier: Apache-2.0
//
// Pins the webview Content-Security-Policy. Nothing else asserts on it: the
// in-host e2e drives every command but never inspects the shell's markup, and
// the jsdom render harness never sees this file at all. A CSP silently widened
// back to 'unsafe-inline' would pass both.
//
// Loads the compiled out/ideHub/webviewHtml.js under a fake `vscode` (the same
// Module._load swap test/util.terminalFinish.test.js uses) so the real shell
// string is asserted, not a copy of it that can drift.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

const fakeVscode = {
  Uri: {
    joinPath: (base, ...parts) => ({
      fsPath: [base.fsPath, ...parts].join("/"),
      toString: () => [base.fsPath, ...parts].join("/"),
    }),
  },
};

function loadWebviewHtml() {
  const modPath = require.resolve(
    path.join(root, "out", "ideHub", "webviewHtml.js"),
  );
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request === "vscode"
      ? fakeVscode
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

const CSP_SOURCE = "vscode-webview://test-source";

function render(mode) {
  const { buildWebviewHtml } = loadWebviewHtml();
  const webview = {
    cspSource: CSP_SOURCE,
    asWebviewUri: (uri) => `https://webview.test/${uri.fsPath}`,
  };
  return buildWebviewHtml(webview, { fsPath: "/ext" }, mode);
}

/** The `content="..."` of the CSP meta tag. */
function cspOf(html) {
  const match = html.match(
    /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]+)"/,
  );
  assert.ok(match, "no Content-Security-Policy meta tag in the shell");
  return match[1];
}

/** One directive's value, e.g. directive(csp, "style-src"). */
function directive(csp, name) {
  const found = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `) || d === name);
  assert.ok(found, `no ${name} directive in: ${csp}`);
  return found.slice(name.length).trim();
}

test("webview CSP: style-src allows no 'unsafe-inline'", () => {
  const csp = cspOf(render("sidebar"));
  const styleSrc = directive(csp, "style-src");
  assert.ok(
    !styleSrc.includes("unsafe-inline"),
    `style-src must not allow 'unsafe-inline', got: ${styleSrc}`,
  );
  // Both are load-bearing: cspSource serves the external dist/main.css, the
  // nonce covers the shell's own <style> block.
  assert.ok(
    styleSrc.includes(CSP_SOURCE),
    `style-src must allow the webview cspSource, got: ${styleSrc}`,
  );
  assert.match(styleSrc, /'nonce-[^']+'/, "style-src must carry the nonce");
});

test("webview CSP: script-src is nonce-only", () => {
  const csp = cspOf(render("sidebar"));
  const scriptSrc = directive(csp, "script-src");
  assert.ok(
    !scriptSrc.includes("unsafe-inline"),
    `script-src must not allow 'unsafe-inline', got: ${scriptSrc}`,
  );
  assert.ok(
    !scriptSrc.includes("unsafe-eval"),
    `script-src must not allow 'unsafe-eval', got: ${scriptSrc}`,
  );
  assert.match(scriptSrc, /'nonce-[^']+'/, "script-src must carry the nonce");
});

test("webview shell emits no inline style attribute", () => {
  // A style="" in the shell's markup is dropped under the CSP above, so it
  // would fail silently — the element renders unstyled, nothing errors.
  const html = render("sidebar");
  assert.ok(
    !/\sstyle="/.test(html),
    'shell must not use style="" attributes; put the rule in the nonce\'d <style>',
  );
});

test("webview shell tags <style> and every <script> with the nonce", () => {
  const html = render("sidebar");
  const nonce = cspOf(html).match(/'nonce-([^']+)'/)[1];
  for (const tag of html.match(/<(?:script|style)\b[^>]*>/g) ?? []) {
    assert.ok(
      tag.includes(`nonce="${nonce}"`),
      `untagged inline tag would be blocked by the CSP: ${tag}`,
    );
  }
});

test("webview CSP: nonce is fresh per render", () => {
  const first = cspOf(render("sidebar")).match(/'nonce-([^']+)'/)[1];
  const second = cspOf(render("sidebar")).match(/'nonce-([^']+)'/)[1];
  assert.notEqual(
    first,
    second,
    "a reused nonce lets markup captured from one render execute in the next",
  );
});
