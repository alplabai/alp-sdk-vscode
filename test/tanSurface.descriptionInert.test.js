// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for `scripts/tan-surface/fetch.mjs`'s description-level inert
// classifier (#602) — `parseDescription`, `classifyDescriptionInert`, and the
// `isHedged` guard that keeps it from recording a CONDITIONAL "accepted and
// ignored" wording as an unconditional one.
//
// Before this file, NOTHING in `test/` referenced either exported function —
// the six real commands' description text was the only thing ever run
// through it, and a re-capture against the pinned binary is how the fetcher
// was exercised. That leaves exactly the over-match the header comment on
// `DESCRIPTION_INERT_CLAUSE` names but does not itself prevent: a future tan
// wording this repo has already seen upstream (`run --flash`'s own
// "...for a native_sim/host target", `renode --sim-mode`'s own "...--expect
// is ignored") would have been misread as absolute inertness on a flag this
// extension actually spawns. The four counterexamples below are those real
// wordings (or a synthetic near-miss of the same shape), not invented ones.

const test = require("node:test");
const assert = require("node:assert/strict");

const FETCH_REL = "scripts/tan-surface/fetch.mjs";

let mod;
test.before(async () => {
  mod = await import(`../${FETCH_REL}`);
});

// ---------------------------------------------------------------------------
// parseDescription
// ---------------------------------------------------------------------------

test("parseDescription reads the paragraph between Usage and the first box", () => {
  const help = [
    " Usage: tan diff [OPTIONS]",
    "",
    " Show how board.yaml normalization changes the effective config.",
    "",
    " `--target`/`--all` are declared, not consumed.",
    "",
    "╭─ Options ─╮",
    "│ --help │",
    "╰───────────╯",
    "",
  ].join("\n");
  const description = mod.parseDescription(help);
  assert.match(description, /Show how board\.yaml normalization/);
  assert.match(description, /declared, not consumed/);
  assert.doesNotMatch(description, /Options|--help/);
});

test("parseDescription rejoins a hard-wrapped flag list without losing a flag to the wrap's stray space", () => {
  // The exact shape rich produces when an unbroken backtick-flag list
  // exceeds the box width — measured on the real `pinmux` help page, where
  // the wrap point falls INSIDE the list (no real space in the source text)
  // rather than at a word boundary.
  const help = [
    " Usage: tan pinmux [OPTIONS]",
    "",
    " `--target`/`--all`/`--verbose`/`--quiet`/`--no-color`/`--non-interactive`/",
    " `--ci` are declared, not consumed: `pinmux` reads only `--sku`.",
    "",
    "╭─ Options ─╮",
    "│ --help │",
    "╰───────────╯",
  ].join("\n");
  const description = mod.parseDescription(help);
  const { named } = mod.classifyDescriptionInert(description);
  assert.deepEqual([...named.keys()].sort(), [
    "--all",
    "--ci",
    "--no-color",
    "--non-interactive",
    "--quiet",
    "--target",
    "--verbose",
  ]);
});

test("parseDescription returns empty text for a help page with no Usage line", () => {
  assert.equal(mod.parseDescription("nothing recognisable here"), "");
});

// ---------------------------------------------------------------------------
// classifyDescriptionInert — the six REAL absolute clauses this pin carries
// ---------------------------------------------------------------------------

const REAL_ABSOLUTE_CASES = [
  [
    "diff",
    "Show how board.yaml normalization changes the effective config. " +
      "`--target`/`--all`/`--verbose`/`--no-color`/`--non-interactive`/`--ci` " +
      "are declared, not consumed: `diff` reads only the project's own " +
      "board.yaml plus, now, `--sdk-root` -- solely to echo the resolved SDK.",
    [
      "--target",
      "--all",
      "--verbose",
      "--no-color",
      "--non-interactive",
      "--ci",
    ],
  ],
  [
    "inspect",
    "Inspect resolved project/debug context values. " +
      "`--verbose`/`--no-color`/`--non-interactive`/`--ci`/`--target`/`--all` " +
      "are accepted and ignored: clap makes every one of them `global = true` " +
      "in the oracle.",
    [
      "--verbose",
      "--no-color",
      "--non-interactive",
      "--ci",
      "--target",
      "--all",
    ],
  ],
  [
    "support-bundle (singular + list)",
    "Export a diagnostic support bundle (inspect + trace + doctor). `--all` " +
      "is accepted and ignored, same as `tan trace`. " +
      "`--quiet`/`--no-color`/`--non-interactive`/`--ci` are `global = true` " +
      "clap options `support_bundle.rs` never reads.",
    ["--all", "--quiet", "--no-color", "--non-interactive", "--ci"],
  ],
  [
    "faultdecode",
    "Explicit flags win over a parsed dump. " +
      "`--project`/`--sdk-root`/`--board-yaml`/`--target`/`--all`/`--verbose`/" +
      "`--quiet`/`--non-interactive`/`--ci` are declared, not consumed: this " +
      "command reads no board.yaml and drives no alp-sdk checkout.",
    [
      "--project",
      "--sdk-root",
      "--board-yaml",
      "--target",
      "--all",
      "--verbose",
      "--quiet",
      "--non-interactive",
      "--ci",
    ],
  ],
];

for (const [label, description, expectedFlags] of REAL_ABSOLUTE_CASES) {
  test(`classifyDescriptionInert records the real ${label} clause as absolute`, () => {
    const { named } = mod.classifyDescriptionInert(description);
    assert.deepEqual([...named.keys()].sort(), [...expectedFlags].sort());
    for (const flag of expectedFlags) {
      assert.equal(named.get(flag).ref, null);
      assert.ok(named.get(flag).marker.length > 0);
    }
  });
}

test("classifyDescriptionInert resolves trace's own residual 'other hidden flags' sentence", () => {
  const description =
    "Trace the generation decisions a build would make. `--all` is " +
    "accepted and ignored -- see [`resolve_trace_targets`]. The other " +
    "hidden flags are `global = true` clap options `trace.rs` never reads.";
  const { named, residual } = mod.classifyDescriptionInert(description);
  assert.deepEqual([...named.keys()], ["--all"]);
  assert.ok(residual);
  assert.match(residual.marker, /other hidden flags/);
});

test("classifyDescriptionInert returns no residual for a description with none", () => {
  const { residual } = mod.classifyDescriptionInert(
    "Scaffold the metadata skeletons for porting a new SoM.",
  );
  assert.equal(residual, null);
});

// ---------------------------------------------------------------------------
// The load-bearing counterexamples — CONDITIONAL and HISTORICAL wordings
// this classifier must NOT record as absolute
// ---------------------------------------------------------------------------

const HEDGED_CASES = [
  [
    "a conditional tail naming the target class (tan's real `run --flash` wording)",
    "`--flash` is accepted and ignored for a native_sim/host target.",
  ],
  [
    "a conditional tail naming a co-occurring flag (tan's real `renode --sim-mode` shape)",
    "`--expect` is accepted and ignored when `--sim-mode` is given.",
  ],
  [
    "an 'only when' conditional covering a whole flag list",
    "`--target`/`--all` are accepted and ignored only when `--offline` is " +
      "also passed.",
  ],
  [
    "a historical claim about a PAST pin, not this one",
    "Until 0.5.0 `--verbose`/`--quiet` are accepted and ignored; since " +
      "0.6.0 both work.",
  ],
];

for (const [label, description] of HEDGED_CASES) {
  test(`classifyDescriptionInert does NOT record ${label}`, () => {
    const { named } = mod.classifyDescriptionInert(description);
    assert.deepEqual(
      [...named.keys()],
      [],
      `expected no flag recorded absolute, got ${JSON.stringify([...named.keys()])} ` +
        `from ${JSON.stringify(description)}`,
    );
  });
}

test("isHedged is true for a conditional tail and false for the real diff clause", () => {
  const conditional =
    "`--flash` is accepted and ignored for a native_sim/host target.";
  const match = /`--flash` is accepted and ignored/.exec(conditional);
  assert.equal(mod.isHedged(conditional, match.index, match[0].length), true);

  const absolute =
    "`--target`/`--all` are declared, not consumed: `diff` reads only board.yaml.";
  const absoluteMatch = /`--target`\/`--all` are declared, not consumed/.exec(
    absolute,
  );
  assert.equal(
    mod.isHedged(absolute, absoluteMatch.index, absoluteMatch[0].length),
    false,
  );
});

test("isHedged's clause boundary does not mistake a version number's dot for a sentence end", () => {
  // If `0.5.0`'s internal periods were read as sentence boundaries, "Until"
  // would fall outside the preceding-clause window entirely and this would
  // wrongly read as absolute.
  const text =
    "Until 0.5.0 `--verbose` is accepted and ignored; since 0.6.0 it works.";
  const match = /`--verbose` is accepted and ignored/.exec(text);
  assert.equal(mod.isHedged(text, match.index, match[0].length), true);
});
