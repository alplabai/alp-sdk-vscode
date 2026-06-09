const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isPrjConfPath,
  lintPrjConf,
  completePrjConf,
  hoverPrjConf,
  KCONFIG_SYMBOLS,
} = require("../out/lsp/kconfig.js");

test("isPrjConfPath matches prj.conf and variants, not other files", () => {
  assert.equal(isPrjConfPath("/p/prj.conf"), true);
  assert.equal(isPrjConfPath("/p/prj_debug.conf"), true);
  assert.equal(isPrjConfPath("/p/prj-release.conf"), true);
  assert.equal(isPrjConfPath("/p/board.yaml"), false);
  assert.equal(isPrjConfPath("/p/local.conf"), false);
});

test("lintPrjConf ignores blanks + comments, accepts valid assignments", () => {
  const text = [
    "# a comment",
    "",
    "CONFIG_MAIN_STACK_SIZE=2048",
    "CONFIG_ALP_SDK=y",
    "# CONFIG_LOG is not set",
  ].join("\n");
  assert.deepEqual(lintPrjConf(text), []);
});

test("lintPrjConf flags malformed lines", () => {
  // missing '='
  assert.equal(lintPrjConf("CONFIG_FOO y").length, 1);
  // lower-case symbol
  const lower = lintPrjConf("config_foo=y");
  assert.equal(lower.length, 1);
  assert.match(lower[0].message, /upper-case/);
  // empty value
  const empty = lintPrjConf("CONFIG_FOO=");
  assert.equal(empty.length, 1);
  assert.match(empty[0].message, /no value/);
  // boolean with a non-bool value (known symbol)
  const badBool = lintPrjConf("CONFIG_ALP_SDK=123");
  assert.equal(badBool.length, 1);
  assert.match(badBool[0].message, /boolean/);
});

test("completePrjConf offers symbols in key position, none after '='", () => {
  const items = completePrjConf("CONFIG_MAIN");
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.label.startsWith("CONFIG_")));
  const main = items.find((i) => i.label === "CONFIG_MAIN_STACK_SIZE");
  assert.ok(main && main.insertText.includes("="));
  assert.deepEqual(completePrjConf("CONFIG_LOG=y"), []);
});

test("hoverPrjConf returns markdown for known symbols, null otherwise", () => {
  assert.match(hoverPrjConf("CONFIG_ALP_SDK") ?? "", /CONFIG_ALP_SDK/);
  assert.match(hoverPrjConf("MAIN_STACK_SIZE") ?? "", /stack/i);
  assert.equal(hoverPrjConf("CONFIG_NOT_A_REAL_SYMBOL"), null);
});

test("every curated symbol has a non-empty doc + valid type", () => {
  for (const s of KCONFIG_SYMBOLS) {
    assert.ok(s.name && s.doc, `symbol ${s.name} needs a doc`);
    assert.ok(["bool", "int", "hex", "string"].includes(s.type));
  }
});
