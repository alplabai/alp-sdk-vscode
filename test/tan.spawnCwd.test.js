// SPDX-License-Identifier: Apache-2.0
//
// Every `tan` envelope spawn states a cwd (#605).
//
// ── The class this closes ───────────────────────────────────────────────────
//
// A spawn with no cwd inherits the extension host's own working directory —
// on Windows, the VS Code INSTALL DIRECTORY. `tan` resolves both the project
// and the SDK from cwd, so an omitted one does not merely pick a neutral
// place: it makes the command answer about somewhere that is nobody's project.
//
// The failure is quiet, which is why it kept coming back. `tan presets`
// reports an UNRESOLVED SDK as a SUCCESS with empty lists
// (`src/alpCli/envelope.ts`), so a cwd-caused empty catalogue is
// indistinguishable at the call site from a genuinely empty one — and
// `ensureNativeSimOverlay` wrote its overlay into the extension host's
// directory with `outcome.ok` still true, regenerating on every run while the
// app never picked it up.
//
// #605 opened naming THREE sites. Its own comments then found a fourth, then
// six more. Ten, found by hand, one re-read at a time — and an eleventh was
// introduced by #613 an hour before this gate was written. Nine edits do not
// close a class; this file does.
//
// ── What it checks ──────────────────────────────────────────────────────────
//
// Parsed with the TypeScript compiler API, not grepped: the argument list is
// the thing under test, and a regex cannot tell `undefined` in the cwd slot
// from the word appearing anywhere else in a multi-line call.
//
// The rule is that the cwd argument is PRESENT and is not the `undefined`
// literal. It deliberately does not check WHICH expression: `readOnlyProjectCwd()`
// for a read-only command, a `requireWorkspace`-style guard for one that
// writes, and a local `root`/`cwd` already resolved by the caller are all
// correct, and picking between them is a judgement this gate has no business
// making.
//
// ── What it does NOT cover ──────────────────────────────────────────────────
//
// The TERMINAL spawners — `runInTerminal`, `runAlpInTerminal`, `runAlpStreamed`
// — are out of scope here and are NOT policed. They take their cwd as a named
// property of an options object rather than a positional argument, which is a
// second shape (including shorthand `{ cwd }`), and several of their sites
// have their own resolution already. Stating that plainly because a gate whose
// name reads "spawn cwd" invites the assumption that it covers every spawn:
// it covers the two ENVELOPE spawners and nothing else. Extending it is
// tracked separately rather than half-done here.

// ── The parser, and why it is not `ts.createSourceFile` ─────────────────────
//
// This repo pins `typescript@7.0.2`, the NATIVE compiler, which DELETED the
// old JS compiler API: `require("typescript")` resolves to `lib/version.cjs`
// and exposes nothing but a version string — verified here, not assumed
// (`ts.ScriptTarget` is `undefined`). The AST lives behind two unstable
// subpath exports, and `scripts/tan-surface/extract.mjs` already documents
// and uses exactly this pair. This file follows it rather than inventing a
// second way to read the same tree; when that one has to move for a TS bump,
// so does this one, and they will be found together.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

// The AST modules are ESM-only, so they arrive through a dynamic import
// resolved once, before any test body runs.
let ast;
let SK;
let API;
test.before(async () => {
  ast = await import("typescript/unstable/ast");
  SK = ast.SyntaxKind;
  ({ API } = await import("typescript/unstable/sync"));
});

/** The spawn helpers whose third parameter is `cwd`. */
const SPAWNERS = new Set(["runAlpCommand", "fetchEnvelopeResult"]);

/**
 * Sites the rule cannot apply to, each with the reason.
 *
 * Both are the DEFINITIONS of the helpers themselves — they forward a `cwd`
 * their own caller supplied, so there is nothing here for them to state.
 */
const EXEMPT_FILES = new Set([
  path.join("src", "alpCli", "envelope.ts"),
  path.join("src", "alpCli", "vscodeAdapter.ts"),
]);

/** `node.forEachChild(visit)` is a METHOD on the node in this API, not a free
 *  function — the same shape `extract.mjs` walks with. */
function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

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

function tsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function lineOf(lineStarts, pos) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= pos) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** Every call to a spawner, with what sits in the cwd slot. */
function collectSpawnSites() {
  const files = tsFiles(SRC).filter(
    (file) => !EXEMPT_FILES.has(path.relative(ROOT, file)),
  );
  const sites = [];
  const api = new API({ cwd: ROOT });
  try {
    const snapshot = api.updateSnapshot({ openFiles: files });
    for (const file of files) {
      const project = snapshot.getDefaultProjectForFile(file);
      const sourceFile = project?.program.getSourceFile(file);
      // Not a soft failure: a file the compiler will not hand back is a file
      // whose spawns nobody looked at, and silence there is exactly the blind
      // spot this gate exists to close.
      if (!sourceFile) {
        throw new Error(
          `no SourceFile for ${path.relative(ROOT, file)} — refusing to ` +
            "report a clean sweep that skipped a file",
        );
      }
      const lineStarts = ast.computeLineStarts(sourceFile.text);
      const rel = path.relative(ROOT, file);
      walk(sourceFile, (node) => {
        if (node.kind !== SK.CallExpression) return;
        const name = calleeName(node.expression);
        if (!name || !SPAWNERS.has(name)) return;
        const cwd = node.arguments?.[2];
        sites.push({
          file: rel,
          line: lineOf(lineStarts, ast.getTokenPosOfNode(node, sourceFile)),
          callee: name,
          argCount: node.arguments?.length ?? 0,
          cwdText: cwd ? sourceFile.text.slice(cwd.pos, cwd.end).trim() : null,
        });
      });
    }
  } finally {
    api.close?.();
  }
  return sites;
}

const at = (s) => `${s.file}:${s.line} (${s.callee})`;

test("the gate actually finds the spawn sites it is meant to police", () => {
  const sites = collectSpawnSites();
  assert.ok(
    sites.length >= 10,
    `only ${sites.length} spawn sites parsed — the walker stopped seeing ` +
      "them, so every assertion below would pass vacuously",
  );
  assert.ok(
    sites.some((s) => s.callee === "runAlpCommand"),
    "no `runAlpCommand` site found at all",
  );
  assert.ok(
    sites.some((s) => s.callee === "fetchEnvelopeResult"),
    "no `fetchEnvelopeResult` site found at all",
  );
});

test("no tan spawn omits its cwd argument", () => {
  const offenders = collectSpawnSites()
    .filter((s) => s.cwdText === null)
    .map(
      (s) =>
        `${at(s)} — called with ${s.argCount} argument(s); the third is the cwd`,
    );
  assert.deepEqual(
    offenders,
    [],
    "an omitted cwd reaches `child_process.spawn` unset, so the child " +
      "inherits the extension host's own directory — on Windows, the VS Code " +
      "install directory. `tan` resolves the project AND the SDK from cwd, so " +
      "the command then answers about somewhere that is nobody's project.\n" +
      offenders.join("\n"),
  );
});

test("no tan spawn passes the `undefined` literal as its cwd", () => {
  const offenders = collectSpawnSites()
    .filter((s) => s.cwdText === "undefined")
    .map(at);
  assert.deepEqual(
    offenders,
    [],
    "passing `undefined` explicitly is the same spawn as omitting it, and " +
      "reads as a decision rather than an oversight — which is how ten of " +
      "these survived a full CLI-surface re-read. Use `readOnlyProjectCwd()` " +
      "for a read-only command, or refuse with a `noWorkspace` precondition " +
      "for one that writes.\n" +
      offenders.join("\n"),
  );
});

test("no tan spawn re-derives the root from `workspaceFolders[0]`", () => {
  const offenders = collectSpawnSites()
    .filter((s) => (s.cwdText ?? "").includes("workspaceFolders"))
    .map((s) => `${at(s)} — ${s.cwdText}`);
  assert.deepEqual(
    offenders,
    [],
    "`docs/ARCHITECTURE_RULES.md` §3 forbids re-deriving the root per call " +
      "site: `workspaceFolders[0]` and `collectProjectContext()` disagree on " +
      "a multi-root workspace, and `workspaceFolders?.[0]?.uri.fsPath` " +
      "evaluates to exactly the `undefined` the rule above forbids when no " +
      `folder is open.\n${offenders.join("\n")}`,
  );
});
