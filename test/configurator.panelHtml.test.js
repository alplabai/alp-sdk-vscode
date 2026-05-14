const test = require("node:test");
const assert = require("node:assert/strict");

const { createConfiguratorPanelHtml } = require("../out/configurator/panelHtml.js");

test("createConfiguratorPanelHtml includes core sections and script nonce", () => {
  const html = createConfiguratorPanelHtml({
    nonce: "12345",
    cspSource: "vscode-webview://panel",
    cssUri: "vscode-webview://panel/media/configurator.css",
    jsUri: "vscode-webview://panel/media/configurator.js",
  });

  assert.match(html, /ALP Board Configurator/);
  assert.match(html, /section-project/);
  assert.match(html, /section-features/);
  assert.match(html, /section-review/);
  assert.match(html, /nonce-12345/);
  assert.match(html, /configurator\.js/);
});
