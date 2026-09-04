// SPDX-License-Identifier: Apache-2.0
//
// Unit tests for `parseCommandNames` in `scripts/tan-surface/fetch.mjs` — and
// specifically for the one case the file guards against everywhere ELSE and
// not here: a root help page that yields NO command names at all.
//
// This is not hypothetical. `tan surface drift` has been red on every
// scheduled run since the workflow landed (`551a2196`), always with:
//
//   [surface] tan 0.6.0: 0 commands, 0 options (0 inert), 0 refusing
//   subcommand(s), 12 global options, ...
//
// while the SAME staged binary (sha256
// c6c72b1fbcd42e43cebbf91111699773c64e003099e472090792e8226528cfe6) parses to
// 31 commands / 340 options locally. Whatever makes the runner's root help
// different, the fetcher's answer to it was to report an empty surface as a
// finding rather than as a failure.
//
// Why that is the dangerous direction, and not merely an unhelpful one:
//
//   * `buildSnapshot`'s #602 guard — "a command with zero captured options is
//     a parser failure" — iterates `Object.keys(commands)`. On an empty
//     object it runs zero times, so the one check written for exactly this
//     class of silence cannot fire.
//   * `globalOptions` comes from `tan completion --shell bash`, NOT from the
//     root help, so it stays correct (12) and the summary line looks like a
//     working probe that found an empty CLI.
//   * The failure message then instructs a re-capture. Without a guard, that
//     re-capture WRITES `commands: {}` to `test/golden/tan-surface/surface.json`
//     — which `src/alpCli/pinnedSurface.ts` drives real behaviour from, and
//     which the same message calls "silently authoritative".
//
// `parseGlobalOptions` already refuses its own empty case ("global_flags is
// empty"). This is that rule applied to the other half of the same snapshot.

const test = require("node:test");
const assert = require("node:assert/strict");

const FETCH_REL = "scripts/tan-surface/fetch.mjs";

let mod;
test.before(async () => {
  mod = await import(`../${FETCH_REL}`);
});

/** The real shape, trimmed: rich draws a titled box per command group, and
 *  `parseCommandNames` takes every box that is not `Options`. Layout copied
 *  from `COLUMNS=200 NO_COLOR=1 tan --help` at the pinned 0.6.0. */
const ROOT_HELP_WITH_COMMANDS = [
  " Usage: tan [OPTIONS] COMMAND [ARGS]...",
  "",
  " tan CLI -- board configuration, generation, and project tooling.",
  "",
  "╭─ Options ─────────────────────────────────────────────╮",
  "│ --version                                             │",
  "│ --format         FORMAT  Output format: text or json. │",
  "│ --help                   Show this message and exit.  │",
  "╰───────────────────────────────────────────────────────╯",
  "╭─ Setup ───────────────────────────────────────────────╮",
  "│ bootstrap       Set up the SDK's build environment.   │",
  "│ doctor          Diagnose whether this host can build. │",
  "╰───────────────────────────────────────────────────────╯",
].join("\n");

/** The runner's shape, as far as the summary line can pin it down: the
 *  Options box still parses, and nothing yields a command name. Built by
 *  DELETING the command-group box from the fixture above, so the two differ
 *  in exactly the thing under test. */
const ROOT_HELP_WITHOUT_COMMANDS = [
  " Usage: tan [OPTIONS] COMMAND [ARGS]...",
  "",
  " tan CLI -- board configuration, generation, and project tooling.",
  "",
  "╭─ Options ─────────────────────────────────────────────╮",
  "│ --version                                             │",
  "│ --format         FORMAT  Output format: text or json. │",
  "│ --help                   Show this message and exit.  │",
  "╰───────────────────────────────────────────────────────╯",
].join("\n");

test("reads every command-group box, and skips the Options box", () => {
  // Arrange / Act
  const names = mod.parseCommandNames(ROOT_HELP_WITH_COMMANDS);

  // Assert — the command names, and NOT `--version`/`--format`/`--help`.
  assert.deepEqual(names, ["bootstrap", "doctor"]);
});

test("a root help that yields no command names is a failure, not an empty surface", () => {
  // Arrange: a page whose only box is `Options` — the shape the summary line
  // from every red `tan surface drift` run describes (0 commands, 12 global
  // options, the latter read from the completion script instead).
  //
  // Act / Assert: this must THROW. Returning `[]` is what let the scheduled
  // job report an empty CLI as a finding, and what would let a re-capture
  // write `commands: {}` over a correct record.
  assert.throws(
    () => mod.parseCommandNames(ROOT_HELP_WITHOUT_COMMANDS),
    /no command names/i,
    "parseCommandNames returned instead of throwing — an empty command list " +
      "is indistinguishable from a tan with no commands, and buildSnapshot's " +
      "zero-options guard cannot fire on an empty object",
  );
});

test("the guard names the box titles it did read, so the layout change is diagnosable", () => {
  // Arrange / Act
  let message = "";
  try {
    mod.parseCommandNames(ROOT_HELP_WITHOUT_COMMANDS);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  // Assert — a bare "no commands" would send the next reader back to the
  // binary with nothing to go on. The titles ARE the diagnosis: whether the
  // group boxes were missing entirely or were present and misread.
  assert.match(
    message,
    /Options/,
    `the guard must report which boxes it saw; got: ${message}`,
  );
});
