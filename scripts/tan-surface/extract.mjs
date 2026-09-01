#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Extract every `tan` invocation this extension can make, straight from the
// TypeScript AST, and emit the INVOCATION RECORD the surface gate consumes.
//
// ── Why an AST and not a grep ────────────────────────────────────────────────
// The argv arrays this repo builds are overwhelmingly MULTI-LINE — prettier
// breaks `runAlpCommand(this.context, ["model", "add", id, "--board", ...], …)`
// across four or five lines the moment it exceeds 80 columns. A line-oriented
// regex sees the first line, finds no closing bracket, and moves on WITHOUT
// SAYING ANYTHING: the invocation simply is not in the output, and a gate built
// on that output goes green because it never learned the site exists. A missed
// site is indistinguishable from a correct site in every downstream report,
// which is the failure mode this whole gate is meant to prevent. So the source
// is parsed, not matched.
//
// ── The parser this file uses, and why it is not `ts.createSourceFile` ───────
// This repo pins `typescript@7.0.2` — the NATIVE (Go) compiler. TypeScript 7
// deleted the old JS compiler API: `require("typescript")` resolves to
// `lib/version.cjs` and exposes NOTHING but the version string. There is no
// `ts.createSourceFile`, no `ts.forEachChild`, no `ts.SyntaxKind` on that
// entry point — verified, not assumed. The AST lives behind two unstable
// subpath exports instead:
//
//   typescript/unstable/sync  — `API`, which spawns the bundled `tsgo` and
//                               hands back real `SourceFile` nodes per project
//   typescript/unstable/ast   — `SyntaxKind`, the `isX` predicates,
//                               `getTokenPosOfNode`, `computeLineStarts`
//
// `node.forEachChild(visitor)` is a METHOD on the node in this API, not a free
// function. Loading all 174 files takes ~200 ms, so the cost of a real parse is
// not a reason to reach for text matching.
//
// These exports are marked unstable by TypeScript. If a `typescript` bump
// breaks the two imports below, this script fails LOUDLY at import time — it
// cannot silently degrade to finding zero call sites, because a zero-site
// extract is rejected in `main()` before anything is printed.
//
// ── What a record claims, and the THREE states it can claim it in ───────────
// A record says: this file:line runs `tan <command>` with these flags and these
// positionals. When the argv array cannot be statically reduced to that — a
// variable is passed instead of a literal array, a non-literal is spread, a
// conditional picks between shapes — the site is still emitted and NEVER
// dropped. Dropping it would tell the gate the call does not exist; reporting
// it tells the gate the call exists and is beyond static reach. Those are
// opposite claims and only one of them is true.
//
// The original two-state `resolvable` boolean threw away most of what a
// half-readable site does say, and it cost real coverage: 23 of 46 sites were
// `resolvable: false` and therefore invisible to EVERY assertion, yet eleven of
// those 23 are array literals whose only problem is one opaque element or a
// spread — `["flash", ...target.appArg]`, `["model", "add", id, "--board",
// "board.yaml"]`. The command and the literal flags in those are perfectly
// readable, and `--board` on `tan model` is either accepted or it is not
// regardless of what `id` turns out to be at runtime.
//
//   resolution: "full"     every token is a literal. Every assertion applies.
//   resolution: "partial"  the command is a leading string literal and at
//                          least one later token is opaque. The command and
//                          the literal flags are FACTS; the positional COUNT
//                          is not, because an opaque element may be a
//                          positional or may be some flag's value. So the gate
//                          runs the command/flag/inert checks and skips the
//                          arity check — checking what is known instead of
//                          discarding it with what is not.
//   resolution: "none"     the command itself is unreadable (a bare
//                          identifier, or a leading spread that does not
//                          resolve). Nothing can be checked; the site is
//                          pinned by name in the gate's expected list.
//
// A LEADING spread means the command is not the first element. It is resolved
// only when the spread's identifier BINDS — in the checker's own symbol table,
// not by name — to a `const` in this same file whose initializer is an array
// literal. Everything else is a gap.
//
// That rule used to be enforced by name, and enforcing it by name fabricated
// records. The old inliner collected every `const <name> = [ … ]` ANYWHERE in
// a file into one flat table, with no scope model, and inlined it into ANY
// `...<name>` spread in that file. Its only guard was "a second `const` of the
// same name poisons the entry" — which a parameter, a `let`, a `var`, a catch
// binding, a destructured binding or an import never trips, because none of
// them is a `const … = [ … ]`. So a spread that syntactically binds to a
// PARAMETER was inlined from an unrelated array and emitted as
// `resolution: "full"` with that array's flags in it. A confident wrong answer
// is worse than the `"none"` it should have produced: `"none"` puts the site
// on the gate's pinned unresolvable list where a human reads it, while a
// fabricated `"full"` record is checked against the CLI and quietly passes.
// `test/fixtures/tan-surface/const-scope.ts` is one function per binding shape
// that got this wrong.
//
// The scope model is the compiler's, obtained rather than re-implemented:
// `project.checker.getSymbolAtLocation(identifier)` answers WHICH binding this
// identifier reaches, and `symbol.declarations[0].resolve()` turns the
// checker's detached `NodeHandle` back into a navigable node (the handle
// itself carries only `kind`, `path` and `index` — no `parent`, no
// `initializer`, no positions). A hand-rolled scope walk would be a second,
// worse copy of a thing the compiler already did correctly.
//
// ONE LIMIT REMAINS AND IS NOT CLOSED HERE: `const` freezes the BINDING, not
// the array. `const FLAGS = ["--plan"]; FLAGS.push("--execute");` still reads
// as `["--plan"]`. Detecting that means finding every reference to the symbol,
// which is a different question from the one this file asks; the old inliner
// had the same hole and neither the gate nor this note should imply otherwise.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as ast from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

const SK = ast.SyntaxKind;

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

/** The seven functions that reach the `tan` binary. Anything not on this list
 *  cannot spawn the CLI, and anything on it must be matched EXACTLY — `runAlp`
 *  is a prefix of five of the others, so a `startsWith` test would fold them
 *  all into one runner and lose which signature applies. */
const RUNNERS = [
  "runAlp",
  "runAlpAsync",
  "runAlpCommand",
  "runAlpStreamed",
  "runAlpInTerminal",
  "runAlpWithProgress",
  "runDoctor",
];

/** Default location of the committed surface snapshot (the contract's path). */
const DEFAULT_SNAPSHOT = path.join(
  REPO_ROOT,
  "test/golden/tan-surface/surface.json",
);

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "out",
  ".git",
  ".probe-tmp",
]);

// ── file discovery ──────────────────────────────────────────────────────────

/** Every `.ts` (never `.d.ts`) under a directory, recursively. */
function collectTsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectTsFiles(full, out);
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Every `.ts` under `src`, plus every `.ts` under each package's own `src`,
 *  plus anything `--include` added. Sorted so two runs on the same
 *  tree emit byte-identical JSON — a gate that diffs its own output cannot
 *  afford readdir order.
 *
 *  `--include` ADDS to that set rather than replacing it, and the difference
 *  matters: `deriveArgvIndices` reads each runner's real declaration to learn
 *  which parameter holds argv, and those declarations live in `src/`. An
 *  `--include` that replaced the walk would extract a fixture against a
 *  guessed argv slot, which is the failure mode `deriveArgvIndices` exists to
 *  prevent. */
function discoverSources(extraPaths = []) {
  const files = collectTsFiles(path.join(REPO_ROOT, "src"));
  const packagesDir = path.join(REPO_ROOT, "packages");
  if (fs.existsSync(packagesDir)) {
    for (const pkg of fs.readdirSync(packagesDir).sort()) {
      collectTsFiles(path.join(packagesDir, pkg, "src"), files);
    }
  }
  for (const extra of extraPaths) {
    if (!fs.existsSync(extra)) {
      throw new Error(`--include path does not exist: ${extra}`);
    }
    if (fs.statSync(extra).isDirectory()) collectTsFiles(extra, files);
    else files.push(extra);
  }
  return [...new Set(files)].sort();
}

// ── AST helpers ─────────────────────────────────────────────────────────────

/** Name of a call's callee for both `runAlp(…)` and `obj.runAlp(…)`. Returns
 *  undefined for anything else (element access, call of a call, …) so an
 *  exotic callee is never mistaken for a runner. */
function calleeName(expr) {
  if (expr.kind === SK.Identifier) return expr.text;
  if (
    expr.kind === SK.PropertyAccessExpression &&
    expr.name?.kind === SK.Identifier
  ) {
    return expr.name.text;
  }
  return undefined;
}

/** Source text of a node WITHOUT its leading trivia (comments/blank lines),
 *  whitespace collapsed to single spaces so a five-line argv array renders as
 *  the one-line `rawText` the record contract shows. */
function nodeText(node, sourceFile) {
  const start = ast.getTokenPosOfNode(node, sourceFile);
  return sourceFile.text.slice(start, node.end).replace(/\s+/g, " ").trim();
}

/** 1-based line of a position, via the source file's line starts. */
function lineOf(lineStarts, pos) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => {
    walk(child, visit);
  });
}

// ── which argument carries argv ─────────────────────────────────────────────

/**
 * Derive, per runner, WHICH PARAMETER holds the argv array — read off the real
 * declaration rather than hard-coded here.
 *
 * A hard-coded table is a second copy of a fact that already exists in the
 * source, and the two drift the first time somebody inserts a parameter: the
 * extractor would then read `cwd` (a string) as argv, find no array, and mark
 * every site in the repo `resolvable: false` — a green-looking run that reports
 * nothing. Deriving it means a signature change either still resolves or fails
 * loudly, and never quietly reads the wrong slot.
 *
 * The parameter is identified by BOTH its name (`args`) and its type
 * (`string[]`); requiring both is what stops a future `extraArgs: string[]`
 * from being picked up as the argv slot.
 */
function deriveArgvIndices(sourceFiles) {
  const found = new Map();
  for (const { file, sourceFile } of sourceFiles) {
    walk(sourceFile, (node) => {
      if (node.kind !== SK.FunctionDeclaration) return;
      const name = node.name?.text;
      if (!name || !RUNNERS.includes(name)) return;
      const params = node.parameters ?? [];
      const index = params.findIndex(
        (p) =>
          p.name?.kind === SK.Identifier &&
          p.name.text === "args" &&
          p.type &&
          nodeText(p.type, sourceFile) === "string[]",
      );
      if (index < 0) return;
      const line = lineOf(
        ast.computeLineStarts(sourceFile.text),
        ast.getTokenPosOfNode(node, sourceFile),
      );
      const previous = found.get(name);
      if (previous && previous.index !== index) {
        throw new Error(
          `two declarations of ${name} disagree on the argv parameter index ` +
            `(${previous.file}:${previous.line} says ${previous.index}, ` +
            `${file}:${line} says ${index}) — resolve the ambiguity before extracting`,
        );
      }
      found.set(name, { index, file, line });
    });
  }
  const missing = RUNNERS.filter((r) => !found.has(r));
  if (missing.length > 0) {
    throw new Error(
      `no declaration with an \`args: string[]\` parameter found for: ${missing.join(", ")}. ` +
        `A runner whose argv slot cannot be located must not be extracted from — ` +
        `guessing the slot produces confident, wrong records.`,
    );
  }
  return found;
}

// ── argv reduction ──────────────────────────────────────────────────────────

const TOKEN_LITERAL = "literal";
const TOKEN_OPAQUE = "opaque";
const TOKEN_GAP = "gap"; // a spread of something that is not a literal array

const RESOLUTION_FULL = "full";
const RESOLUTION_PARTIAL = "partial";
const RESOLUTION_NONE = "none";

/** The `SourceFile` a node belongs to, by walking parents. The depth cap is
 *  paranoia about a malformed parent chain, not a real shape: no TypeScript
 *  node nests two thousand deep, and a `while (true)` here would hang the
 *  extractor instead of failing it. */
function ownerSourceFile(node) {
  let current = node;
  for (let depth = 0; current && depth < 2000; depth += 1) {
    if (current.kind === SK.SourceFile) return current;
    current = current.parent;
  }
  return undefined;
}

/**
 * Build the `...name` → array-literal resolver for ONE file.
 *
 * Everything here is a refusal except the one shape that is provably static:
 * a single declaration, which is a `VariableDeclaration`, whose declaration
 * LIST carries the `Const` flag, whose initializer is an array literal, and
 * which lives in this same file. Each of those rules out a shape the old
 * name-matched table got wrong:
 *
 *   not a VariableDeclaration   a `Parameter` (the demonstrated defect), a
 *                               `BindingElement` (`const { FLAGS } = opts`),
 *                               an `ImportSpecifier`, a `FunctionDeclaration`.
 *   parent is not a list        a catch binding is a `VariableDeclaration`
 *                               whose parent is the `CatchClause` itself, so
 *                               the `Const` test below would read the flags of
 *                               the wrong node entirely.
 *   no `Const` flag             `let` / `var`: rebindable between the
 *                               declaration and the spread, so the elements
 *                               read here would be a stale guess.
 *   initializer is not an array `const FLAGS = build()`, `const FLAGS = cond ?
 *                               a : b` — `src/ideHub/newProjectFlowPanel.ts`'s
 *                               `root` is exactly the ternary, and it must
 *                               stay a gap.
 *   another file                a re-exported const array is resolvable in
 *                               principle; it is refused because this walk
 *                               only holds one file's text and reporting a
 *                               command read out of a file it never opened is
 *                               the same class of claim this whole change
 *                               removes.
 *
 * More than one declaration is refused too: a symbol with two of them is a
 * merged or conditionally-declared binding, and picking one of two would put
 * a command name in the record that the call may never send.
 *
 * Any failure inside the checker is a refusal, not a throw. The checker talks
 * to a separate `tsgo` process; a site it cannot answer for is a site whose
 * argv we do not know, which is precisely a gap.
 */
function makeSpreadResolver(checker, sourceFile) {
  return function resolveSpreadArray(identifier) {
    let symbol;
    try {
      symbol = checker.getSymbolAtLocation(identifier);
    } catch {
      return undefined;
    }
    if (!symbol) return undefined;

    let declaration;
    try {
      const declarations = symbol.declarations ?? [];
      if (declarations.length !== 1) return undefined;
      // The checker hands back a `NodeHandle`, which carries `kind`, `path`
      // and `index` and NOTHING else — no parent, no initializer, no
      // positions. `resolve()` is what turns it into the real node.
      declaration = declarations[0]?.resolve?.() ?? undefined;
    } catch {
      return undefined;
    }
    if (!declaration || declaration.kind !== SK.VariableDeclaration) {
      return undefined;
    }

    const list = declaration.parent;
    if (!list || list.kind !== SK.VariableDeclarationList) return undefined;
    if ((list.flags & ast.NodeFlags.Const) === 0) return undefined;
    if (declaration.initializer?.kind !== SK.ArrayLiteralExpression) {
      return undefined;
    }
    if (ownerSourceFile(declaration) !== sourceFile) return undefined;
    return declaration.initializer;
  };
}

/** Flatten an argv array literal's elements into a token stream. A spread of
 *  an INLINE array literal is genuinely static, so it is inlined; a spread of
 *  an identifier the checker binds to a same-file `const` array literal is
 *  inlined too; a spread of anything else becomes a gap of unknown length and
 *  unknown content. */
function tokenizeElements(
  elements,
  resolveSpreadArray,
  tokens = [],
  seen = new Set(),
) {
  for (const element of elements) {
    if (element.kind === SK.SpreadElement) {
      const operand = element.expression;
      if (operand?.kind === SK.ArrayLiteralExpression) {
        tokenizeElements(operand.elements, resolveSpreadArray, tokens, seen);
        continue;
      }
      // `seen` closes a cycle: `const a = [...b]; const b = [...a]` parses, and
      // an unguarded inliner would recurse until the stack goes. Keyed on the
      // resolved DECLARATION's span rather than on the name, for the same
      // reason the resolution itself is: two different bindings can share a
      // name, and a name-keyed guard would refuse the second one for the
      // first one's sake.
      const bound =
        operand?.kind === SK.Identifier
          ? resolveSpreadArray(operand)
          : undefined;
      const key = bound ? `${bound.pos}:${bound.end}` : undefined;
      if (bound && !seen.has(key)) {
        seen.add(key);
        tokenizeElements(bound.elements, resolveSpreadArray, tokens, seen);
        seen.delete(key);
      } else {
        tokens.push({ kind: TOKEN_GAP });
      }
      continue;
    }
    if (
      element.kind === SK.StringLiteral ||
      element.kind === SK.NoSubstitutionTemplateLiteral
    ) {
      tokens.push({ kind: TOKEN_LITERAL, value: element.text });
      continue;
    }
    // Identifiers, property accesses, calls, conditionals, template strings
    // with substitutions: a value we cannot know, in a slot we still must
    // account for.
    tokens.push({ kind: TOKEN_OPAQUE });
  }
  return tokens;
}

function isFlagToken(token) {
  return (
    token.kind === TOKEN_LITERAL &&
    token.value.startsWith("-") &&
    token.value !== "-" &&
    token.value !== "--"
  );
}

/**
 * Reduce a token stream to
 * `{ command, flags, positionalCount, positionalValues, danglingFlags, resolution }`.
 *
 * The metavar table is load-bearing, not decoration: `["flash", "--core", id]`
 * has ZERO positionals because `--core` takes a value and swallows `id`,
 * while the same `id` after a boolean flag is a STRAY POSITIONAL — the #543
 * defect class, where a flag that never took an argument silently turned the
 * next array element into an argument the command does not accept. Telling
 * those two apart is only possible with the snapshot's per-flag `metavar`,
 * which is why this script refuses to run without one unless asked to.
 *
 * `positionalValues` is the same walk's answer to a question the count cannot
 * carry: WHICH positional. The gate previously re-derived the subcommand from
 * `rawText` with a small bracket-matching parser, and that parser gave up on
 * anything after a token starting with `-` — so `["sdk", "--format", "json",
 * "list"]`, argv real tan accepts (exit 0, `"subcommand":"list"`), was
 * reported as a hole in the gate. It is not a hole; it is legal argv whose
 * subcommand sits third because `--format` ate the token before it. Only the
 * walk that already knows every flag's arity can say that, so it says it here
 * and the gate reads it. A slot whose value is opaque is `null`, never
 * omitted: the LENGTH must keep matching `positionalCount`.
 *
 * `positionalsAnchored` is how many LEADING entries of `positionalValues` sit
 * at an index we actually know. A gap is of unknown LENGTH, so every
 * positional after one has an unknown ordinal: in `["model", ...maybe, "add"]`
 * the literal `"add"` is a positional, but whether it is the FIRST one depends
 * on what `maybe` holds. The gate reads the subcommand from index 0, and index
 * 0 is a claim about ordinal, not just value — so it may only read entries
 * below this number. Everything before the first post-command gap is anchored;
 * an opaque single ELEMENT does not break the anchor, because it occupies
 * exactly one slot and is recorded in place as `null`.
 *
 * `danglingFlags` records the other half of the arity fact: a value-taking
 * flag with NOTHING after it. `["model", "--board"]` reduces cleanly, passes
 * every membership check, and real tan exits 2 with
 * `Option '--board' requires an argument`. Skipping it silently (the old
 * `if (next === undefined) continue`) made a guaranteed usage error look like
 * a healthy call.
 */
function reduceTokens(tokens, metavars) {
  let command = null;
  const flags = [];
  const positionalValues = [];
  const danglingFlags = [];
  let opaque = false;
  let endOfOptions = false;
  let positionalsAnchored = Infinity;
  let commandTokenIndex = -1;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.kind === TOKEN_GAP) {
      // Unknown length AND unknown content: it could hold the command, a flag,
      // a positional, or nothing. Everything after it is still worth reading —
      // `[...root, "explain"]` really does run `tan explain` — but the record
      // can no longer claim to be complete.
      opaque = true;
      positionalsAnchored = Math.min(
        positionalsAnchored,
        positionalValues.length,
      );
      continue;
    }

    if (!endOfOptions && token.kind === TOKEN_LITERAL && token.value === "--") {
      endOfOptions = true;
      continue;
    }

    if (!endOfOptions && isFlagToken(token)) {
      const eq = token.value.indexOf("=");
      const name = eq > 1 ? token.value.slice(0, eq) : token.value;
      const hasInlineValue = eq > 1;
      flags.push(name);
      if (hasInlineValue) continue;
      const arity = metavars.arityOf(name, command);
      if (!arity.takesValue) continue;
      // A value-taking flag consumes the NEXT token whatever it is. An opaque
      // identifier here is a value we do not need to know, so it does not cost
      // the site its command or its flag list.
      const next = tokens[i + 1];
      if (next === undefined) {
        // Nothing left to consume. Not "nothing to see": click refuses this —
        // unless the value was OPTIONAL, in which case omitting it is what
        // optional means and there is nothing to report.
        if (!arity.valueOptional) danglingFlags.push(name);
        continue;
      }
      if (next.kind === TOKEN_GAP) {
        // The gap may or may not open with this flag's value — unknowable, and
        // that is exactly what a gap means. The loop does NOT skip it: the
        // next iteration reads it as a gap and anchors the positional list
        // there, which is the same uncertainty seen from the other side.
        opaque = true;
        continue;
      }
      if (arity.valueOptional) {
        // An OPTIONAL value is one this flag may or may not have taken, and
        // the argv alone cannot say which.
        //
        // A following FLAG, or the `--` end-of-options marker, settles it:
        // neither can be an optional value (that spelling has to be attached,
        // `--flag=V`), so the value is simply absent. The token is left for
        // the loop to read as what it is, and the record costs nothing.
        const nextEndsOptions =
          next.kind === TOKEN_LITERAL && next.value === "--";
        if (isFlagToken(next) || nextEndsOptions) continue;

        // Anything else is genuinely ambiguous: it may be the value, or it may
        // be the first positional. Reading it as a positional is what produces
        // a false `Got unexpected extra argument(s)`; reading it as the value
        // silently under-counts. So it is read as NEITHER claim — consumed, so
        // the positional count can never be inflated into a violation, and
        // marked opaque, which demotes the record to `partial` and takes the
        // arity arm off it entirely.
        //
        // `partial` is a PINNED state in the gate, so the degradation shows up
        // in a checked-in list rather than as a quiet exemption.
        opaque = true;
        positionalsAnchored = Math.min(
          positionalsAnchored,
          positionalValues.length,
        );
      }
      i += 1;
      continue;
    }

    // Positional slot.
    if (token.kind === TOKEN_OPAQUE) opaque = true;
    if (command === null) {
      if (token.kind === TOKEN_LITERAL) {
        command = token.value;
        commandTokenIndex = i;
      }
      // An opaque token in the command slot leaves `command` null: naming a
      // command we cannot read would be a fabricated fact.
      continue;
    }
    positionalValues.push(token.kind === TOKEN_LITERAL ? token.value : null);
  }

  // "partial" requires the command to be the LEADING literal. A command found
  // after a gap is a command we inferred from where the gap happened to end,
  // and a gap of unknown length cannot support that inference.
  const leadsWithCommand =
    command !== null &&
    tokens[0]?.kind === TOKEN_LITERAL &&
    !isFlagToken(tokens[0]) &&
    tokens[0].value === command;

  let resolution = RESOLUTION_FULL;
  if (opaque) {
    resolution = leadsWithCommand ? RESOLUTION_PARTIAL : RESOLUTION_NONE;
  } else if (command === null) {
    // No opaque token and still no command: an argv of only flags. Nothing to
    // check a flag against, so it is not a "full" reduction.
    resolution = RESOLUTION_NONE;
  }

  // Everything to the LEFT of the command, verbatim, with an unreadable token
  // recorded as `null` rather than dropped. The command is not always argv[0]
  // -- `["--project", dir, "build"]` is argv this repo already builds -- so a
  // consumer that has to reproduce this walk needs to see the prefix the walk
  // consumed, not just the command it landed on. `test/flash.dispatch.test.js`
  // reads it to prove the flash consent gate's own command reader
  // (`isFlashArgv`) recognises every site this extractor calls a flash: two
  // readers with two different ideas of where the command sits is how a flash
  // dispatch slips past a gate that is technically present.
  const commandPrefix =
    commandTokenIndex < 0
      ? null
      : tokens
          .slice(0, commandTokenIndex)
          .map((t) => (t.kind === TOKEN_LITERAL ? t.value : null));

  return {
    command,
    commandPrefix,
    flags,
    positionalCount: positionalValues.length,
    positionalValues,
    positionalsAnchored: Math.min(positionalsAnchored, positionalValues.length),
    danglingFlags,
    resolution,
  };
}

// ── the metavar table ───────────────────────────────────────────────────────

/** A flag with no recorded metavar takes no value. Shared, frozen, and named
 *  so the "unknown flag ⇒ boolean" assumption reads as a decision at every one
 *  of its call sites rather than as an inline `null`. */
const BOOLEAN_ARITY = Object.freeze({
  takesValue: false,
  valueOptional: false,
});

/** One snapshot option → its arity. `valueOptional` is only meaningful when
 *  the flag takes a value at all; a snapshot predating the field reads as
 *  mandatory, which is the pre-existing behaviour and not a silent widening. */
function arityOfOption(option) {
  const metavar = option?.metavar ?? null;
  if (metavar === null) return BOOLEAN_ARITY;
  return { takesValue: true, valueOptional: option?.valueOptional === true };
}

/**
 * Build the flag→arity lookup from the committed snapshot.
 *
 * Arity is TWO facts, not one: whether the flag takes a value at all
 * (`metavar`), and whether that value is OPTIONAL (`valueOptional`, the
 * snapshot's reading of a bracketed `[PATH]` cell). Collapsing them into a
 * boolean forces a choice between two false reports — an optional value read
 * as boolean turns the next token into a stray positional, and one read as
 * mandatory swallows a real positional.
 *
 * Two layers, in order:
 *   1. `commands[<command>].options[<flag>]` — the exact fact.
 *   2. a UNION across every command, for flags read before the command is
 *      known. `["--project", …, "build"]` puts a global option first, so
 *      `--project`'s arity has to be answered before `build` has been seen;
 *      the snapshot's `globalOptions` is a bare name list and carries no
 *      metavar of its own, so the union of the per-command declarations is
 *      where that answer comes from. In the union a non-null metavar wins
 *      (one command declaring `--target EMIT` proves the flag takes a value),
 *      and an OPTIONAL reading wins over a mandatory one — the union is
 *      already an approximation, and its errors should land on the side that
 *      degrades a record rather than the side that accuses a call site.
 *
 * A flag in NO command's option map is treated as boolean. That is the
 * gate's finding to report (an unknown flag), not this script's to hide.
 */
function loadMetavars(snapshotPath, { allowMissing }) {
  if (!fs.existsSync(snapshotPath)) {
    if (!allowMissing) {
      throw new Error(
        `surface snapshot not found: ${snapshotPath}\n` +
          `The per-flag \`metavar\` in that file is what separates a flag's VALUE from a ` +
          `stray positional (#543); without it every flag looks boolean and every value ` +
          `looks like an argument the command never accepted.\n` +
          `Pass --no-snapshot to extract structure only — degraded, and every ` +
          `value-carrying site is reported resolvable:false.`,
      );
    }
    process.stderr.write(
      "[surface:extract] DEGRADED: no snapshot — every flag treated as boolean, " +
        "so flag VALUES are counted as positionals, `positionalValues` is " +
        "wrong, and no dangling value-flag can be detected. Do not judge #543 " +
        "from this run.\n",
    );
    return {
      degraded: true,
      version: null,
      arityOf: () => BOOLEAN_ARITY,
    };
  }

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const commands = snapshot.commands ?? {};
  const union = new Map();
  for (const spec of Object.values(commands)) {
    for (const [flag, option] of Object.entries(spec.options ?? {})) {
      const arity = arityOfOption(option);
      const previous = union.get(flag);
      if (!previous) {
        union.set(flag, arity);
        continue;
      }
      union.set(flag, {
        takesValue: previous.takesValue || arity.takesValue,
        valueOptional: previous.valueOptional || arity.valueOptional,
      });
    }
  }

  return {
    degraded: false,
    version: snapshot.version ?? null,
    arityOf(flag, command) {
      const own = command ? commands[command]?.options?.[flag] : undefined;
      if (own) return arityOfOption(own);
      return union.get(flag) ?? BOOLEAN_ARITY;
    },
  };
}

// ── extraction ──────────────────────────────────────────────────────────────

function extract({ snapshotPath, allowMissingSnapshot, includePaths = [] }) {
  const metavars = loadMetavars(snapshotPath, {
    allowMissing: allowMissingSnapshot,
  });
  const files = discoverSources(includePaths);
  if (files.length === 0) {
    throw new Error(
      `no .ts sources found under ${REPO_ROOT}/src — wrong repo root?`,
    );
  }

  const api = new API({ cwd: REPO_ROOT });
  try {
    const snapshot = api.updateSnapshot({ openFiles: files });
    const sourceFiles = [];
    for (const file of files) {
      const project = snapshot.getDefaultProjectForFile(file);
      const sourceFile = project?.program.getSourceFile(file);
      if (!sourceFile) {
        // Not a soft failure: a file the compiler would not hand back is a file
        // whose invocations nobody looked at, and silence there is exactly the
        // blind spot this script exists to close.
        throw new Error(
          `the TypeScript API returned no SourceFile for ${path.relative(REPO_ROOT, file)} — ` +
            `refusing to report a surface that skipped a file`,
        );
      }
      // The checker is what answers WHICH binding a `...name` spread reaches.
      // Without it the only available answer is a name match, and a name match
      // is what fabricated records (see the header). A missing checker is
      // therefore a hard failure, not a reason to fall back.
      if (!project.checker) {
        throw new Error(
          `the TypeScript API returned no checker for the project owning ` +
            `${path.relative(REPO_ROOT, file)} — spread resolution would have ` +
            `to fall back to matching identifiers by name, which is the defect ` +
            `this extractor was fixed for. Refusing to run.`,
        );
      }
      sourceFiles.push({ file, sourceFile, checker: project.checker });
    }

    const argvIndices = deriveArgvIndices(sourceFiles);
    const records = [];

    for (const { file, sourceFile, checker } of sourceFiles) {
      const lineStarts = ast.computeLineStarts(sourceFile.text);
      const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
      const resolveSpreadArray = makeSpreadResolver(checker, sourceFile);

      walk(sourceFile, (node) => {
        if (node.kind !== SK.CallExpression) return;
        const runner = calleeName(node.expression);
        if (!runner || !RUNNERS.includes(runner)) return;

        const argvIndex = argvIndices.get(runner).index;
        const argv = node.arguments?.[argvIndex];
        const line = lineOf(
          lineStarts,
          ast.getTokenPosOfNode(node, sourceFile),
        );

        const unreadable = (rawText) => ({
          file: relative,
          line,
          runner,
          command: null,
          commandPrefix: null,
          flags: [],
          positionalCount: 0,
          positionalValues: [],
          positionalsAnchored: 0,
          danglingFlags: [],
          resolution: RESOLUTION_NONE,
          rawText,
        });

        if (argv === undefined) {
          // A runner called with fewer arguments than its signature declares
          // does not compile, so this means the argv slot moved under us.
          records.push(unreadable(`(no argument at index ${argvIndex})`));
          return;
        }

        if (argv.kind !== SK.ArrayLiteralExpression) {
          // A variable, a conditional, a call — the argv is assembled
          // elsewhere. Emitted, never dropped: the gate must know a site it
          // cannot read exists.
          records.push(unreadable(nodeText(argv, sourceFile)));
          return;
        }

        const tokens = tokenizeElements(argv.elements, resolveSpreadArray);
        const reduced = reduceTokens(tokens, metavars);
        const rawText = `[${argv.elements
          .map((element) => nodeText(element, sourceFile))
          .join(", ")}]`;

        records.push({
          file: relative,
          line,
          runner,
          command: reduced.command,
          commandPrefix: reduced.commandPrefix,
          flags: reduced.flags,
          positionalCount: reduced.positionalCount,
          positionalValues: reduced.positionalValues,
          positionalsAnchored: reduced.positionalsAnchored,
          danglingFlags: reduced.danglingFlags,
          resolution: reduced.resolution,
          rawText,
        });
      });
    }

    records.sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.runner.localeCompare(b.runner),
    );
    return { records, files, metavars };
  } finally {
    api.close();
  }
}

// ── entry point ─────────────────────────────────────────────────────────────

function parseArgv(argv) {
  const options = {
    snapshotPath: DEFAULT_SNAPSHOT,
    allowMissingSnapshot: false,
    compact: false,
    includePaths: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--snapshot") {
      const value = argv[++i];
      if (!value) throw new Error("--snapshot needs a path");
      options.snapshotPath = path.resolve(value);
    } else if (arg === "--include") {
      const value = argv[++i];
      if (!value) throw new Error("--include needs a path");
      options.includePaths.push(path.resolve(value));
    } else if (arg === "--no-snapshot") {
      options.allowMissingSnapshot = true;
      options.snapshotPath = "";
    } else if (arg === "--compact") {
      options.compact = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

const HELP = `Usage: node scripts/tan-surface/extract.mjs [options]

Emits the tan invocation record (JSON, stdout) for every call site under
src/ and packages/*/src.

  --snapshot <path>  surface snapshot to read metavars from
                     (default: test/golden/tan-surface/surface.json)
  --no-snapshot      run without one: DEGRADED, every flag treated as boolean
  --include <path>   extra .ts file or directory to walk IN ADDITION to the
                     default set (repeatable). Used by the surface gate to
                     extract from test/fixtures/tan-surface.
  --compact          one-line JSON instead of indented
`;

/**
 * Reduce an argv that is entirely string literals — a RUNTIME argv, produced by
 * a planner and handed here whole, rather than one read off a call site.
 *
 * Exported so `test/wizard.initArgv.test.js` can check the New Project
 * wizard's `tan init` argv against the same snapshot, with the same rules, as
 * every statically-read site. That argv is assembled conditionally
 * (`packages/alp-core/src/project/initArgv.ts`), so the AST walk above will
 * never see it as an array literal no matter how the call site is written —
 * enumerating the planner is the only way it gets checked at all.
 *
 * The metavar arity table is why this is shared rather than re-implemented:
 * without it `["init", "--som", "E1M-AEN801"]` counts the SKU as a stray
 * positional (#543), and a second copy of that rule is a second place for it
 * to drift from the snapshot.
 */
export function reduceLiteralArgv(argv, metavars) {
  return reduceTokens(
    argv.map((value) => ({ kind: TOKEN_LITERAL, value })),
    metavars,
  );
}

export { loadMetavars };

function main() {
  let options;
  try {
    options = parseArgv(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[surface:extract] ${error.message}\n`);
    process.exit(2);
  }
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  let result;
  try {
    result = extract(options);
  } catch (error) {
    process.stderr.write(`[surface:extract] ${error.message}\n`);
    process.exit(2);
  }

  if (result.records.length === 0) {
    // Zero sites is not a clean bill of health — this repo shells `tan` from
    // dozens of places. It means the walk found nothing, and a gate fed an
    // empty record passes everything.
    process.stderr.write(
      `[surface:extract] found 0 invocations across ${result.files.length} files — ` +
        `the AST walk is broken, not the codebase\n`,
    );
    process.exit(2);
  }

  process.stdout.write(
    (options.compact
      ? JSON.stringify(result.records)
      : JSON.stringify(result.records, null, 2)) + "\n",
  );

  const count = (state) =>
    result.records.filter((r) => r.resolution === state).length;
  process.stderr.write(
    `[surface:extract] ${result.records.length} invocations in ${result.files.length} files ` +
      `(${count(RESOLUTION_FULL)} full, ${count(RESOLUTION_PARTIAL)} partial, ` +
      `${count(RESOLUTION_NONE)} none)` +
      `${result.metavars.degraded ? " — DEGRADED, no snapshot" : ""}\n`,
  );
}

// Guarded because this file now has importers. Unguarded, `import`ing it to
// reach `reduceLiteralArgv` would run the whole AST walk and write the record
// set to the importer's stdout — which, in a `node --test` run, is the TAP
// stream. Invoked as a script (`node scripts/tan-surface/extract.mjs`, and the
// `spawnSync` in `test/tan.surfaceContract.test.js`) this is unchanged.
//
// REALPATHS, not a URL string compare: `process.argv[1]` is whatever the caller
// typed — relative here, absolute from the test's `spawnSync`, and a symlink
// under a pnpm bin shim — while `import.meta.url` is always the resolved file.
// A mismatch would leave `main()` unrun, and the extractor would then exit 0
// having printed nothing. That failure IS loud (the gate's JSON.parse throws
// with the first 400 bytes of an empty stdout), but "loud in the one gate that
// consumes it" is a thinner guarantee than getting the comparison right.
function invokedAsScript() {
  if (!process.argv[1]) return false;
  const real = (target) => {
    try {
      return fs.realpathSync(target);
    } catch {
      return path.resolve(target);
    }
  };
  return (
    real(path.resolve(process.argv[1])) === real(fileURLToPath(import.meta.url))
  );
}

if (invokedAsScript()) {
  main();
}
