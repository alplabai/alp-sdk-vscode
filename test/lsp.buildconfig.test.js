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

test("parseConfigTrace reads the visibility field", () => {
  const trace = parseConfigTrace(TRACE_TEXT);
  const some = [...trace.values()];
  assert.ok(
    some.every(
      (s) =>
        s.visibility === "n" || s.visibility === "y" || s.visibility === "m",
    ),
    "expected every traced symbol to carry an n/m/y visibility",
  );
});

test("an ignored assignment to a non-settable symbol names the reason", () => {
  const cfg = new Map([["DT_HAS_FOO", "y"]]);
  const trace = new Map([
    [
      "DT_HAS_FOO",
      { value: "y", type: "bool", kind: "default", visibility: "n" },
    ],
  ]);
  // Devicetree-driven symbol: not user-settable, so a prj.conf line to it is
  // ignored. The message must say WHY (not settable), and must NOT overclaim
  // which dependency is unmet — the trace does not carry that.
  const [d] = diagnoseAgainstBuild("CONFIG_DT_HAS_FOO=n\n", cfg, trace);
  assert.ok(d);
  assert.match(d.message, /not user-settable in this build target/);
  assert.doesNotMatch(d.message, /did not take effect/);
});

test("a settable symbol that lost keeps the plain override message", () => {
  const cfg = new Map([["INPUT", "n"]]);
  const trace = new Map([
    ["INPUT", { value: "n", type: "bool", kind: "assign", visibility: "y" }],
  ]);
  // visibility y — the user COULD set it; something else won, so the plain
  // "did not take effect" is the honest message, not "not settable".
  const [d] = diagnoseAgainstBuild("CONFIG_INPUT=y\n", cfg, trace);
  assert.ok(d);
  assert.match(d.message, /did not take effect/);
  assert.doesNotMatch(d.message, /not user-settable/);
});

test("without a trace the override message is unchanged", () => {
  const cfg = new Map([["DT_HAS_FOO", "y"]]);
  // No trace → cannot claim non-settability → fall back to the plain message.
  const [d] = diagnoseAgainstBuild("CONFIG_DT_HAS_FOO=n\n", cfg);
  assert.ok(d);
  assert.match(d.message, /did not take effect/);
  assert.doesNotMatch(d.message, /not user-settable/);
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

// ── .config-missing-deps.json ───────────────────────────────────────────────

const { parseMissingDeps } = require("../out/lsp/buildConfig.js");

test("parseMissingDeps reads the {CONFIG_X: [deps]} map, keyed unprefixed", () => {
  const m = parseMissingDeps(
    '{"CONFIG_FOO":["DEP (=n)"],"CONFIG_BAR":["(A || B) (=n)","C (=n)"]}',
  );
  assert.deepEqual(m.get("FOO"), ["DEP (=n)"]);
  assert.deepEqual(m.get("BAR"), ["(A || B) (=n)", "C (=n)"]);
});

test("parseMissingDeps is tolerant of shapes it does not recognise", () => {
  // Same never-throw contract as parseConfigTrace: a bad sibling degrades to
  // "no detail", it never takes the diagnostic pass down with it.
  assert.equal(parseMissingDeps("{ not json").size, 0);
  assert.equal(parseMissingDeps("[]").size, 0);
  assert.equal(parseMissingDeps("null").size, 0);
  // Empty lists, unprefixed keys, and non-string entries are all dropped.
  assert.equal(
    parseMissingDeps('{"CONFIG_A":[],"NOPREFIX":["x"],"CONFIG_B":[1,2]}').size,
    0,
  );
});

test("a recorded unmet dependency is named instead of the disjunction", () => {
  const cfg = new Map([["FEATURE", "n"]]);
  const trace = new Map([
    ["FEATURE", { value: "n", type: "bool", kind: "unset", visibility: "n" }],
  ]);
  const missing = new Map([["FEATURE", ["DEP (=n)"]]]);
  // With the concrete dep recorded by the build, the message must NAME it and
  // drop the vague "has no prompt, or ... unmet" disjunction.
  const [d] = diagnoseAgainstBuild("CONFIG_FEATURE=y\n", cfg, trace, missing);
  assert.ok(d);
  assert.match(d.message, /DEP \(=n\)/);
  assert.match(d.message, /is unmet in this build target/);
  assert.doesNotMatch(d.message, /has no prompt/);
});

test("multiple unmet dependencies render as a plural list", () => {
  const cfg = new Map([["FEATURE", "n"]]);
  const missing = new Map([["FEATURE", ["(A || B) (=n)", "C (=n)"]]]);
  // No trace needed: the sibling file alone is authoritative for the reason.
  const [d] = diagnoseAgainstBuild(
    "CONFIG_FEATURE=y\n",
    cfg,
    undefined,
    missing,
  );
  assert.ok(d);
  assert.match(
    d.message,
    /its dependencies \(A \|\| B\) \(=n\), C \(=n\) are unmet/,
  );
});

test("missing-deps never fires for an assignment that took effect", () => {
  const cfg = new Map([["PLAIN", "y"]]);
  // Value matches → no diagnostic at all, even if the sibling listed it.
  const missing = new Map([["PLAIN", ["X (=n)"]]]);
  assert.deepEqual(
    diagnoseAgainstBuild("CONFIG_PLAIN=y\n", cfg, undefined, missing),
    [],
  );
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

test("a recorded unmet dependency reaches the diagnostic via the sibling file", () => {
  const { root, prjPath } = makeProject({ configNewest: true });
  // Same build wrote .config-missing-deps.json next to .config: EXAMPLE_SYM=y
  // was ignored because DEP is unmet. The freshness gate already passed on the
  // .config, and the sibling shares it, so it is read without a separate gate.
  const zephyrDir = path.join(
    root,
    "build",
    "m55_hp-zephyr",
    "build",
    "zephyr",
  );
  fs.writeFileSync(
    path.join(zephyrDir, ".config-missing-deps.json"),
    JSON.stringify({ CONFIG_EXAMPLE_SYM: ["DEP (=n)"] }),
  );

  const text = fs.readFileSync(prjPath, "utf-8");
  const [d] = diagnosePrjConfAgainstBuild(prjPath, text);
  assert.ok(d);
  assert.match(d.message, /DEP \(=n\)/);
  assert.match(d.message, /is unmet in this build target/);
});

test("a missing-deps sibling older than .config is suppressed (never a wrong blocker)", () => {
  const { root, prjPath } = makeProject({ configNewest: true });
  const sibling = path.join(
    root,
    "build",
    "m55_hp-zephyr",
    "build",
    "zephyr",
    ".config-missing-deps.json",
  );
  fs.writeFileSync(
    sibling,
    JSON.stringify({ CONFIG_EXAMPLE_SYM: ["OLD_DEP (=n)"] }),
  );
  // Older than .config: the run was interrupted after .config but before this
  // sibling, or it is left from an earlier solve — its blocker may be wrong, so
  // it must NOT surface. .config here is at epoch 2_000_000 (makeProject).
  const stale = new Date(500_000);
  fs.utimesSync(sibling, stale, stale);

  const text = fs.readFileSync(prjPath, "utf-8");
  const [d] = diagnosePrjConfAgainstBuild(prjPath, text);
  assert.ok(d);
  assert.doesNotMatch(d.message, /OLD_DEP/);
  assert.match(d.message, /did not take effect/);
});

test("a fresh .config-trace.json drives the tier-2 not-settable message", () => {
  const { root, prjPath } = makeProject({ configNewest: true });
  const traceFile = path.join(
    root,
    "build",
    "m55_hp-zephyr",
    "build",
    "zephyr",
    ".config-trace.json",
  );
  // EXAMPLE_SYM resolves n (makeProject), prj sets y → ignored; the trace says
  // it is not user-settable (visibility n) → tier-2 names that reason.
  fs.writeFileSync(
    traceFile,
    JSON.stringify([["CONFIG_EXAMPLE_SYM", "n", "bool", "n", "unset", null]]),
  );
  const text = fs.readFileSync(prjPath, "utf-8");
  const [d] = diagnosePrjConfAgainstBuild(prjPath, text);
  assert.ok(d);
  assert.match(d.message, /not user-settable/);
});

test("a .config-trace.json older than .config is suppressed (tier-2 skew closed)", () => {
  const { root, prjPath } = makeProject({ configNewest: true });
  const traceFile = path.join(
    root,
    "build",
    "m55_hp-zephyr",
    "build",
    "zephyr",
    ".config-trace.json",
  );
  fs.writeFileSync(
    traceFile,
    JSON.stringify([["CONFIG_EXAMPLE_SYM", "n", "bool", "n", "unset", null]]),
  );
  // Older than .config (epoch 2_000_000): a leftover/interrupted trace must not
  // drive the "not user-settable" wording — fall to the plain tier-3 message.
  const stale = new Date(500_000);
  fs.utimesSync(traceFile, stale, stale);
  const text = fs.readFileSync(prjPath, "utf-8");
  const [d] = diagnosePrjConfAgainstBuild(prjPath, text);
  assert.ok(d);
  assert.doesNotMatch(d.message, /not user-settable/);
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

  const items = buildCompletions(prjPath, "CONFIG_");
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
  assert.deepEqual(buildCompletions(prjPath, "CONFIG_"), []);
});

test("completion offers nothing in the value position", () => {
  const { root, prjPath } = makeProject({ configNewest: true });
  const configPath = path.join(
    root,
    "build",
    "m55_hp-zephyr",
    "build",
    "zephyr",
    ".config",
  );
  fs.writeFileSync(configPath, "CONFIG_A=y\nCONFIG_B=y\n");
  fs.utimesSync(configPath, new Date(2_000_000), new Date(2_000_000));

  // Past the `=` a symbol NAME is never valid. Without this guard a fresh
  // slice pops its whole .config (833 names on a real one) as soon as you
  // type `CONFIG_SERIAL=`.
  assert.equal(buildCompletions(prjPath, "CONFIG_A").length, 2);
  assert.deepEqual(buildCompletions(prjPath, "CONFIG_A="), []);
  assert.deepEqual(buildCompletions(prjPath, "CONFIG_A=y"), []);
});

test("an unsaved buffer is never judged against the last build", () => {
  const { prjPath } = makeProject({ configNewest: true });
  // The editor re-validates on every keystroke with the in-memory text while
  // the freshness gate stats the file on disk, so a dirty buffer reads as
  // "fresh" and unsaved lines get judged against a build that never saw them.
  // Disk mtime cannot detect that; comparing the text can.
  const dirty = "CONFIG_EXAMPLE_SYM=y\nCONFIG_NEVER_BUILT=y\n";
  const found = diagnosePrjConfAgainstBuild(prjPath, dirty);

  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "information");
  assert.match(found[0].message, /Unsaved changes/);
  // Crucially, NOT a verdict about a line that was never built.
  assert.doesNotMatch(found[0].message, /not defined in this build/);
  assert.doesNotMatch(found[0].message, /did not take effect/);
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
