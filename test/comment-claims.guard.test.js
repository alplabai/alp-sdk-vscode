// SPDX-License-Identifier: Apache-2.0
//
// Structural guard on doc-comment CLAIMS.
//
// A COMMENT EDIT IS A CLAIM EDIT. That line is here rather than in a style doc
// because it is the habit this file exists to build. One of the eight stale
// claims that reached review across #389/#386 survived because a paragraph was
// re-WRAPPED without the clause inside it being re-READ: the editor moved the
// words and never re-checked what they asserted. Reflowing a sentence is
// editing it.
//
// The eight were not typos. They asserted a guarantee, a caller, or a label
// the code did not match, and every one was caught by a human. NONE by a gate —
// a stale sentence is invisible to `tsc`, to prettier and to `node --test`.
// Two were worse than inert: they were the stated JUSTIFICATION for not adding
// the test that would have caught the real defect ("the compiler refuses" — it
// refused the caller only; "no unit test can load this file" — three already
// did). A wrong comment does not just misinform, it argues.
//
// Like test/notify.guard.test.js, these tests read SOURCE, not compiled
// output: the point is to fail when something is re-typed that a behavioural
// test cannot see.
//
// ── WHAT IS GUARDED ────────────────────────────────────────────────────────
//
// Comments carry an explicit, machine-readable annotation ALONGSIDE the prose.
// No English is parsed — a sentence that merely NARRATES a count (see
// `runAlpInTerminal`, "Two call sites shipped that way", which describes a
// fixed bug) simply carries no annotation and is left alone.
//
//   @callers <n> <symbol>
//       `<symbol>` has exactly <n> call sites under `src/`.
//
//   @quotes <repo-relative-path> "<exact text>"
//       the prose beside it quotes a string that really lives in that file.
//       The PATH is the load-bearing half: naming the file pins which SURFACE
//       the string belongs to, which is precisely what the button-vs-palette
//       mix-up in test/notify.guard.test.js got wrong.
//
//   test/fixtures/comment-claims.ts
//       every "the compiler refuses X / TSnnnn" claim about the `verify`
//       argument, written out as code and compiled with the repo's own
//       compilerOptions. Both the refusals AND the holes are pinned.
//
// HOW CALL SITES ARE COUNTED. Lexically, over comment- and string-stripped
// source under `src/`: an occurrence of `<symbol>` followed by `(`, not
// preceded by an identifier character or a `.`, and not the `function`
// declaration itself. Recursion counts (it is a call site). Tests do NOT
// count: `@callers` describes the shape of the SHIPPED extension — how many
// places in the product reach this code — and folding the suite in would make
// every number move when a test is added, which is a different fact and a
// noisier one.
//
// ── WHAT STAYS UNGUARDED (read this before trusting a green run) ───────────
//
// "Is this comment true?" is not gateable, and a test that tried would be
// flaky enough that everyone learns to ignore it — worse than no gate. Only
// mechanically checkable claims are converted. Still on the reviewer:
//
//  1. THE PROSE ITSELF. Only the annotation is checked. The sentence next to
//     `@callers 5` can say anything; a reflow that rewrites the sentence and
//     leaves the number alone stays green.
//  2. UNANNOTATED CLAIMS. This guard checks what is annotated; it cannot find
//     claims. Nothing forces a newly written caller-count sentence to carry
//     `@callers`, and nothing ever will without parsing English.
//  3. WHO the callers are. `@callers` pins the count, not the identities.
//     Swap one caller for another and the count holds.
//  4. Call sites outside `src/` — `test/`, `packages/alp-core`,
//     `packages/alp-webview`, `scripts/`.
//  5. INDIRECT calls. A symbol passed as a value (`arr.map(fn)`), re-exported
//     under an alias, or reached through a property is not counted: this is a
//     lexical scan, not a type-aware reference search.
//  6. src/alpCli/service.ts's TS18047 claim about `cliSkew`'s narrowing. The
//     type it narrows is `parseVersion`'s return, which is module-private, so
//     a fixture could only carry a hand-copied SECOND COPY of it — the exact
//     drift this file exists to remove. Left to review, deliberately.
//  7. IDENTIFIER CENSUSES — "no other file in `src/` names `cachedBinaryPath`".
//     Checkable in principle; in practice it reds on every log line added, so
//     it would become the guard nobody trusts.
//  8. RUNTIME claims — "never throws", "one-shot per version", "fires and
//     forgets". Behavioural tests cover those or nothing does.
//  9. Anything outside `src/**/*.ts` — `docs/`, `CHANGELOG.md`, PR bodies,
//     commit messages. Source comments only.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const FIXTURE = path.join(__dirname, "fixtures", "comment-claims.ts");
const FIXTURE_TSCONFIG = path.join(
  __dirname,
  "fixtures",
  "comment-claims.tsconfig.json",
);

function tsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Split a TypeScript source into three parallel views — `code`, `comments`,
 * `strings` — each the same length as the input with the other two blanked to
 * spaces (newlines kept, so byte offsets, and therefore line numbers, survive
 * in all three).
 *
 * The separation is the whole point: a symbol named in a log message is not a
 * call site, a string quoted in a comment is not a string the file ships, and
 * an annotation is only an annotation when a real comment carries it.
 *
 * Known limits, both accepted: a template literal's `${…}` body is treated as
 * string, so a call written inside an interpolation is not counted; and a
 * regex literal containing a quote character would desync the scan (none
 * exists in `src/` — the scanners' self-check would not catch that, a wrong
 * count would).
 */
function split(source) {
  const view = { code: "", comments: "", strings: "" };
  const emit = (ch, into) => {
    const blank = ch === "\n" ? "\n" : " ";
    for (const key of Object.keys(view)) view[key] += key === into ? ch : blank;
  };
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < source.length && source[i] !== "\n")
        emit(source[i++], "comments");
    } else if (two === "/*") {
      while (i < source.length && source.slice(i, i + 2) !== "*/")
        emit(source[i++], "comments");
      emit("*", "comments");
      emit("/", "comments");
      i += 2;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      emit(source[i++], "code");
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          emit(" ", "strings");
          emit(source[i + 1] === "\n" ? "\n" : " ", "strings");
          i += 2;
          continue;
        }
        emit(source[i++], "strings");
      }
      if (i < source.length) emit(source[i++], "code");
    } else {
      emit(source[i++], "code");
    }
  }
  return view;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

/** Every `src/**` file, pre-split once — the scans below all reuse this. */
const SOURCES = tsFiles(SRC).map((file) => {
  const raw = fs.readFileSync(file, "utf8");
  return { file, rel: rel(file), ...split(raw) };
});

/** Call sites of `symbol` under `src/`, excluding its `function` declaration. */
function callSites(symbol) {
  const call = new RegExp(`(^|[^A-Za-z0-9_$.])${symbol}\\s*\\(`, "g");
  const sites = [];
  for (const source of SOURCES) {
    for (const match of source.code.matchAll(call)) {
      const at = match.index + match[1].length;
      if (isDeclaration(source.code, at)) continue;
      sites.push(`${source.rel}:${lineOf(source.code, at)}`);
    }
  }
  return sites;
}

/**
 * True when the `symbol(` at `at` is the symbol being DECLARED rather than
 * called.
 *
 * Four spellings, and the first version of this guard caught only the first —
 * which mattered more than it looks. A declaration counted as a call inflates
 * the real count by one, the annotator bumps the number to green the gate, and
 * the annotation now asserts a caller count the code does not have. That is
 * this file's own failure mode, laundered through the thing meant to prevent
 * it, so the exclusion is deliberately wider than the symbols in use today:
 * none of the five currently annotated is a method, a signature or a generator.
 *
 *   function foo(        — plain declaration
 *   function* foo(       — generator; `*` is not `\s`, so a `\s*$` test misses it
 *   class C { foo( }     — method definition
 *   interface I { foo( } — call-signature member
 *
 * The last two cannot be told from a call by looking left alone (`obj.foo()` is
 * already excluded by the `[^A-Za-z0-9_$.]` prefix, but a bare `foo(` inside a
 * class body is shaped exactly like a call). They are identified by the
 * enclosing `class`/`interface` block, which is the cheapest thing that is
 * correct here — a real reference search would need the type checker, and that
 * is the trade the UNGUARDED list already records.
 */
function isDeclaration(code, at) {
  const before = code.slice(0, at);
  if (/\bfunction\s*\*?\s*$/.test(before)) return true;

  // Walk back to the innermost unclosed `{` and see what opened it.
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const ch = before[i];
    if (ch === "}") depth += 1;
    else if (ch === "{") {
      if (depth === 0) {
        return /\b(class|interface)\b[^{};]*$/.test(before.slice(0, i));
      }
      depth -= 1;
    }
  }
  return false;
}

function annotations(pattern) {
  const found = [];
  for (const source of SOURCES) {
    for (const match of source.comments.matchAll(pattern)) {
      found.push({
        at: `${source.rel}:${lineOf(source.comments, match.index)}`,
        groups: match.slice(1),
      });
    }
  }
  return found;
}

const CALLERS = /@callers\s+(\d+)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
const QUOTES = /@quotes\s+(\S+)\s+"([^"]*)"/g;

test("every @callers annotation matches the real call-site count", () => {
  const claims = annotations(CALLERS);
  assert.ok(
    claims.length > 0,
    "no @callers annotation found — either they were all deleted or `split()` " +
      "stopped seeing comments; a guard with nothing to check is worse than none",
  );

  const wrong = claims
    .map(({ at, groups: [claimed, symbol] }) => ({
      at,
      symbol,
      claimed: Number(claimed),
      sites: callSites(symbol),
    }))
    // Zero is never a legitimate claim, and treating it as one is how this
    // guard passes while checking nothing: a misspelt or renamed symbol finds
    // no sites, and `0 === 0` would hold. An annotation exists to pin a
    // chokepoint, so there is always at least one caller to pin.
    .filter((c) => c.sites.length !== c.claimed || c.claimed === 0)
    .map(
      (c) =>
        `${c.at}  @callers ${c.claimed} ${c.symbol}  ->  ${c.sites.length} ` +
        `actual: ${c.sites.join(", ") || "(none — renamed or misspelt?)"}`,
    );

  assert.deepEqual(
    wrong,
    [],
    "A doc comment states a caller count the code no longer has. Either a " +
      "call site was added/removed and the sentence beside the annotation now " +
      "misdescribes the code, or the symbol was renamed and the annotation " +
      "was not. Re-READ the sentence, do not just bump the number — the " +
      "sentence usually explains WHY the count matters (a chokepoint, a guard " +
      "placed once instead of per-caller), and that reasoning is what breaks " +
      "first.\nMismatches:\n  " +
      wrong.join("\n  "),
  );
});

test("every @quotes annotation names a file that really contains the string", () => {
  const claims = annotations(QUOTES);
  assert.ok(claims.length > 0, "no @quotes annotation found");

  const wrong = claims
    .filter(({ groups: [target, text] }) => {
      const full = path.join(ROOT, target);
      if (!fs.existsSync(full)) return true;
      const raw = fs.readFileSync(full, "utf8");
      // String literals only for TypeScript: comments in the TARGET must not
      // satisfy the claim, or two comments quoting each other would both pass.
      const body = target.endsWith(".ts") ? split(raw).strings : raw;
      return !body.includes(text);
    })
    .map(
      ({ at, groups: [target, text] }) => `${at}  @quotes ${target} "${text}"`,
    );

  assert.deepEqual(
    wrong,
    [],
    "A comment quotes a string that is not in the file it names. Either the " +
      "string was reworded and the prose still quotes the old one, or the " +
      "prose is quoting the WRONG SURFACE — the failure that took a review " +
      "round when a toast button label was described using the command-palette " +
      "title (see the tail of test/notify.guard.test.js).\nMismatches:\n  " +
      wrong.join("\n  "),
  );
});

// ── "the compiler refuses X" ───────────────────────────────────────────────
//
// Six claims about the `verify` argument, three refusals and three holes.
// Compiled through the repo's own compilerOptions, so the codes asserted are
// the codes the shipped build emits — a TypeScript bump that changes one reds
// here and the comments get corrected with it.
const EXPECT = /^\s*\/\/\s*@expect\s+(TS\d+|none)\s*$/;

test("the compiler emits exactly the codes the download-seam comments name", () => {
  const fixtureLines = fs.readFileSync(FIXTURE, "utf8").split("\n");
  const markers = fixtureLines
    .map((text, index) => ({ line: index + 1, match: EXPECT.exec(text) }))
    .filter((m) => m.match)
    .map((m) => ({ line: m.line, expected: m.match[1] }));

  assert.ok(markers.length > 0, "the fixture carries no @expect markers");

  // An `@expect none` marker whose statement was deleted asserts nothing and
  // stays green — the three `@expect TSnnnn` markers cannot go vacuous this way
  // (a missing error is a mismatch), but the hole-pinning `none` markers can.
  // Require every marker to still have CODE under it.
  //
  // Getting this right took three attempts and both failures were the same
  // mistake this whole file is about — a check that looked correct and asserted
  // nothing on the input it was written for:
  //
  //   1. "next non-blank line that is not a marker" — a `//` comment satisfied
  //      it, and deleting a statement leaves the prose introducing the NEXT
  //      case sitting right there.
  //   2. "next non-blank, non-comment line" — that search runs straight PAST
  //      the following marker and finds ITS statement, so an orphan in the
  //      middle of the file is always adopted by its neighbour.
  //
  // So the scan must stop at the next marker: hitting one before any code means
  // this marker has none of its own.
  const orphaned = markers
    .filter(({ line }) => {
      for (const text of fixtureLines.slice(line)) {
        if (text.trim() === "" || /^\s*\/\//.test(text)) {
          if (EXPECT.test(text)) return true;
          continue;
        }
        return /^\s*[}\])]/.test(text);
      }
      return true;
    })
    .map(({ line, expected }) => `${rel(FIXTURE)}:${line} @expect ${expected}`);
  assert.deepEqual(
    orphaned,
    [],
    "an @expect marker has no statement under it, so it asserts nothing about " +
      "the compiler. Restore the line it was written for, or delete the marker " +
      "with it.\nOrphaned:\n  " +
      orphaned.join("\n  "),
  );

  const tsc = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  const run = spawnSync(
    process.execPath,
    [tsc, "--noEmit", "--pretty", "false", "-p", FIXTURE_TSCONFIG],
    { cwd: ROOT, encoding: "utf8" },
  );
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  assert.equal(
    run.error,
    undefined,
    `could not run ${rel(tsc)} — the fixture was never compiled, so this test ` +
      `proved nothing: ${run.error}`,
  );

  const diagnostics = [];
  for (const line of output.split(/\r?\n/)) {
    const parsed = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line);
    if (parsed) {
      diagnostics.push({
        file: parsed[1].split(path.sep).join("/"),
        line: Number(parsed[2]),
        code: parsed[3],
        message: parsed[4],
      });
    }
  }

  const strays = diagnostics
    .filter((d) => !d.file.endsWith("fixtures/comment-claims.ts"))
    .map((d) => `${d.file}:${d.line} ${d.code} ${d.message}`);
  assert.deepEqual(
    strays,
    [],
    "the fixture's program reported errors outside the fixture — src/ does " +
      "not compile, so nothing below can be trusted:\n  " +
      strays.join("\n  "),
  );

  // Attribute each diagnostic to the nearest preceding marker, so a statement
  // may wrap across lines without moving what it is compared against.
  const actual = new Map(markers.map((m) => [m.line, []]));
  const unattributed = [];
  for (const diagnostic of diagnostics.filter((d) =>
    d.file.endsWith("fixtures/comment-claims.ts"),
  )) {
    const owner = markers.filter((m) => m.line <= diagnostic.line).pop();
    if (!owner) {
      unattributed.push(
        `line ${diagnostic.line} ${diagnostic.code}: ${diagnostic.message}`,
      );
      continue;
    }
    actual.get(owner.line).push(diagnostic.code);
  }

  assert.deepEqual(
    unattributed,
    [],
    "a diagnostic landed above the first @expect marker — the fixture's " +
      "preamble does not compile:\n  " +
      unattributed.join("\n  "),
  );

  const wrong = markers
    .map((m) => ({
      ...m,
      got: actual.get(m.line).sort().join("+") || "none",
    }))
    .filter((m) => m.got !== m.expected)
    .map(
      (m) =>
        `test/fixtures/comment-claims.ts:${m.line}  expected ${m.expected}, ` +
        `got ${m.got}`,
    );

  assert.deepEqual(
    wrong,
    [],
    "A 'the compiler refuses X' claim in src/alpCli/ no longer holds. A " +
      "refusal that became a different code means the comment names the wrong " +
      "TSnnnn; a refusal that disappeared means the comment promises a " +
      "guarantee the build no longer gives; and an `@expect none` that started " +
      "erroring means a documented HOLE closed, so the comment now " +
      "under-claims and the behavioural test it points at may be redundant. " +
      "Read the marker's comment in the fixture for the source sentence.\n" +
      "Mismatches:\n  " +
      wrong.join("\n  "),
  );
});

test("the scanners can actually see a violation", () => {
  // Proves the guard is not vacuously green: an annotation is read out of a
  // comment and never out of code or a string, and a call site is counted out
  // of code and never out of a comment or a string.
  const { code, comments, strings } = split(
    [
      "// @callers 3 widget",
      'const decoy = "@callers 99 widget";',
      "widget();",
      "// widget();",
      'log("widget()");',
      "function widget() {}",
    ].join("\n"),
  );

  assert.deepEqual(
    [...comments.matchAll(CALLERS)].map((m) => [m[1], m[2]]),
    [["3", "widget"]],
    "an annotation must be readable from a comment and NOT from a string",
  );
  assert.ok(
    strings.includes("@callers 99 widget") &&
      !strings.includes("@callers 3 widget"),
    "the strings view — what @quotes searches — must hold literals and no " +
      "comment text, or a comment quoting itself would satisfy its own claim",
  );

  const call = /(^|[^A-Za-z0-9_$.])widget\s*\(/g;
  const seen = [...code.matchAll(call)]
    .filter((m) => !/\bfunction\s*$/.test(code.slice(0, m.index + m[1].length)))
    .map((m) => lineOf(code, m.index + m[1].length));
  assert.deepEqual(
    seen,
    [3],
    "only the real call on line 3 counts — not the commented-out one, not " +
      "the one inside a string, and not the declaration",
  );
});
