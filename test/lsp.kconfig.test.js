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

test("completePrjConf merges live symbols, curated/generated winning on collision", () => {
  const items = completePrjConf("CONFIG_", ["ALP_FOO", "MAIN_STACK_SIZE"]);
  const foo = items.find((i) => i.label === "CONFIG_ALP_FOO");
  assert.ok(foo, "a live-only symbol must be offered");
  assert.equal(foo.detail, "Kconfig symbol");
  assert.match(foo.doc, /active SDK/);

  // MAIN_STACK_SIZE is curated: exactly one entry, with the curated prose/type,
  // not overridden or duplicated by the live one of the same name.
  const stackSize = items.filter((i) => i.label === "CONFIG_MAIN_STACK_SIZE");
  assert.equal(stackSize.length, 1);
  assert.equal(stackSize[0].detail, "int");
  assert.match(stackSize[0].doc, /Stack size/);
});

test("completePrjConf with no liveSymbols behaves exactly as before", () => {
  assert.deepEqual(
    completePrjConf("CONFIG_MAIN"),
    completePrjConf("CONFIG_MAIN", []),
  );
});

test("lint diagnostics carry correct ranges (spaced + indented assignments)", () => {
  // Spaced '=': the underline must start at the VALUE, not at the '='.
  const spaced = lintPrjConf("CONFIG_ALP_SDK = 123");
  assert.equal(spaced.length, 1);
  assert.equal(spaced[0].line, 0);
  assert.equal(spaced[0].startCol, 17); // "CONFIG_ALP_SDK = " is 17 chars
  assert.equal(spaced[0].endCol, 20);
  // Indented, no spaces: same value position math.
  const indented = lintPrjConf("  CONFIG_ALP_SDK=123");
  assert.equal(indented.length, 1);
  assert.equal(indented[0].startCol, 17);
  assert.equal(indented[0].endCol, 20);
});

test("curated ALP symbols match the SDK's real Kconfig names", () => {
  // The 4 always-on peripheral surfaces have no PERIPH_* enable upstream, and
  // there are no umbrella ALP_RPC/ALP_INFERENCE/ALP_SECURITY/ALP_IOT symbols —
  // fabricated names here would make completion insert build-breaking lines.
  const names = new Set(KCONFIG_SYMBOLS.map((s) => s.name));
  for (const fabricated of [
    "ALP_SDK_LOG_LEVEL",
    "ALP_SDK_PERIPH_GPIO",
    "ALP_SDK_PERIPH_I2C",
    "ALP_SDK_PERIPH_SPI",
    "ALP_SDK_PERIPH_UART",
    "ALP_RPC",
    "ALP_INFERENCE",
    "ALP_SECURITY",
    "ALP_IOT",
  ]) {
    assert.ok(!names.has(fabricated), `${fabricated} is not a real SDK symbol`);
  }
  for (const real of ["ALP_SDK", "ALP_SDK_RPC", "ALP_SDK_SECURITY"]) {
    assert.ok(names.has(real), `${real} should be curated`);
  }
});

test("every curated ALP_* symbol is a real SDK Kconfig symbol (drift gate)", () => {
  // The fabricated/real check above is a fixed list — it can't catch a NEW
  // fabrication or an upstream rename/removal. Gate the curated ALP_* names
  // against a VENDORED snapshot of the SDK's `config ALP_*` symbols
  // (schemas/alp-kconfig-symbols.txt, re-vendored by scripts/vendor-kconfig-symbols.mjs).
  // Vendored — like schemas/*.json — so CI never reads the submodule working
  // tree (which CI checks out unreliably for the deep alp-sdk-upstream history).
  const fs = require("node:fs");
  const path = require("node:path");
  const p = path.join(__dirname, "fixtures", "alp-kconfig-symbols.txt");
  const vendored = new Set(
    fs
      .readFileSync(p, "utf-8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#")),
  );
  // alp-sdk#458 split the monolith into zephyr/Kconfig (1 symbol) + ~16
  // rsourced fragments (~340 ALP_* symbols total). A vendor run that only
  // reads the old fixed 2-file list (or stops following includes) would
  // silently shrink this to ~75 while the old "curated (subset) vendored"
  // check below still passes — this floor catches that collapse.
  assert.ok(
    vendored.size > 250,
    `vendored Kconfig symbol set looks truncated (${vendored.size} symbols) — ` +
      "did vendor-kconfig-symbols.mjs stop following rsource/source includes?",
  );
  const curatedAlp = KCONFIG_SYMBOLS.map((s) => s.name).filter((n) =>
    n.startsWith("ALP_"),
  );
  assert.ok(curatedAlp.length > 0, "expected curated ALP_* symbols");
  const missing = curatedAlp.filter((n) => !vendored.has(n));
  assert.deepEqual(
    missing,
    [],
    `curated ALP_* symbol(s) [${missing.join(", ")}] are not in the vendored SDK ` +
      "Kconfig symbol set — renamed/removed upstream or fabricated; completion " +
      "would insert undefined-symbol lines that break builds. Re-vendor with " +
      "scripts/vendor-kconfig-symbols.mjs, or fix the curated list in src/lsp/kconfig.ts.",
  );
});

test("hoverPrjConf returns markdown for known symbols, null otherwise", () => {
  assert.match(hoverPrjConf("CONFIG_ALP_SDK") ?? "", /CONFIG_ALP_SDK/);
  assert.match(hoverPrjConf("MAIN_STACK_SIZE") ?? "", /stack/i);
  assert.equal(hoverPrjConf("CONFIG_NOT_A_REAL_SYMBOL"), null);
});

test("every symbol has a non-empty doc, and a valid type when it claims one", () => {
  for (const s of KCONFIG_SYMBOLS) {
    assert.ok(s.name && s.doc, `symbol ${s.name} needs a doc`);
    // `type` is OPTIONAL by design: entries harvested from metadata/ carry one
    // only where the harvest could prove it (see
    // scripts/vendor-kconfig-metadata.mjs). An absent type must stay absent —
    // lintPrjConf keys its value check on `type === "bool"`, so inventing a
    // type here would turn silence into a wrong diagnostic.
    if (s.type !== undefined) {
      assert.ok(
        ["bool", "int", "hex", "string"].includes(s.type),
        `symbol ${s.name} has an invalid type ${JSON.stringify(s.type)}`,
      );
    }
  }
});

test("an untyped symbol is never value-linted", () => {
  const untyped = KCONFIG_SYMBOLS.find((s) => s.type === undefined);
  assert.ok(untyped, "expected at least one harvested untyped symbol");
  // A bool-shaped violation on a typed symbol warns; the same shape on an
  // untyped one must stay silent rather than guess.
  assert.equal(lintPrjConf(`CONFIG_${untyped.name}=7\n`).length, 0);
  assert.equal(lintPrjConf("CONFIG_ALP_SDK=7\n").length, 1);
});

test("the compiled metadata copy is not stale", () => {
  // `tsc --build` is incremental and re-copies src/**/*.json into out/ only
  // when a .ts file changed. Re-running scripts/vendor-kconfig-metadata.mjs
  // touches no .ts, so out/lsp/generated/kconfig-metadata.json silently keeps
  // the PREVIOUS harvest — and every test here, which loads out/, then passes
  // against stale data. This bit during development (out/ held 88 typed
  // symbols while src/ held 165). Fail loudly instead.
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (p) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, "..", p), "utf-8"));

  const src = read("src/lsp/generated/kconfig-metadata.json");
  const out = read("out/lsp/generated/kconfig-metadata.json");
  assert.deepEqual(
    out,
    src,
    "out/lsp/generated/kconfig-metadata.json is stale relative to src/ — " +
      "run `pnpm exec tsc --build --force` after re-vendoring.",
  );
});

test("the generated metadata layer is merged in, and curated entries win", () => {
  const byName = new Map(KCONFIG_SYMBOLS.map((s) => [s.name, s]));

  // Harvested from metadata/chips/*.yaml — proof the generated layer landed.
  // (A4988 stepper driver; a real chip_id, not a placeholder.)
  const chip = byName.get("ALP_SDK_CHIP_A4988");
  assert.ok(chip, "expected a harvested chip symbol in the merged table");
  assert.equal(chip.type, "bool");
  assert.match(chip.source ?? "", /^metadata\/chips\//);

  // Curated entry keeps its hand-written prose even though the harvest also
  // reaches ALP_SDK (via zephyr/Kconfig).
  const sdk = byName.get("ALP_SDK");
  assert.ok(sdk);
  assert.equal(sdk.source, undefined, "curated entry must win over harvested");

  assert.ok(
    KCONFIG_SYMBOLS.length > 150,
    `merged table looks truncated (${KCONFIG_SYMBOLS.length}) — did ` +
      "scripts/vendor-kconfig-metadata.mjs fail to harvest metadata/?",
  );
});
