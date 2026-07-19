// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseDotConfig,
  diagnoseAgainstBuild,
  resolveSlice,
} = require("../out/lsp/buildConfig.js");

// A real Zephyr .config excerpt (E1M-AEN801 slice m55_hp) — see the fixture's
// own header. Parsing is pinned against real bytes rather than a hand-written
// approximation, because .config's `is not set` form and quoted strings are
// exactly where a hand-rolled parser goes wrong.
const CONFIG_TEXT = fs.readFileSync(
  path.join(__dirname, "fixtures", "kconfig", "m55_hp.config"),
  "utf-8",
);

test("parseDotConfig reads every value shape in a real .config", () => {
  const cfg = parseDotConfig(CONFIG_TEXT);

  assert.equal(cfg.get("SERIAL"), "y");
  assert.equal(cfg.get("MAIN_STACK_SIZE"), "1024");
  assert.equal(cfg.get("HEAP_MEM_POOL_SIZE"), "0");
  assert.equal(cfg.get("BOARD"), '"alp_e1m_aen801_m55_hp"');
  assert.equal(cfg.get("BOARD_REVISION"), '""');
});

test("`# CONFIG_X is not set` is an assignment of n, not a comment", () => {
  const cfg = parseDotConfig(CONFIG_TEXT);
  // 579 of the 833 symbols in the full file take this form — reading it as a
  // comment would blind every comparison to the majority case.
  assert.equal(cfg.get("DEBUG"), "n");
  assert.equal(cfg.get("ALP_SDK"), "n");
  assert.equal(cfg.get("DEBUG_OPTIMIZATIONS"), "n");
});

test("a matching assignment produces no diagnostic", () => {
  const cfg = parseDotConfig(CONFIG_TEXT);
  assert.deepEqual(diagnoseAgainstBuild("CONFIG_SERIAL=y\n", cfg), []);
  assert.deepEqual(
    diagnoseAgainstBuild("CONFIG_MAIN_STACK_SIZE=1024\n", cfg),
    [],
  );
});

test("a quoted .config string matches the same text written unquoted", () => {
  const cfg = parseDotConfig(CONFIG_TEXT);
  assert.deepEqual(
    diagnoseAgainstBuild('CONFIG_BOARD="alp_e1m_aen801_m55_hp"\n', cfg),
    [],
  );
});

test("an overridden assignment is reported with both values", () => {
  const cfg = parseDotConfig(CONFIG_TEXT);
  // CONFIG_DEBUG is `# … is not set` in the build; asking for y loses.
  const [d] = diagnoseAgainstBuild("CONFIG_DEBUG=y\n", cfg);
  assert.ok(d, "expected a diagnostic for an overridden assignment");
  assert.match(d.message, /set to `y` here/);
  assert.match(d.message, /resolved it to `n`/);
  assert.equal(d.line, 0);
  assert.equal(d.severity, "warning");
});

test("a symbol absent from .config is reported as undefined, not as off", () => {
  const cfg = parseDotConfig(CONFIG_TEXT);
  // The case that fires on real data: alp-sample's src/prj.conf sets
  // CONFIG_NEWLIB_LIBC=y and the symbol never appears in the m55_hp build —
  // it is not declared for that slice's board target at all. Zephyr would have
  // written `# … is not set` had it merely been off, so the two are distinct
  // failures and must not share a message.
  assert.equal(cfg.has("NEWLIB_LIBC"), false);
  const [d] = diagnoseAgainstBuild("CONFIG_NEWLIB_LIBC=y\n", cfg);
  assert.ok(d, "expected a diagnostic for an undeclared symbol");
  assert.match(d.message, /not defined in this build's Kconfig tree/);
  assert.doesNotMatch(d.message, /did not take effect/);
});

test("comments, blanks and valueless lines are left to lintPrjConf", () => {
  const cfg = parseDotConfig(CONFIG_TEXT);
  const text = ["# a comment", "", "CONFIG_DEBUG=", "not an assignment"].join(
    "\n",
  );
  assert.deepEqual(diagnoseAgainstBuild(text, cfg), []);
});

test("the reported range covers the whole assignment line", () => {
  const cfg = parseDotConfig(CONFIG_TEXT);
  const line = "  CONFIG_DEBUG=y";
  const [d] = diagnoseAgainstBuild(`${line}\n`, cfg);
  assert.equal(d.startCol, 2, "starts after the indent");
  assert.equal(d.endCol, line.length);
});

// ── .config-trace.json ──────────────────────────────────────────────────────

const { parseConfigTrace } = require("../out/lsp/buildConfig.js");

const TRACE_TEXT = fs.readFileSync(
  path.join(__dirname, "fixtures", "kconfig", "m55_hp.config-trace.json"),
  "utf-8",
);

test("parseConfigTrace reads the positional tuple shape", () => {
  const trace = parseConfigTrace(TRACE_TEXT);
  const stack = trace.get("MAIN_STACK_SIZE");
  assert.ok(stack, "expected CONFIG_MAIN_STACK_SIZE in the trace");
  assert.equal(stack.value, "1024");
  assert.equal(stack.type, "int");
  assert.equal(stack.kind, "assign");
  assert.equal(stack.line, 26);
  assert.match(stack.file, /\.config$/);
});

test("parseConfigTrace survives a format it does not recognise", () => {
  // The format is coupled to traceconfig.py and shifts silently when a field
  // is inserted, so a bad shape must degrade to "no detail" — never throw and
  // take the diagnostics pass down with it.
  assert.equal(parseConfigTrace("{ not json").size, 0);
  assert.equal(parseConfigTrace('{"symbols":[]}').size, 0);
  assert.equal(parseConfigTrace("[]").size, 0);

  // A malformed entry is skipped while its valid neighbours are kept.
  const mixed =
    '[[1,2],"a string",["CONFIG_KEPT","y","bool","y","assign",["f.kconfig",1]]]';
  const trace = parseConfigTrace(mixed);
  assert.equal(trace.size, 1);
  assert.equal(trace.get("KEPT").value, "y");
});

// ── integration: slice resolution + freshness, on a real directory tree ──────

const os = require("node:os");
const {
  buildCompletions,
  buildInfoMarkdown,
  diagnosePrjConfAgainstBuild,
  isBuildFresh,
} = require("../out/lsp/buildConfig.js");

/**
 * Build the layout the orchestrator produces, with controlled mtimes:
 *   <root>/board.yaml
 *   <root>/src/prj.conf
 *   <root>/build/m55_hp-zephyr/alp.conf
 *   <root>/build/m55_hp-zephyr/build/zephyr/.config   <- west nests its own build/
 */
function makeProject({ configNewest }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alp-buildconfig-"));
  const srcDir = path.join(root, "src");
  const sliceDir = path.join(root, "build", "m55_hp-zephyr");
  const zephyrDir = path.join(sliceDir, "build", "zephyr");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(zephyrDir, { recursive: true });

  fs.writeFileSync(
    path.join(root, "board.yaml"),
    "cores:\n  m55_hp:\n    os: zephyr\n    app: ./src\n",
  );
  const prjPath = path.join(srcDir, "prj.conf");
  fs.writeFileSync(prjPath, "CONFIG_EXAMPLE_SYM=y\n");
  fs.writeFileSync(path.join(sliceDir, "alp.conf"), "# generated\n");
  const configPath = path.join(zephyrDir, ".config");
  fs.writeFileSync(configPath, "# CONFIG_EXAMPLE_SYM is not set\n");

  // Fixed epochs, not Date.now(): a same-second write would make the
  // comparison depend on filesystem timestamp granularity.
  const older = new Date(1_000_000);
  const newer = new Date(2_000_000);
  for (const p of [
    path.join(root, "board.yaml"),
    prjPath,
    path.join(sliceDir, "alp.conf"),
  ]) {
    fs.utimesSync(
      p,
      configNewest ? older : newer,
      configNewest ? older : newer,
    );
  }
  fs.utimesSync(
    configPath,
    configNewest ? newer : older,
    configNewest ? newer : older,
  );

  return { root, prjPath };
}

test("resolveSlice maps a prj.conf onto its core via cores[].app", () => {
  const { root, prjPath } = makeProject({ configNewest: true });
  const slice = resolveSlice(prjPath);
  assert.ok(slice, "expected the prj.conf under ./src to resolve to m55_hp");
  assert.equal(slice.coreId, "m55_hp");
  assert.equal(slice.os, "zephyr");
  assert.equal(
    slice.configPath,
    path.join(root, "build", "m55_hp-zephyr", "build", "zephyr", ".config"),
  );
});

test("a fresh build is compared, and the overridden assignment is reported", () => {
  const { prjPath } = makeProject({ configNewest: true });
  assert.equal(isBuildFresh(resolveSlice(prjPath), prjPath), true);

  const text = fs.readFileSync(prjPath, "utf-8");
  const [d] = diagnosePrjConfAgainstBuild(prjPath, text);
  assert.ok(d);
  assert.equal(d.severity, "warning");
  assert.match(d.message, /did not take effect/);
});

test("hover reports the resolved value with its provenance", () => {
  const { root, prjPath } = makeProject({ configNewest: true });
  const zephyrDir = path.join(
    root,
    "build",
    "m55_hp-zephyr",
    "build",
    "zephyr",
  );
  const tracePath = path.join(zephyrDir, ".config-trace.json");
  fs.writeFileSync(
    tracePath,
    JSON.stringify([
      [
        "CONFIG_EXAMPLE_SYM",
        "n",
        "bool",
        "n",
        "select",
        ["drivers/example/Kconfig", 42],
      ],
    ]),
  );
  // Written after .config, so re-stamp both to keep the build "fresh".
  const newer = new Date(2_000_000);
  fs.utimesSync(tracePath, newer, newer);
  fs.utimesSync(path.join(zephyrDir, ".config"), newer, newer);

  const md = buildInfoMarkdown(prjPath, "CONFIG_EXAMPLE_SYM");
  assert.ok(md, "expected build info for a traced symbol");
  assert.match(md, /In the last `m55_hp` build/);
  assert.match(md, /`n` _\(bool, select\)_/);
  // `select` is the reading users get wrong most often — name it explicitly.
  assert.match(md, /Enabled by another symbol's `select`/);
  assert.match(md, /drivers\/example\/Kconfig:42/);
});

test("completion offers what the build resolved, scoped to the slice", () => {
  const { root, prjPath } = makeProject({ configNewest: true });
  const zephyrDir = path.join(
    root,
    "build",
    "m55_hp-zephyr",
    "build",
    "zephyr",
  );
  const configPath = path.join(zephyrDir, ".config");
  // A slice-real set: one bool that is off, one int.
  fs.writeFileSync(
    configPath,
    "# CONFIG_EXAMPLE_SYM is not set\nCONFIG_EXAMPLE_SIZE=2048\n",
  );
  const newer = new Date(2_000_000);
  fs.utimesSync(configPath, newer, newer);

  const items = buildCompletions(prjPath);
  const byLabel = new Map(items.map((i) => [i.label, i]));
  assert.equal(items.length, 2);

  const sym = byLabel.get("CONFIG_EXAMPLE_SYM");
  assert.ok(sym);
  assert.match(sym.detail, /currently n/);
  assert.match(sym.doc, /Resolved by the last `m55_hp` build/);
  // The current value is NOT the insert default — completing `=n` because the
  // symbol happens to be off today would be a strange suggestion.
  assert.doesNotMatch(sym.insertText, /=n$/);

  assert.match(byLabel.get("CONFIG_EXAMPLE_SIZE").detail, /currently 2048/);
});

test("completion falls back to the static catalogue when nothing is built", () => {
  const { prjPath } = makeProject({ configNewest: false });
  // Stale build: offering its symbols would describe a slice the current
  // sources no longer produce.
  assert.deepEqual(buildCompletions(prjPath), []);
});

test("hover says nothing when the build is stale", () => {
  const { prjPath } = makeProject({ configNewest: false });
  // Same rule as the diagnostics: a stale trace reports values the current
  // sources would not produce, and a hover asserting them reads as fact.
  assert.equal(buildInfoMarkdown(prjPath, "CONFIG_EXAMPLE_SYM"), null);
});

test("a stale build says why it is silent instead of saying nothing", () => {
  const { prjPath } = makeProject({ configNewest: false });
  assert.equal(isBuildFresh(resolveSlice(prjPath), prjPath), false);

  const text = fs.readFileSync(prjPath, "utf-8");
  const found = diagnosePrjConfAgainstBuild(prjPath, text);
  // Exactly one notice, and NOT the comparison result — reporting a verdict
  // from a stale build is the failure this gate exists to prevent.
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "information");
  assert.match(found[0].message, /Build-output checks are off/);
  assert.doesNotMatch(found[0].message, /did not take effect/);
});

test("resolveSlice returns null rather than guessing when there is no board.yaml", () => {
  // Silence is the required outcome: attributing some other core's build
  // results to this file would be worse than offering nothing.
  assert.equal(
    resolveSlice(path.join(__dirname, "fixtures", "prj.conf")),
    null,
  );
});
