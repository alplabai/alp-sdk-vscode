const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pkg = require("../package.json");

// Guards the prj.conf syntax-highlighting wiring. VS Code loads the grammar
// lazily at runtime, so a broken path, a scopeName mismatch, or malformed JSON
// fails silently (no colours) rather than at package time — this catches all
// three in CI.
test("prj-conf language + grammar are contributed and wired", () => {
  const lang = (pkg.contributes.languages || []).find(
    (l) => l.id === "prj-conf",
  );
  assert.ok(lang, "expected a prj-conf language contribution");
  assert.ok(
    (lang.filenamePatterns || []).includes("prj*.conf"),
    "prj-conf must claim prj*.conf so board fragments get the grammar",
  );

  const g = (pkg.contributes.grammars || []).find(
    (x) => x.language === "prj-conf",
  );
  assert.ok(g, "expected a prj-conf grammar contribution");
  assert.equal(g.scopeName, "source.prj-conf");

  // Both referenced files exist and parse.
  for (const rel of [lang.configuration, g.path]) {
    const p = path.join(__dirname, "..", rel);
    assert.ok(fs.existsSync(p), `${rel} referenced by package.json is missing`);
    JSON.parse(fs.readFileSync(p, "utf-8")); // throws on malformed
  }

  // The grammar's own scopeName must match what the contribution claims — a
  // mismatch loads the grammar under a scope nothing references, so nothing
  // gets coloured.
  const grammar = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", g.path), "utf-8"),
  );
  assert.equal(grammar.scopeName, "source.prj-conf");
  assert.ok(
    Array.isArray(grammar.patterns) && grammar.patterns.length > 0,
    "grammar must have top-level patterns",
  );
});
