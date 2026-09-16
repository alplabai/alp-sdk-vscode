// SPDX-License-Identifier: Apache-2.0
//
// The memory view stays READ-ONLY until the contract can tell a
// customer-sizeable band from a Secure-Enclave one (#484, D5).
//
// WHY THIS IS A GATE AND NOT A CONVENTION. Nothing in the emitted data
// distinguishes `storage` at 0x80560000 (96 KiB, customer-sized) from `atoc` at
// 0x80578000 (32 KiB, Secure-Enclave-owned). Writing the ATOC can leave the
// part unbootable — measured on E1M-AEN801, 2026-08-08: a Zephyr app erased
// 0x80560000 inside what was then the same `storage` partition while the live
// ATOC sat intact at 0x8057EA50, magic `ckBS` (0x53426B63); nothing failed at
// build time and nothing failed at run time.
//
// alp-sdk#1289 split that band out. alp-sdk#1365 is what would let a UI tell
// the two apart: a derived `kind` and a schema-required `owner`, emitted into
// `system-manifest-v1`. Until then an edit affordance over this map is a live
// hazard, and "we remembered not to add one" is exactly the class of guarantee
// #484 exists to replace with something you cannot express.
//
// The last test is the tripwire: it fails the day the contract grows the
// missing half, so the read-only decision is re-taken deliberately by whoever
// lands it, rather than quietly outliving its reason.
//
// #484 PHASE 2 landed read-only backdrop+table rendering FROM `memory[]`
// (alp-sdk#1365 / alp-sdk#2030) WITHOUT re-vendoring this schema — that
// stays #662, tag-only. So the tripwire below has NOT fired: the vendored
// copy still declares the same eight root keys, even though a real
// manifest from a new-enough SDK now carries a ninth (`memory`). D5 was
// re-taken against that landed contract anyway, because `write_authority`
// ships optional on both sides (no schema-required, no default) — the
// precondition below was never about the KEY existing, only about
// authority being unambiguous once it does. It still is not, so the map
// stays read-only.
//
// ---------------------------------------------------------------------------
// WHY THE SCANNED SCOPE IS THE REAL MODULE GRAPH, AND NOTHING ELSE
// ---------------------------------------------------------------------------
//
// The property this file defends is REACHABILITY: can anything the Memory
// view actually pulls in reach the extension host? That is a statement about
// the import graph, and no amount of text matching can express it. Earlier
// designs tried, and each was defeated by a different indirection — a file
// named by hand missed a new sibling; a regex import closure dropped an
// unresolved specifier on the floor and shipped a `postMessage` inside a
// scanned file with the gate green; a directory listing was escaped by simply
// putting the transport in a file one directory up and importing it back in.
// That last one is the tell: a listing describes WHERE a file sits, and the
// hazard has nothing to do with where a file sits.
//
// So the scope is DERIVED, by the TypeScript compiler itself, from the
// modules the Memory view's entry components import — transitively, through
// re-export hops, with real module resolution. `.ts` / `.tsx` / `.mts` /
// `.cts` / `.js` specifiers, extensionless paths, `index.ts` directory
// resolution, `./evil.mjs` naming an `evil.mts`, a symlinked subdirectory and
// a path alias all resolve the way the shipping build resolves them, because
// it is the same resolver reading the same `tsconfig.json`. A specifier that
// does NOT resolve is a hard failure naming the specifier and the file that
// wrote it — never a silent narrowing, which is the single way a derived
// scope can be worse than a hand-written one.
//
// THE SCOPE FOLLOWS BINDINGS, NOT WHOLE BARRELS. `MemoryRegions.tsx` imports
// `{ Button }` from `../../shared/ui`, a barrel that also re-exports
// components which legitimately DO talk to the host (the Markdown and
// ResourceLink components both post messages, correctly, for their own
// features). Co-location in a barrel is not a path the memory view can take:
// it cannot call into a component it never imported. So a re-export hop is
// followed only for the names actually asked for, down to the module that
// declares them — `../../shared/ui` → `./Button` → `Button.tsx`, and nothing
// else. Those two host-talking components are excluded by the derivation
// itself, not by being named in a list; put the transport behind a binding
// the view DOES import, anywhere in the tree, and the walk arrives at it.
//
// TYPE-ONLY EDGES ARE NOT FOLLOWED. `import type { … }` is erased by the
// compiler and evaluates nothing at run time, so it cannot be a path back to
// the host. This is also why the protocol mirror (`types.ts`) is out of
// scope: it must name every wire field, including the ones an editor would
// target, and it is reached only through erased edges.
//
// The transport ban is therefore a graph property — "no module in the derived
// set imports the host transport module, except the one sanctioned file" —
// compared by RESOLVED PATH, so `../../vscode`, `../vscode`, a re-export of
// it, or a helper in another directory that wraps it are all the same edge.
//
// One shape a reachability gate cannot see, stated plainly rather than
// papered over: a file NOTHING imports. It is not in the graph because it is
// not in the program — never evaluated, never bundled, absent from
// `dist/main.js`. It becomes visible to this gate the moment it is wired to
// anything the view imports, which is also the moment it becomes able to do
// harm.
//
// One level down, inside the one file allowed to reach the host at all, the
// message check reads the ARGUMENT AST of each real `postMessage(...)` call:
// one argument, one inline object literal, one plain-string `type` in the
// sanctioned set. A spread, a computed key, a variable, a call or a template
// are refused as the AST shapes they are — so a finding whose text happens to
// contain `...`, `type:` or `arr[0]` is just a string, and passes, while a
// real spread does not.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const WEBVIEW = path.join(REPO, "packages", "alp-webview");
const SRC = path.join(WEBVIEW, "src");
const BUILD_PLAN_DIR = path.join(SRC, "features", "build-plan");
const WEBVIEW_TSCONFIG = path.join(WEBVIEW, "tsconfig.json");

/** The package's ambient declarations (`*.module.css` and friends). Handed to
 *  the root-limited program so a stylesheet import RESOLVES instead of being
 *  reported as a broken specifier — the gate must fail on real breakage, not
 *  on a CSS import every component in the tree writes. */
const AMBIENT_DECLARATIONS = path.join(SRC, "vite-env.d.ts");

/**
 * The Memory view's entry components — the roots of the walk.
 *
 * Established from `BuildPlanView.tsx`, which owns the tab strip: it renders
 * `<MemoryRegions …/>` for `tab === "memory"` and `<MemoryNotes />` for
 * `tab === "notes"`, the map's own context. `MemoryChart.tsx` and
 * `MemoryTable.tsx` are deliberately NOT roots — `MemoryRegions.tsx` imports
 * both, so the walk reaches them on its own; listing them here would be the
 * hand-maintenance this derivation exists to remove.
 */
const ROOTS = [
  path.join(BUILD_PLAN_DIR, "MemoryRegions.tsx"),
  path.join(BUILD_PLAN_DIR, "MemoryNotes.tsx"),
];

/** The host transport. Every ban below is stated against THIS resolved file,
 *  never against the text of a specifier. */
const TRANSPORT_MODULE = path.join(SRC, "vscode.ts");

/** The one file this gate lets use the host transport at all. The approved
 *  design is "open the declaring file, copy its text, both through host
 *  messages", which needs SOME transport; recording the exception here,
 *  scoped to this one file and the two message kinds below, is how that need
 *  is met without reopening "the memory view has no path back to the host"
 *  for the picture/table/Notes modules this gate exists to keep passive. */
const SANCTIONED_HOST_FILE = path.join(
  BUILD_PLAN_DIR,
  "blockedFindingActions.ts",
);

/** The ONLY message `type` literals `SANCTIONED_HOST_FILE` may ever send.
 *  Neither writes memory-map data: `openBoardYaml` opens a file for editing
 *  elsewhere (never this view), `copyText` puts text on the clipboard.
 *
 *  Appending a THIRD entry here is accepted — an allowlist someone
 *  deliberately widens, in a reviewed change, is what an allowlist is for.
 *  It is not accepted silently: widen this array only with the same review
 *  that approved the two entries already here, and say in that review why
 *  the new message does not write memory-map data, the same case made for
 *  these two. */
const SANCTIONED_MESSAGE_TYPES = ["openBoardYaml", "copyText"];

/** Names that may never be referenced by a module in the derived set. The
 *  global `acquireVsCodeApi` is the transport's own source, so reaching for
 *  it directly bypasses the module edge the ban above is stated over. */
const FORBIDDEN_GLOBALS = ["acquireVsCodeApi"];

/** A file this gate cannot walk to the end of is a file it must not report
 *  on; no source file here is remotely near this many tokens. */
const MAX_TOKENS_PER_FILE = 400000;

const read = (p) => fs.readFileSync(p, "utf8");
const rel = (p) => path.relative(REPO, p);

// ---------------------------------------------------------------------------
// The module graph, built by the TypeScript compiler.
// ---------------------------------------------------------------------------

/** A resolved file that is not part of this webview's own sources: a package
 *  under `node_modules`, or any declaration file (the ambient `*.module.css`
 *  wildcard resolves into `vite/client.d.ts`). Anything else — including a
 *  file reached through a symlink, or one sitting outside `src` — is walked
 *  and checked, so moving a module elsewhere in the tree hides nothing. */
function isExternalModule(file) {
  return (
    file.split(path.sep).includes("node_modules") || /\.d\.[cm]?ts$/.test(file)
  );
}

let graphPromise = null;

/** Built once and shared by every test below; the compiler process is closed
 *  as soon as the walk is finished. */
function moduleGraph() {
  if (!graphPromise) graphPromise = buildModuleGraph();
  return graphPromise;
}

async function buildModuleGraph() {
  // `typescript@7` publishes the compiler API under `unstable/*`; the package
  // root exports only its version string. This is the same compiler, and the
  // same platform binary, that `pnpm run compile` and `pnpm run typecheck`
  // already run in CI, so the gate adds no dependency and no new tool.
  const { API } = await import("typescript/unstable/sync");
  const ast = await import("typescript/unstable/ast");
  const is = await import("typescript/unstable/ast/is");

  // A project rooted at the Memory view's entry components ONLY, so the
  // program's own file set is the view's closure rather than the whole
  // package. It extends the real `tsconfig.json`, so resolution runs under
  // the shipping `moduleResolution`, `jsx` and `paths` settings.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-memory-gate-"));
  const configPath = path.join(tmpDir, "tsconfig.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      extends: WEBVIEW_TSCONFIG,
      compilerOptions: { noEmit: true },
      include: [],
      files: [...ROOTS, AMBIENT_DECLARATIONS],
    }),
  );

  const api = new API({ cwd: REPO });
  // The compiler client stays open for the whole file: the walk hands back
  // real AST nodes, and reading one after the channel closes throws. It is
  // shut down once, after the last test, by the hook below.
  const dispose = () => {
    try {
      api.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };
  try {
    const snapshot = api.updateSnapshot({ openProjects: [configPath] });
    const project =
      snapshot.getProject(configPath) ?? snapshot.getProjects()[0];
    assert.ok(
      project,
      "the TypeScript compiler opened no project for the memory view's " +
        "entry components — the walk below would derive nothing",
    );
    return { ...walk(project, ast, is), dispose };
  } catch (err) {
    dispose();
    throw err;
  }
}

test.after(async () => {
  if (!graphPromise) return;
  const graph = await graphPromise.catch(() => null);
  graph?.dispose();
});

function walk(project, ast, is) {
  const { program, checker } = project;

  // The compiler reports a node's file as an internal `Path`, which is
  // lower-cased on a case-insensitive file system. Map it back to the real
  // name the program knows, so every comparison below is against one spelling.
  const realByLower = new Map(
    program.getSourceFileNames().map((name) => [name.toLowerCase(), name]),
  );
  const toRealPath = (p) => realByLower.get(String(p).toLowerCase());

  /** Specifiers the compiler could not resolve, and specifiers that are not a
   *  plain string. Either one means the walk below is INCOMPLETE, so every
   *  test refuses to draw a conclusion until this is empty. */
  const unresolved = [];
  /** Every followed edge: `{ from, to, specifier }`, resolved files only. */
  const edges = [];
  /** file -> { wanted: Set<string> | null, processed: boolean } */
  const state = new Map();
  const queue = [];

  function want(file, names) {
    const prev = state.get(file);
    if (!prev) {
      state.set(file, {
        wanted: names === null ? null : new Set(names),
        processed: false,
      });
      queue.push(file);
      return;
    }
    if (prev.wanted === null) return;
    if (names === null) {
      prev.wanted = null;
      if (prev.processed) {
        prev.processed = false;
        queue.push(file);
      }
      return;
    }
    let grew = false;
    for (const n of names) {
      if (!prev.wanted.has(n)) {
        prev.wanted.add(n);
        grew = true;
      }
    }
    if (grew && prev.processed) {
      prev.processed = false;
      queue.push(file);
    }
  }

  /** Resolve a module specifier NODE the way the compiler does. Returns the
   *  real path, or null having recorded why — never a guess. */
  function resolveSpecifier(specifier, fromFile, what) {
    if (!specifier || !is.isStringLiteral(specifier)) {
      unresolved.push({
        from: fromFile,
        specifier: specifier ? `<${what}, not a string literal>` : `<${what}>`,
        reason:
          "the specifier is not a plain string literal, so nothing can " +
          "resolve it and this gate cannot see where it leads",
      });
      return null;
    }
    const symbol = checker.getSymbolAtLocation(specifier);
    const declaration = symbol?.declarations?.[0];
    if (!declaration) {
      unresolved.push({
        from: fromFile,
        specifier: specifier.text,
        reason: "the TypeScript compiler could not resolve it to any module",
      });
      return null;
    }
    const real = toRealPath(declaration.path);
    if (!real) {
      unresolved.push({
        from: fromFile,
        specifier: specifier.text,
        reason:
          `it resolved to ${declaration.path}, which is not a file of the ` +
          "program the walk was built from",
      });
      return null;
    }
    return real;
  }

  function follow(fromFile, specifier, names, what) {
    const target = resolveSpecifier(specifier, fromFile, what);
    if (!target) return;
    edges.push({ from: fromFile, to: target, specifier: specifier.text });
    if (isExternalModule(target)) return;
    want(target, names);
  }

  const tokensCache = new Map();

  /**
   * Every identifier and string-literal token of a file, plus every
   * `import(...)` / `require(...)` call — walked over the PARSED file, token
   * by token, so a word inside a comment or a string is never mistaken for
   * code and JSX text is never mistaken for either.
   *
   * A raw lexer cannot do this job on a `.tsx` file: run one over JSX text
   * and an ordinary apostrophe ("don't") opens a string literal that never
   * closes, swallowing the rest of the file. The parser has already resolved
   * all of that, so its token stream is the only trustworthy one.
   */
  function tokensOf(file) {
    const cached = tokensCache.get(file);
    if (cached) return cached;
    const sourceFile = program.getSourceFile(file);
    assert.ok(
      sourceFile,
      `${rel(file)} is in the derived set but the compiler has no source ` +
        "file for it — the walk cannot vouch for a module it never parsed",
    );
    const identifiers = [];
    const strings = [];
    const dynamicCalls = [];
    let token = ast.getTokenAtPosition(sourceFile, 0);
    let walked = 0;
    while (token && walked < MAX_TOKENS_PER_FILE) {
      walked += 1;
      if (token.kind === ast.SyntaxKind.Identifier) {
        identifiers.push({ name: token.text, node: token });
        const parent = token.parent;
        if (
          token.text === "require" &&
          parent &&
          is.isCallExpression(parent) &&
          parent.expression === token
        ) {
          dynamicCalls.push(parent);
        }
      } else if (token.kind === ast.SyntaxKind.StringLiteral) {
        strings.push(token.text);
      } else if (token.kind === ast.SyntaxKind.ImportKeyword) {
        // A static `import … from` produces this token too, but its parent is
        // the import STATEMENT; only `import("…")` has a call for a parent.
        const parent = token.parent;
        if (parent && is.isCallExpression(parent)) dynamicCalls.push(parent);
      }
      token = ast.findNextToken(token, sourceFile, sourceFile);
    }
    assert.ok(
      walked < MAX_TOKENS_PER_FILE,
      `${rel(file)}: the token walk did not reach the end of the file — ` +
        "this gate refuses to report on a file it could not read to the end",
    );
    const result = { identifiers, strings, dynamicCalls };
    tokensCache.set(file, result);
    return result;
  }

  function processFile(file, entry) {
    const sourceFile = program.getSourceFile(file);
    assert.ok(
      sourceFile,
      `${rel(file)} is in the derived set but the compiler has no source ` +
        "file for it — the walk cannot vouch for a module it never parsed",
    );
    const wholeModule = entry.wanted === null;

    for (const statement of sourceFile.statements) {
      if (is.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        // `import "./x"` — evaluated for its side effects alone.
        if (!clause) {
          follow(file, statement.moduleSpecifier, null, "side-effect import");
          continue;
        }
        if (clause.isTypeOnly) continue; // erased; no run-time edge
        const bindings = clause.namedBindings;
        if (bindings && is.isNamespaceImport(bindings)) {
          follow(file, statement.moduleSpecifier, null, "namespace import");
          continue;
        }
        const names = [];
        if (clause.name) names.push("default");
        if (bindings && is.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            names.push((element.propertyName ?? element.name).text);
          }
        }
        if (names.length === 0) continue;
        follow(file, statement.moduleSpecifier, names, "import");
        continue;
      }

      if (is.isExportDeclaration(statement) && statement.moduleSpecifier) {
        if (statement.isTypeOnly) continue;
        const clause = statement.exportClause;
        // `export * from "./x"` re-exports names this walk cannot enumerate,
        // so it is followed whole rather than guessed at.
        if (!clause || !is.isNamedExports(clause)) {
          follow(file, statement.moduleSpecifier, null, "export *");
          continue;
        }
        const carried = [];
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue;
          // A re-export hop is followed only for the names the view asked
          // for; `wanted` is keyed on the name as EXPORTED, and the name as
          // declared upstream is what travels on.
          if (!wholeModule && !entry.wanted.has(element.name.text)) continue;
          carried.push((element.propertyName ?? element.name).text);
        }
        if (carried.length === 0) continue;
        follow(file, statement.moduleSpecifier, carried, "re-export");
        continue;
      }

      if (
        is.isImportEqualsDeclaration(statement) &&
        statement.moduleReference &&
        is.isExternalModuleReference(statement.moduleReference)
      ) {
        follow(
          file,
          statement.moduleReference.expression,
          null,
          "import = require",
        );
      }
    }

    // `import("./x")` and `require("./x")` can sit anywhere in a file, not
    // only at the top, so they are collected from the whole token walk.
    for (const call of tokensOf(file).dynamicCalls) {
      if (call.arguments.length === 0) continue;
      follow(file, call.arguments[0], null, "dynamic import");
    }
  }

  for (const root of ROOTS) want(root, null);
  while (queue.length > 0) {
    const file = queue.shift();
    const entry = state.get(file);
    if (entry.processed) continue;
    entry.processed = true;
    processFile(file, entry);
  }

  const reachable = [...state.keys()].sort();
  return { reachable, edges, unresolved, tokensOf, program, ast, is };
}

/** Every test starts here. A walk that dropped a specifier has narrowed the
 *  scope, and a narrowed scope makes every assertion below pass for the wrong
 *  reason — the exact failure mode this derivation replaces. */
function assertNothingWasDropped(graph) {
  if (graph.unresolved.length === 0) return;
  const detail = graph.unresolved
    .map((u) => `  ${rel(u.from)} imports "${u.specifier}" — ${u.reason}`)
    .join("\n");
  assert.fail(
    "the memory view's module graph could not be resolved completely, so " +
      "the scope below would be narrower than the code really is:\n" +
      detail +
      "\nFix the specifier, or teach this gate the resolution it needs — " +
      "never let it narrow silently.",
  );
}

test("the memory view's module graph resolves completely", async () => {
  const graph = await moduleGraph();
  assertNothingWasDropped(graph);

  for (const root of ROOTS) {
    assert.ok(
      graph.reachable.includes(root),
      `${rel(root)} is a declared entry component but is not in the derived ` +
        "set — the walk is broken, not the code",
    );
  }
  // The picture and the table are reached THROUGH the entry components; if
  // the walk stops short of them it has silently stopped covering the view.
  for (const name of ["MemoryChart.tsx", "MemoryTable.tsx"]) {
    assert.ok(
      graph.reachable.includes(path.join(BUILD_PLAN_DIR, name)),
      `the walk did not reach ${name}, which the memory view renders — a ` +
        "derivation that stops short of the view covers nothing below",
    );
  }
  assert.ok(
    graph.reachable.length >= 10,
    `the walk derived only ${graph.reachable.length} module(s); the memory ` +
      "view is larger than that, so the walk is broken",
  );
});

test("the sanctioned file is actually reachable from the memory view", async () => {
  const graph = await moduleGraph();
  assertNothingWasDropped(graph);
  assert.ok(
    graph.reachable.includes(SANCTIONED_HOST_FILE),
    `${rel(SANCTIONED_HOST_FILE)} is named as the sanctioned host-transport ` +
      "file but nothing the memory view imports reaches it — the exception " +
      "would silently apply to nothing",
  );
});

/**
 * Read one `postMessage(...)` call site as AST and require:
 *
 *  - exactly one argument, and that argument an inline object literal (never
 *    a variable, a call, or a second argument this gate cannot audit);
 *  - no spread and no computed key, each refused as the AST node it is;
 *  - exactly one `type` property, its value a plain string literal in the
 *    sanctioned set — a const, a template or a concatenation is refused
 *    whatever it might evaluate to.
 *
 * Because this reads the argument's SHAPE, the CONTENTS of a string are just
 * a string: `text: "a...b"`, `text: "arr[0]: x"` and `text: "type: foo"` are
 * ordinary values and pass, which matters because `copyText` carries
 * allocator finding text.
 */
function checkPostMessageCall(call, file, ast, is) {
  const where = path.basename(file);
  assert.equal(
    call.arguments.length,
    1,
    `${where}: a postMessage(...) call takes ${call.arguments.length} ` +
      "arguments — it must take exactly one inline object literal, because a " +
      "second argument is another payload this gate cannot audit",
  );
  const argument = call.arguments[0];
  assert.ok(
    is.isObjectLiteralExpression(argument),
    `${where}: postMessage(...) is called with ` +
      `${ast.formatSyntaxKind(argument.kind)}, not a single inline object ` +
      "literal — a variable, a function call or a spread of one cannot be " +
      "audited by this gate and is refused outright",
  );

  const typeValues = [];
  for (const property of argument.properties) {
    assert.ok(
      !is.isSpreadAssignment(property),
      `${where}: postMessage(...) spreads another object into its message — ` +
        "a spread can inject or override a field this gate cannot see and " +
        "is refused outright",
    );
    assert.ok(
      !property.name || !is.isComputedPropertyName(property.name),
      `${where}: postMessage(...) uses a computed property key — a message ` +
        "must be written with plain, literal keys so it can be audited",
    );
    const name = property.name?.text;
    if (name !== "type") continue;
    assert.ok(
      !is.isShorthandPropertyAssignment(property),
      `${where}: postMessage(...) writes its type as a shorthand property — ` +
        "the message type must be written inline as a literal, not taken " +
        "from a variable this gate cannot follow",
    );
    typeValues.push(property.initializer);
  }

  assert.equal(
    typeValues.length,
    1,
    `${where}: postMessage(...) does not carry exactly one \`type\` field ` +
      `(found ${typeValues.length}) — the message type must be written ` +
      "inline as a single, unambiguous field",
  );
  const initializer = typeValues[0];
  assert.ok(
    is.isStringLiteral(initializer),
    `${where}: postMessage(...) writes its type as ` +
      `${ast.formatSyntaxKind(initializer.kind)}, which is not a plain ` +
      "string literal — a const reference, a template literal or a " +
      "concatenation cannot be audited by this gate and is refused " +
      "outright, whatever it might evaluate to",
  );
  assert.ok(
    SANCTIONED_MESSAGE_TYPES.includes(initializer.text),
    `${where}: postMessage(...) posts message type "${initializer.text}", ` +
      `which is not one of the sanctioned (${SANCTIONED_MESSAGE_TYPES.join(", ")}) ` +
      "— an unaudited additional message type from this file is exactly the " +
      "hole this exception must not open",
  );
}

test("the memory view has no path back to the host, except the one sanctioned exception", async () => {
  const graph = await moduleGraph();
  assertNothingWasDropped(graph);
  const { ast, is, program } = graph;

  for (const file of graph.reachable) {
    // The transport module is the SUBJECT of the ban, not a violator of it:
    // it is in the derived set only because the sanctioned file imports it.
    if (file === TRANSPORT_MODULE) continue;
    const isSanctioned = file === SANCTIONED_HOST_FILE;
    const tokens = graph.tokensOf(file);

    // 1. The graph property. An edge to the transport is the whole hazard,
    //    however the specifier is spelled and wherever the file sits.
    for (const edge of graph.edges) {
      if (edge.from !== file || edge.to !== TRANSPORT_MODULE) continue;
      assert.ok(
        isSanctioned,
        `${rel(file)} imports the host transport (${rel(TRANSPORT_MODULE)}) ` +
          `as "${edge.specifier}", and the memory view reaches it — the view ` +
          "is read-only until alp-sdk#1365 lands `kind` + `owner`. Only " +
          `${rel(SANCTIONED_HOST_FILE)} may hold that edge.`,
      );
    }

    // 2. A dispatched command is never sanctioned anywhere, in any file.
    //    Read as a real identifier and a real string value, so this file's
    //    own prose can say the word without tripping it.
    assert.ok(
      !tokens.identifiers.some((t) => t.name === "runCommand") &&
        !tokens.strings.includes("runCommand"),
      `${rel(file)} must not dispatch a runCommand — no module the memory ` +
        "view reaches gets a command channel, sanctioned or not",
    );

    // 3. The transport's own source, reached around the module edge.
    for (const forbidden of FORBIDDEN_GLOBALS) {
      assert.ok(
        !tokens.identifiers.some((t) => t.name === forbidden),
        `${rel(file)} references ${forbidden} — that is the host transport's ` +
          "own source, and reaching for it directly bypasses the module edge " +
          "this gate is stated over",
      );
    }

    if (!isSanctioned) {
      assert.ok(
        !tokens.identifiers.some((t) => t.name === "postMessage"),
        `${rel(file)} references postMessage — the view is read-only until ` +
          "alp-sdk#1365 lands `kind` + `owner`, and only " +
          `${rel(SANCTIONED_HOST_FILE)} may post at all`,
      );
      continue;
    }

    // The sanctioned file. Its transport binding may not be renamed, or a
    // call spelled under the new name would be invisible to the scan below.
    const sourceFile = program.getSourceFile(file);
    for (const statement of sourceFile.statements) {
      if (!is.isImportDeclaration(statement)) continue;
      const edge = graph.edges.find(
        (e) =>
          e.from === file && e.specifier === statement.moduleSpecifier.text,
      );
      if (!edge || edge.to !== TRANSPORT_MODULE) continue;
      const bindings = statement.importClause?.namedBindings;
      assert.ok(
        !bindings || !is.isNamespaceImport(bindings),
        `${rel(file)} imports the host transport as a namespace — every ` +
          "call would then be spelled through it and invisible to the " +
          "message check below",
      );
      if (!bindings || !is.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (imported !== "postMessage") continue;
        assert.equal(
          element.name.text,
          "postMessage",
          `${rel(file)} imports postMessage under the local name ` +
            `"${element.name.text}" — an aliased transport hides its call ` +
            "sites from the message check below",
        );
      }
    }

    // Every mention of `postMessage` is either that import or a direct call;
    // anything else (assigned to a const, passed as a callback) would let a
    // dispatch happen under a name this scan never looks at.
    let callSites = 0;
    for (const token of tokens.identifiers) {
      if (token.name !== "postMessage") continue;
      const node = token.node;
      const parent = node.parent;
      if (parent && is.isImportSpecifier(parent)) continue;
      assert.ok(
        parent && is.isCallExpression(parent) && parent.expression === node,
        `${rel(file)} references postMessage without calling it directly — ` +
          "it must never be assigned, aliased or passed anywhere except a " +
          "direct postMessage(...) call, or a dispatch under the alias " +
          "would be invisible to this scan",
      );
      checkPostMessageCall(parent, file, ast, is);
      callSites += 1;
    }
    assert.ok(
      callSites > 0,
      `${rel(file)} is the sanctioned host-transport file but never calls ` +
        "postMessage — the exception is stale and should be withdrawn",
    );
  }
});

test("the memory view offers no editing affordance", async () => {
  const graph = await moduleGraph();
  assertNothingWasDropped(graph);

  // A control that takes a value is the shape of an edit. Buttons and pointer
  // handlers are allowed and present (scale mode, row selection, the address
  // readout); they change what is DRAWN, never what is stored.
  for (const file of graph.reachable) {
    const source = read(file);
    for (const forbidden of [
      "<input",
      "<textarea",
      "<select",
      "contentEditable",
      "onChange",
      "onSubmit",
      "draggable",
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${path.basename(file)} must not render ${forbidden}`,
      );
    }

    // And the board.yaml fields an editor would target are not named here at
    // all, so a half-built editor cannot begin by "just showing" them.
    for (const field of ["carve_out_kb", "size_kib", "offset_kib"]) {
      assert.equal(
        source.includes(field),
        false,
        `${path.basename(file)} names the editable board.yaml field ${field}`,
      );
    }
  }
});

test("the contract still cannot tell a customer band from a secure one", () => {
  // The tripwire. `system-manifest-v1` carries no region view today; when it
  // grows one, this fails and the read-only decision above must be re-taken
  // with the new data in hand — including whether `owner` is schema-REQUIRED,
  // because an omitted owner that renders as unlocked is the same fail-open
  // the whole design exists to avoid.
  const schema = JSON.parse(
    read(path.join(REPO, "schemas", "system-manifest-v1.schema.json")),
  );
  const roots = Object.keys(schema.properties);

  assert.deepEqual(
    roots,
    [
      "schema_version",
      "generated_by",
      "hw_info",
      "slices",
      "ipc",
      "helper_mcus",
      "boot_order",
      "storage",
    ],
    "system-manifest-v1 grew or lost a root key. If a region/memory view " +
      "landed, re-read #484 D5: the map may become editable only over " +
      "board.yaml (ipc[].carve_out_kb, storage[].size_kib / offset_kib), " +
      "never over the SoM preset, and only once `owner` arrives " +
      "schema-required with no default.",
  );
  assert.equal(schema.additionalProperties, false);
});
