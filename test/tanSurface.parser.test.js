// SPDX-License-Identifier: Apache-2.0
//
// Row-level tests for the help-box parser in scripts/tan-surface/fetch.mjs.
//
// tan 0.7.0-rc1 brought help layouts the 0.6.0-era parser refused to record:
// a short-alias column (`build -D`), `NAME=VALUE` / `FILE@ADDR` /
// `ADDR[:WORDS][@PERIOD-MS]` metavars, a bare `m55_he|m55_hp` choice list, a
// one-letter metavar (`model --runs N`), a pipe-separated SUBCOMMAND list and
// a "Retired --" help marker. Each is pinned here on rows shaped exactly as
// rich renders them, so reverting any one hunk of that change goes red here
// rather than only on the next capture against a real binary. A 0.6.0-shaped
// box is the control: the widened parser must read it exactly as before.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const FETCH = path.join(__dirname, "..", "scripts", "tan-surface", "fetch.mjs");

let mod;
test.before(async () => {
  // A bare absolute path is not an ESM specifier on Windows: `D:\...` reads as
  // a URL with scheme `d:` and `import()` throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
  mod = await import(pathToFileURL(FETCH).href);
});

/** One box row: name, then each later cell starting at its fixed column. */
function row(cells) {
  let text = " ";
  for (const [column, value] of cells) {
    text = text.padEnd(column) + value;
  }
  return text;
}

const byName = (entries) =>
  Object.fromEntries(entries.map((entry) => [entry.name, entry]));

test("a 0.6.0-shaped box reads as it always did (the control)", () => {
  const entries = byName(
    mod.parseBoxEntries([
      row([
        [1, "--board-yaml"],
        [30, "PATH"],
        [43, "Explicit board.yaml path."],
      ]),
      row([
        [1, "--dry-run"],
        [43, "Print the command and return."],
      ]),
      row([
        [1, "--format"],
        [30, "<text|json>"],
        [43, "Output format."],
      ]),
    ]),
  );
  assert.equal(entries["--board-yaml"].metavar, "PATH");
  assert.equal(entries["--board-yaml"].help, "Explicit board.yaml path.");
  assert.equal(entries["--dry-run"].metavar, null);
  assert.equal(entries["--format"].metavar, "<text|json>");
});

test("a short-alias column folds into the option's spellings, not its help", () => {
  // `tan build`'s box at 0.7.0-rc1: name 1, short 22, metavar 30, help 43.
  const entries = mod.parseBoxEntries([
    row([
      [1, "--plan-from"],
      [30, "FILE"],
      [43, "Read the plan from FILE."],
    ]),
    row([
      [1, "--define"],
      [22, "-D"],
      [30, "NAME=VALUE"],
      [43, "A CMake definition."],
    ]),
  ]);
  const define = entries.find((entry) => entry.name.startsWith("--define"));
  assert.equal(define.name, "--define,-D");
  assert.equal(define.metavar, "NAME=VALUE");
  assert.equal(define.help, "A CMake definition.");
});

test("a ONE-letter metavar ends at its own cell, not at the help after it", () => {
  const entries = byName(
    mod.parseBoxEntries([
      row([
        [1, "--runs"],
        [29, "N"],
        [55, "With host run/ab: timed runs."],
      ]),
      row([
        [1, "--core"],
        [29, "CORE_ID"],
        [55, "The slice to RAM-run."],
      ]),
      row([
        [1, "--device"],
        [55, "With run/ab: the on-device tier."],
      ]),
    ]),
  );
  assert.equal(entries["--runs"].metavar, "N");
  assert.equal(entries["--runs"].help, "With host run/ab: timed runs.");
});

test("the widened metavar body reads rc1's four new spellings", () => {
  for (const [cell, metavar] of [
    ["NAME=VALUE", "NAME=VALUE"],
    ["FILE@ADDR", "FILE@ADDR"],
    ["ADDR[:WORDS][@PERIOD-MS]", "ADDR[:WORDS][@PERIOD-MS]"],
    ["m55_he|m55_hp", "m55_he|m55_hp"],
  ]) {
    assert.deepEqual(
      mod.parseMetavarCell(cell),
      { metavar, valueOptional: false },
      cell,
    );
  }
  // What must STAY help text: a lowercase word with no `|`, a bare range.
  assert.equal(mod.parseMetavarCell("help"), null);
  assert.equal(mod.parseMetavarCell("[x>=0]"), null);
  // And the range constraint is still a trailing group, not part of the body.
  assert.deepEqual(mod.parseMetavarCell("SECONDS [0.0<=x<=3600.0]"), {
    metavar: "SECONDS",
    valueOptional: false,
  });
});

test("a box whose rows use rc1 metavars agrees on one help column", () => {
  // Before the widening, each of these rows voted for the metavar column and
  // the split vote refused the whole capture.
  const entries = byName(
    mod.parseBoxEntries([
      row([
        [1, "--project"],
        [29, "PATH"],
        [55, "Project root."],
      ]),
      row([
        [1, "--raw"],
        [29, "FILE@ADDR"],
        [55, "Byte-exact MRAM write."],
      ]),
      row([
        [1, "--watch"],
        [29, "ADDR[:WORDS][@PERIOD-MS]"],
        [55, "Sample memory."],
      ]),
      row([
        [1, "--core"],
        [29, "m55_he|m55_hp"],
        [55, "Core to probe."],
      ]),
    ]),
  );
  assert.equal(entries["--raw"].metavar, "FILE@ADDR");
  assert.equal(entries["--watch"].help, "Sample memory.");
  assert.equal(entries["--core"].metavar, "m55_he|m55_hp");
});

test("a help cell opening `Retired --` is recorded inert, with its ref", () => {
  assert.deepEqual(
    mod.classifyInert("Retired -- superseded by `--plan-from` (tan-cli#427)."),
    {
      inert: true,
      ref: "tan-cli#427",
      marker: "Retired -- superseded by `--plan-from` (tan-cli#427)",
    },
  );
  // Anchored at the start: a live flag's help that merely MENTIONS
  // retirement is not condemned.
  assert.equal(
    mod.classifyInert("Replaces the Retired -- flag (tan-cli#1)").inert,
    false,
  );
});

test("a pipe-separated SUBCOMMAND list reads like a comma-separated one", () => {
  const values = (help) =>
    mod.parseSubcommandValues([{ name: "SUBCOMMAND", help }]);
  assert.deepEqual(values("build | doctor | check | zoo | add | ab."), [
    "build",
    "doctor",
    "check",
    "zoo",
    "add",
    "ab",
  ]);
  // The 0.6.0 spellings still read.
  assert.deepEqual(values("build."), ["build"]);
  assert.deepEqual(values("list, current, install, or switch. Caveat."), [
    "list",
    "current",
    "install",
    "switch",
  ]);
});
