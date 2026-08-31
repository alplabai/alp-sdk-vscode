// SPDX-License-Identifier: Apache-2.0
//
// Every `tan` spawn states a cwd (#605).
//
// ── The class this closes ───────────────────────────────────────────────────
//
// A spawn with no cwd inherits the extension host's own working directory —
// on Windows, the VS Code INSTALL DIRECTORY. `tan` resolves both the project
// and the SDK from cwd, so an omitted one does not merely pick a neutral
// place: it makes the command answer about somewhere that is nobody's project.
//
// The failure is quiet, which is why it kept coming back. `tan presets`
// reports an UNRESOLVED SDK as a SUCCESS with empty lists, so a cwd-caused
// empty catalogue is indistinguishable at the call site from a genuinely empty
// one — and `tan generate` WRITES, so a cwd-less one wrote into the extension
// host's directory with `ok` still true.
//
// ── Why the first version of this gate was not enough ───────────────────────
//
// It shipped in #605 policing the two direct spawners, and three commits later
// `validate` and BOTH `generate` sites were still spawning with no cwd. They
// went through `runAlpWithProgress`, a FORWARDER: it wraps `runAlpCommand` in
// a progress notification and passes the cwd along as an identifier, which
// satisfied every rule here on its own line, while its three callers omitted
// their own argument entirely.
//
// Adding it to a hand-written table was not the fix either. Registering the
// direct forwarders revealed five more, and registering those revealed three
// that forward into THEM. A list needs extending on every round, and the round
// nobody notices is the hole. Worse, SHRINKING a hand-written allowlist is
// invisible: deleting an entry leaves every other assertion green — verified
// by mutation, which is what motivated this rewrite.
//
// So the table is DERIVED. `SEED` names the two helpers that actually reach
// `child_process.spawn`; everything that forwards a cwd into them is computed
// to a fixpoint — the same "derive it, do not keep a second copy" discipline
// `scripts/tan-surface/extract.mjs` applies to argv indices.
//
// ── What it checks ──────────────────────────────────────────────────────────
//
// That the cwd argument is PRESENT and is not the `undefined` literal, at every
// call site of every helper in that closure. It deliberately does not check
// WHICH expression: `readOnlyProjectCwd()` for a read-only command, a
// `requireWorkspace`-style guard for one that writes, and a local `root`/`cwd`
// already resolved by the caller are all correct, and picking between them is a
// judgement this gate has no business making.
//
// ── What it does NOT cover ──────────────────────────────────────────────────
//
// The TERMINAL spawners — `runInTerminal`, `runAlpInTerminal`, `runAlpStreamed`
// — are out of scope and are NOT policed. They take their cwd as a named
// property of an options object rather than a positional argument, which is a
// second shape (including shorthand `{ cwd }`). Stated plainly because a gate
// whose name reads "spawn cwd" invites the assumption that it covers every
// spawn.
//
// ── The parser, and why it is not `ts.createSourceFile` ─────────────────────
//
// This repo pins `typescript@7.0.2`, the NATIVE compiler, which DELETED the
// old JS compiler API: `require("typescript")` resolves to `lib/version.cjs`
// and exposes nothing but a version string — verified, not assumed. The AST
// lives behind two unstable subpath exports, and
// `scripts/tan-surface/extract.mjs` already documents and uses exactly this
// pair. This file follows it rather than inventing a second way to read the
// same tree.

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

/**
 * The TRUE spawners: the two helpers that actually reach `child_process.spawn`,
 * and which argument of each carries the cwd.
 *
 * A SEED, not the rule. Everything else that must obey the rule is DERIVED
 * below, because a hand-maintained list is what let this gate ship with a hole.
 */
const SEED = new Map([
  ["runAlpCommand", 2],
  ["fetchEnvelopeResult", 2],
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

/** Parse every source file once; both passes below reuse the ASTs. */
let PARSED = null;
function parsed() {
  if (PARSED) return PARSED;
  const files = tsFiles(SRC);
  const out = [];
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
      out.push({
        rel: path.relative(ROOT, file),
        sourceFile,
        lineStarts: ast.computeLineStarts(sourceFile.text),
      });
    }
  } finally {
    api.close?.();
  }
  PARSED = out;
  return out;
}

/** Every named function that hands one of its OWN parameters to something in
 *  `known` as a cwd, with the index of that parameter in its own signature. */
function forwardersGiven(known) {
  const found = [];
  for (const { rel, sourceFile } of parsed()) {
    walk(sourceFile, (node) => {
      const isFn =
        node.kind === SK.FunctionDeclaration ||
        node.kind === SK.MethodDeclaration;
      if (!isFn || !node.body) return;
      const fnName = node.name?.kind === SK.Identifier ? node.name.text : null;
      if (!fnName) return;
      const params = (node.parameters ?? []).map((param) =>
        param.name?.kind === SK.Identifier ? param.name.text : null,
      );
      if (params.length === 0) return;
      walk(node.body, (inner) => {
        if (inner.kind !== SK.CallExpression) return;
        const callee = calleeName(inner.expression);
        if (!callee || !known.has(callee)) return;
        const cwdArg = inner.arguments?.[known.get(callee)];
        if (!cwdArg || cwdArg.kind !== SK.Identifier) return;
        const paramIndex = params.indexOf(cwdArg.text);
        if (paramIndex === -1) return;
        found.push({ file: rel, fn: fnName, paramIndex, via: callee });
      });
    });
  }
  return found;
}

/**
 * The seed plus every forwarder that reaches it, to a FIXPOINT.
 *
 * Transitive on purpose. Measured while writing this: the direct forwarders are
 * `runAlpWithProgress`, `runDoctor`, `runDebugConfig`,
 * `reconcileActiveSdkAfterBootstrap`, `confirmFlashReadiness` and
 * `fetchModuleTemplates`; registering those revealed `runBootstrapInTerminal`,
 * `runDebugDoctor` and `previewMaintainedConfigName` forwarding into THEM. A
 * hand-written list would need extending on every one of those rounds.
 */
let SPAWNERS = null;
function computeSpawners() {
  if (SPAWNERS) return SPAWNERS;
  const known = new Map(SEED);
  for (let round = 0; round < 16; round += 1) {
    let grew = false;
    for (const f of forwardersGiven(known)) {
      if (known.has(f.fn)) continue;
      known.set(f.fn, f.paramIndex);
      grew = true;
    }
    if (!grew) {
      SPAWNERS = known;
      return known;
    }
  }
  throw new Error(
    "the forwarder closure did not settle in 16 rounds — either the call " +
      "graph grew a cycle or this walker is re-adding the same name",
  );
}

/**
 * Every call to a spawner, with what sits in the cwd slot.
 *
 * A forwarder's OWN body is not a site: handing its parameter along is the
 * definition of forwarding, and the rule applies to whoever calls IT.
 */
function collectSpawnSites() {
  const known = computeSpawners();
  const bodies = new Set(
    forwardersGiven(known).map((f) => `${f.file}::${f.fn}::${f.via}`),
  );
  const sites = [];
  for (const { rel, sourceFile, lineStarts } of parsed()) {
    const stack = [];
    const visit = (node) => {
      const isFn =
        node.kind === SK.FunctionDeclaration ||
        node.kind === SK.MethodDeclaration;
      const named = isFn && node.name?.kind === SK.Identifier;
      if (named) stack.push(node.name.text);
      if (node.kind === SK.CallExpression) {
        const name = calleeName(node.expression);
        if (name && known.has(name)) {
          const enclosing = stack[stack.length - 1];
          if (!bodies.has(`${rel}::${enclosing}::${name}`)) {
            const cwdIndex = known.get(name);
            const cwd = node.arguments?.[cwdIndex];
            sites.push({
              file: rel,
              line: lineOf(lineStarts, ast.getTokenPosOfNode(node, sourceFile)),
              callee: name,
              cwdIndex,
              argCount: node.arguments?.length ?? 0,
              cwdText: cwd
                ? sourceFile.text.slice(cwd.pos, cwd.end).trim()
                : null,
            });
          }
        }
      }
      node.forEachChild(visit);
      if (named) stack.pop();
    };
    visit(sourceFile);
  }
  return sites;
}

const at = (s) => `${s.file}:${s.line} (${s.callee})`;

test("the derivation finds the forwarders, and the seed survives it", () => {
  const known = computeSpawners();
  for (const name of SEED.keys()) {
    assert.ok(
      known.has(name),
      `\`${name}\` fell out of the computed set — the seed is the one thing ` +
        "that cannot be derived",
    );
  }
  assert.ok(
    known.size > SEED.size,
    "the closure found NO forwarders at all, which cannot be right in this " +
      "repo — the derivation has stopped working, and every rule below now " +
      "polices only the two direct spawners, which is the hole this gate " +
      "shipped with",
  );
  assert.ok(
    known.has("runAlpWithProgress"),
    "`runAlpWithProgress` is the forwarder that let `validate` and both " +
      "`generate` sites spawn with no cwd for three commits. If the " +
      "derivation stops seeing it, that hole is open again.",
  );
});

test("the gate actually finds the spawn sites it is meant to police", () => {
  const sites = collectSpawnSites();
  assert.ok(
    sites.length >= 10,
    `only ${sites.length} spawn sites parsed — the walker stopped seeing ` +
      "them, so every assertion below would pass vacuously",
  );
});

test("no tan spawn omits its cwd argument", () => {
  const offenders = collectSpawnSites()
    .filter((s) => s.cwdText === null)
    .map(
      (s) =>
        `${at(s)} — called with ${s.argCount} argument(s); argument ` +
        `${s.cwdIndex + 1} is the cwd`,
    );
  assert.deepEqual(
    offenders,
    [],
    "an omitted cwd reaches `child_process.spawn` unset, so the child " +
      "inherits the extension host's own directory — on Windows, the VS Code " +
      "install directory. `tan` resolves the project AND the SDK from cwd, so " +
      "the command then answers about somewhere that is nobody's project — " +
      "and `tan generate` WRITES there.\n" +
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
