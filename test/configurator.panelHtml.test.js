const test = require("node:test");
const assert = require("node:assert/strict");
const { createConfiguratorPanelHtml } = require("../packages/alp-core/dist/configurator/panelHtml.js");

test("shell html exposes the sidebar, main mount, and footer actions", () => {
  const html = createConfiguratorPanelHtml({ nonce: "n0", cspSource: "vscode-resource:", cssUri: "c.css", jsUri: "j.js", logoUri: "logo.svg" });
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /nonce="n0"/);
  assert.match(html, /id="alp-sidebar"/);
  assert.match(html, /id="alp-main"/);
  assert.match(html, /id="alp-save"/);
  assert.match(html, /id="alp-reload"/);
});
