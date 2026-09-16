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
// WHY THE SCANNED SCOPE IS A CLASSIFIED DIRECTORY LISTING, NOT AN IMPORT WALK
// ---------------------------------------------------------------------------
//
// An earlier version of this file decided which files to scan by following
// same-directory `import … from "./…"` specifiers out from `MemoryRegions
// .tsx`, on the reasoning that a file nothing imports cannot run. That is
// true, but it made the WRONG thing load-bearing: what is scanned depended on
// recognizing an import, and an import can be spelled in more ways than a
// regex can enumerate — a single-quoted specifier, a side-effect import, a
// dynamic `import()`, a bare `.js` specifier, a two-hop re-export, an entry
// point inside a brand-new subdirectory. Every one of those is ordinary,
// working JavaScript that a bundler resolves and ships; a `from\s+"…"`
// pattern matched against literal source text does not have to recognize all
// of them, and an unresolved specifier was dropped with no error and no
// record — the walk simply never grew to include it. A file the gate never
// visited is a file this gate says nothing about, silently.
//
// So the scanned set is now a DIRECTORY LISTING, not a walk: every `.ts` /
// `.tsx` / `.js` / `.jsx` file under this feature's directory, found by
// reading the directory itself (recursively — a new subdirectory is not a
// blind spot), with NO import ever parsed or followed. Each file is required
// to appear in exactly one of two hand-written, reviewed lists —
// `VIEW_FILES` (part of the read-only picture/table, or the one sanctioned
// exception) or `NOT_VIEW_FILES` (deliberately outside it, each with the
// one-line reason a reviewer can check). A file in neither list — a brand
// new one included, whatever its name, its extension, or how (or whether)
// anything imports it — fails the gate outright, with a message telling
// whoever added it to classify it. There is no import syntax left to evade,
// because none is read.
//
// The same reasoning applies one level down, inside the one file this gate
// allows to reach the host at all: scanning that whole file's text for any
// `type: "…"` looked structural but was really still a text search — it
// could be satisfied by a `type` key that has nothing to do with a real
// `postMessage(...)` call. The check below anchors to the call sites
// themselves: every `postMessage(` in that file must be given a single,
// inline object literal, with no spread, no computed key, and a `type`
// field that is a single plain string literal in the sanctioned set — and
// the `postMessage` binding itself may only ever be called directly, never
// assigned to a variable, aliased, or passed anywhere else, so a rename at
// the call site cannot make a dispatch invisible to this scan either.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const BUILD_PLAN_DIR = path.join(
  REPO,
  "packages",
  "alp-webview",
  "src",
  "features",
  "build-plan",
);

/** Drop comments so a forbidden substring, or a `type: "…"` literal, inside
 *  prose or a source comment cannot be read as real source. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      if (at < 0) return line;
      const quotes = (line.slice(0, at).match(/"/g) ?? []).length;
      return quotes % 2 === 0 ? line.slice(0, at) : line;
    })
    .join("\n");
}

const read = (p) => fs.readFileSync(p, "utf8");
const rel = (p) => path.relative(REPO, p);

/** Every source file under `dir`, recursive — the directory listing itself
 *  IS the scope; nothing here reads an import. */
function listSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The two classification lists — every file in the directory must be in
// exactly one.
// ---------------------------------------------------------------------------

/** Part of the read-only memory view: the picture, the table, their shared
 *  helpers, the Notes tab prose rendered beside them, and the one sanctioned
 *  exception (`blockedFindingActions.ts`, see below). None of these may use
 *  the host transport except that one file. */
const VIEW_FILES = [
  "MemoryRegions.tsx",
  "MemoryChart.tsx",
  "MemoryTable.tsx",
  "memoryTableRows.ts",
  "AuthoritySwatch.tsx",
  "blockedFindingActions.ts",
  "format.ts",
  "regionWindow.ts",
  "railScale.ts",
  "authorityTier.ts",
  // Renders beside MemoryRegions in the same tab (BuildPlanView.tsx's
  // "Notes" tab) — Memory-tab UI, so it is classified the same way as the
  // picture and the table: plain prose, no host transport of its own.
  "MemoryNotes.tsx",
].map((name) => path.join(BUILD_PLAN_DIR, name));

/** Deliberately NOT part of the read-only memory view, each with the reason
 *  a reviewer can check against the file itself. */
const NOT_VIEW_FILES = new Map([
  [
    path.join(BUILD_PLAN_DIR, "useBuildPlan.ts"),
    "the data/action hook for the whole build-plan tab (Slices/Memory/Notes), " +
      "not the memory view alone — it legitimately posts requestBuildPlan, " +
      "materialiseBuildPlan, runBuild and flashSlice, and must keep doing so.",
  ],
  [
    path.join(BUILD_PLAN_DIR, "BuildPlanView.tsx"),
    "the whole tab's container (the Slices/Memory/Notes tab strip, the " +
      "Materialise/Build/Flash actions); it renders MemoryRegions and " +
      "MemoryNotes as children but is not itself the memory view.",
  ],
  [
    path.join(BUILD_PLAN_DIR, "index.ts"),
    "a one-line barrel re-export of BuildPlanView, with no logic of its own.",
  ],
]);

test("every source file under the directory is classified exactly once", () => {
  const onDisk = new Set(listSourceFiles(BUILD_PLAN_DIR));
  assert.ok(
    onDisk.size >= 10,
    `the directory listing found only ${onDisk.size} file(s) under ` +
      `${rel(BUILD_PLAN_DIR)} — the walk is broken, not the directory`,
  );

  const viewSet = new Set(VIEW_FILES);
  const notViewSet = new Set(NOT_VIEW_FILES.keys());

  for (const file of onDisk) {
    const inView = viewSet.has(file);
    const inNotView = notViewSet.has(file);
    assert.ok(
      inView || inNotView,
      `${rel(file)} is not classified. Add it to VIEW_FILES (it is part of ` +
        "the read-only memory view and must carry no host transport) or to " +
        "NOT_VIEW_FILES with a one-line reason (it deliberately is not) — " +
        "a file in neither list is exactly the hole a new, unclassified " +
        "file must not be able to open.",
    );
    assert.ok(
      !(inView && inNotView),
      `${rel(file)} is listed in BOTH VIEW_FILES and NOT_VIEW_FILES`,
    );
  }
  // The reverse direction: a list entry naming a file that no longer exists
  // is a stale classification, not a live one.
  for (const file of viewSet) {
    assert.ok(
      onDisk.has(file),
      `VIEW_FILES names ${rel(file)}, which no longer exists on disk`,
    );
  }
  for (const file of notViewSet) {
    assert.ok(
      onDisk.has(file),
      `NOT_VIEW_FILES names ${rel(file)}, which no longer exists on disk`,
    );
  }
});

/** The one file this gate lets use the host transport at all. The approved
 *  design is "open the declaring file, copy its text, both through host
 *  messages", which needs SOME transport; recording the exception here,
 *  scoped to this one file and the two message kinds below, is how that need
 *  is met without reopening "the memory view has no path back to the host"
 *  for the picture/table/Notes files this gate exists to keep passive. */
const SANCTIONED_HOST_FILE = path.join(
  BUILD_PLAN_DIR,
  "blockedFindingActions.ts",
);

/** The exact, and only, accepted way this file may reach `postMessage` at
 *  all — a plain named import, never aliased and never a namespace import.
 *  Pinning the import shape is what lets the call-site scan below trust that
 *  every real dispatch is spelled `postMessage(`, literally; without this, a
 *  local rename (`import { postMessage as pm } …`) would let a call site
 *  spelled `pm(...)` carry any message past a scan anchored on the name
 *  `postMessage`. */
const SANCTIONED_IMPORT_LINE = 'import { postMessage } from "../../vscode";';

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

test("the sanctioned file is actually classified as part of the view", () => {
  // An exception naming a file the classification above does not place in
  // VIEW_FILES protects nothing — it would apply to a file the rest of this
  // test never actually reads as sanctioned.
  assert.ok(
    VIEW_FILES.includes(SANCTIONED_HOST_FILE),
    `${rel(SANCTIONED_HOST_FILE)} is named as the sanctioned host-transport ` +
      "file but is not in VIEW_FILES — the exception would silently apply " +
      "to nothing",
  );
});

/**
 * The brace/paren/bracket-balanced, string-aware text of the argument list
 * immediately following `openParenIndex` (the index of the `(` itself), or
 * `null` if the parens never balance.
 */
function balancedArgs(source, openParenIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex + 1, i);
    }
  }
  return null;
}

/**
 * Every `postMessage(...)` call site in `source` (already comment-stripped),
 * anchored — not a file-wide text search — and structurally validated:
 *
 *  - the argument must be a single, inline object literal (no variable, no
 *    function call, no extra argument);
 *  - it must contain no spread (`...`), which could inject or override a
 *    field this scan cannot see;
 *  - it must contain no computed property key (`[expr]:`), which could
 *    define — or silently redefine — `type` outside what this scan reads as
 *    the `type:` field;
 *  - it must carry EXACTLY one `type:` field, written as a single plain
 *    string literal (single- or double-quoted, matched in full — never a
 *    `const`, a template literal, or a concatenation), whose value is one of
 *    `SANCTIONED_MESSAGE_TYPES`.
 *
 * Returns the number of call sites found, so the caller can refuse a file
 * that claims the exception but never actually calls `postMessage`.
 */
function checkPostMessageCallSites(source, file) {
  const callSites = [...source.matchAll(/\bpostMessage\s*\(/g)];
  for (const call of callSites) {
    const openParen = call.index + call[0].length - 1;
    const args = balancedArgs(source, openParen);
    assert.ok(
      args !== null,
      `${path.basename(file)}: a postMessage( call's parentheses never ` +
        "balance — malformed source",
    );
    const trimmed = args.trim();
    assert.ok(
      trimmed.startsWith("{") && trimmed.endsWith("}"),
      `${path.basename(file)}: postMessage(${trimmed}) is not called with a ` +
        "single inline object literal — a variable, a function call, or an " +
        "extra argument cannot be audited by this gate and is refused " +
        "outright",
    );
    assert.ok(
      !trimmed.includes("..."),
      `${path.basename(file)}: postMessage(${trimmed}) contains a spread — ` +
        "a spread can inject or override a field this gate cannot see and " +
        "is refused outright",
    );
    assert.ok(
      !/\[[^[\]]*\]\s*:/.test(trimmed),
      `${path.basename(file)}: postMessage(${trimmed}) uses a computed ` +
        "property key — a message must be written with plain, literal " +
        "keys so it can be audited",
    );
    const typeValues = [...trimmed.matchAll(/\btype\s*:\s*([^,}]+)/g)].map(
      (m) => m[1].trim(),
    );
    assert.equal(
      typeValues.length,
      1,
      `${path.basename(file)}: postMessage(${trimmed}) does not carry ` +
        `exactly one plain \`type:\` field (found ${typeValues.length}) — ` +
        "the message type must be written inline as a single, unambiguous " +
        "field",
    );
    const raw = typeValues[0];
    const literalMatch = /^"([^"\\]*)"$/.exec(raw) ?? /^'([^'\\]*)'$/.exec(raw);
    assert.ok(
      literalMatch,
      `${path.basename(file)}: postMessage(${trimmed}) writes its type as ` +
        `\`${raw}\`, which is not a single plain string literal — a const ` +
        "reference, a template literal, or a concatenation cannot be " +
        "audited by this gate and is refused outright, whatever it might " +
        "evaluate to",
    );
    const type = literalMatch[1];
    assert.ok(
      SANCTIONED_MESSAGE_TYPES.includes(type),
      `${path.basename(file)}: postMessage(${trimmed}) posts message type ` +
        `"${type}", which is not one of the sanctioned ` +
        `(${SANCTIONED_MESSAGE_TYPES.join(", ")}) — an unaudited additional ` +
        "message type from this file is exactly the hole this exception " +
        "must not open",
    );
  }
  return callSites.length;
}

test("the memory view has no path back to the host, except the one sanctioned exception", () => {
  for (const file of VIEW_FILES) {
    const source = stripComments(read(file));
    const isSanctioned = file === SANCTIONED_HOST_FILE;

    // A dispatched command is never sanctioned anywhere, in any file — the
    // exception below is for `postMessage` alone, in one file, with exactly
    // two message kinds, each written as a literal.
    assert.equal(
      source.includes("runCommand"),
      false,
      `${path.basename(file)} must not dispatch a runCommand — no file in ` +
        "this feature gets a command channel, sanctioned or not",
    );

    if (!isSanctioned) {
      for (const forbidden of ["postMessage", 'from "../../vscode"']) {
        assert.equal(
          source.includes(forbidden),
          false,
          `${path.basename(file)} must not use ${forbidden} — the view is ` +
            "read-only until alp-sdk#1365 lands `kind` + `owner`",
        );
      }
      continue;
    }

    // The sanctioned file: `postMessage` reaches the host only through the
    // ONE pinned import shape — never aliased, never a namespace import —
    // so the call-site scan below can trust that every real dispatch is
    // spelled `postMessage(`, literally.
    assert.ok(
      source.includes(SANCTIONED_IMPORT_LINE),
      `${path.basename(file)} is the sanctioned host-transport file but ` +
        `does not import postMessage with exactly \`${SANCTIONED_IMPORT_LINE}\` ` +
        "— an aliased or namespace import would let a call site spelled " +
        "under a different name evade the scan below",
    );

    // The identifier `postMessage` may appear ONLY inside that one pinned
    // import line and as a direct call (`postMessage(`) — never assigned to
    // a variable, passed as a callback, or otherwise referenced, which
    // would let a dispatch happen under a different name the call-site
    // scan below never looks for.
    const withoutImportLine = source.replace(SANCTIONED_IMPORT_LINE, "");
    const bareReferences = [
      ...withoutImportLine.matchAll(/\bpostMessage\b(?!\s*\()/g),
    ];
    assert.equal(
      bareReferences.length,
      0,
      `${path.basename(file)} references postMessage without calling it ` +
        `directly (found ${bareReferences.length} such use(s)) — it must ` +
        "never be assigned, aliased, or passed anywhere except a direct " +
        "postMessage(...) call, or a dispatch under the alias would be " +
        "invisible to the call-site scan",
    );

    const callSiteCount = checkPostMessageCallSites(source, file);
    assert.ok(
      callSiteCount > 0,
      `${path.basename(file)} is the sanctioned host-transport file but ` +
        "never calls postMessage — the exception is stale; narrow " +
        "VIEW_FILES back to the files that need no transport at all",
    );
  }
});

test("the memory view offers no editing affordance", () => {
  // A control that takes a value is the shape of an edit. Buttons and pointer
  // handlers are allowed and present (scale mode, row selection, the address
  // readout); they change what is DRAWN, never what is stored.
  for (const file of VIEW_FILES) {
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
