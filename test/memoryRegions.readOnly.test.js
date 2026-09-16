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
// The third test is the tripwire: it fails the day the contract grows the
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
// #484 Task 7 FIX ROUND 2 rewrote how the scanned file set is decided. Round
// 1 pinned `blockedFindingActions.ts` into a HAND-MAINTAINED `VIEW_FILES`
// list after the reviewer found it sitting outside the gate entirely — but a
// hand list only ever closes the ONE hole someone already found. The
// reviewer's next pass proved the class is still open: a brand new file,
// dropped into this same directory and wired into the view, posting a real
// message plus an INVENTED `writeBoardYaml`, passed clean — because nothing
// makes the list track what the view actually imports. `useBuildPlan.ts`,
// which legitimately posts `requestBuildPlan`/`materialiseBuildPlan`/
// `runBuild`/`flashSlice` from this SAME directory, is the standing proof
// that a blanket "scan the whole folder" rule would be wrong in the other
// direction.
//
// So the scanned set is now DERIVED: the transitive closure of every file
// `MemoryRegions.tsx` reaches through a same-directory (`./…`) import,
// stopping at the directory boundary (a `../../` import — `../../types`,
// `../../shared/ui`, `../../vscode` — is a shared module, not part of this
// view, and is never followed). A new file falls under the gate the moment
// the view actually imports it, transitively or not; a file nothing in the
// view reaches — `useBuildPlan.ts` included — never does. Checked: as of
// this round, `MemoryRegions.tsx`'s closure does NOT reach `useBuildPlan.ts`
// (grep confirms no file in this directory imports it), so that boundary is
// real today, not merely asserted.

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
 *  prose or a source comment cannot be read as real source. Copied from
 *  `test/webview.protocolMirror.test.js` (and `webview.payloadMirror
 *  .test.js`, which carries its own copy too) rather than shared — the same
 *  ~10-line function, duplicated per gate file, is this codebase's existing
 *  convention for these text-level scanners, and it is what caught this
 *  round's own near-miss: an earlier draft of this file's header described
 *  the ban using the literal word the ban forbids, which this file's own
 *  (then text-level, uncommented) scanner would have flagged in itself. */
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

/** The module specifier of every `from "…"` clause — covers `import {…}
 *  from "…"`, `import type {…} from "…"` and a bare default import; the
 *  clause is the same shape in all three, so nothing more specific is
 *  needed. */
function importSpecifiers(source) {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Resolve a same-directory specifier to a file on disk, or `null` when it is
 * NOT same-directory (does not start with `./` — a `../../` import leaves
 * this directory and is deliberately never followed, per the header) or is a
 * stylesheet (`.module.css` carries no JS/TS to scan and no import of its
 * own to recurse into).
 */
function resolveSameDirSpecifier(specifier) {
  if (!specifier.startsWith("./")) return null;
  if (specifier.endsWith(".css")) return null;
  const base = path.join(BUILD_PLAN_DIR, specifier.slice(2));
  for (const ext of [".tsx", ".ts"]) {
    const candidate = base + ext;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every file `roots` reach, transitively, through a same-directory import. */
function transitiveClosure(roots) {
  const visited = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of importSpecifiers(stripComments(read(file)))) {
      const resolved = resolveSameDirSpecifier(specifier);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }
  return [...visited];
}

/** `MemoryRegions.tsx` is the view's real entry point — `BuildPlanView.tsx`
 *  imports it directly, and imports neither `MemoryChart.tsx` nor
 *  `MemoryTable.tsx` on its own (both are this file's own implementation
 *  detail, reached only through it). One root is therefore enough: the
 *  closure below is transitive, so anything `MemoryChart`/`MemoryTable`
 *  themselves import is still found, however many hops deep. */
const VIEW_FILES = transitiveClosure([
  path.join(BUILD_PLAN_DIR, "MemoryRegions.tsx"),
]);

/** The one file this gate lets use the host transport at all (#484 Task 7
 *  fix round 1, finding 3 — coordinator's ruling). The approved design is
 *  "open the declaring file, copy its text, both through host messages",
 *  which needs SOME transport; recording the exception here, scoped to this
 *  one file and the two message kinds below, is how that need is met
 *  without silently reopening "the memory view has no path back to the
 *  host" for the picture/table files this gate exists to keep passive. */
const SANCTIONED_HOST_FILE = path.join(
  BUILD_PLAN_DIR,
  "blockedFindingActions.ts",
);

/**
 * The ONLY message `type` literals `SANCTIONED_HOST_FILE` may ever send.
 * Neither writes memory-map data: `openBoardYaml` opens a file for editing
 * elsewhere (never this view), `copyText` puts text on the clipboard. A
 * third type appearing here — a dispatched command, an edit message, an
 * unrelated one this list does not name — is exactly the unaudited hole
 * this exception must not become.
 *
 * Appending a THIRD entry here is accepted (#484 Task 7 fix round 2, item
 * 3) — an allowlist someone deliberately widens, in a reviewed change, is
 * what an allowlist is for. It is not accepted silently: widen this array
 * only with the same review that approved the two entries already here,
 * and say in that review why the new message does not write memory-map
 * data, the same case made for these two.
 */
const SANCTIONED_MESSAGE_TYPES = ["openBoardYaml", "copyText"];

test("the derivation actually reaches something, and reaches the right thing", () => {
  // A closure walk that silently visits nothing (a broken specifier regex,
  // a wrong root) would make every test below pass vacuously — the same
  // failure mode `webview.protocolMirror.test.js`'s own parser-sanity test
  // guards against, applied to this file's own scanner.
  assert.ok(
    VIEW_FILES.length >= 6,
    `the derived closure found only ${VIEW_FILES.length} file(s) — the ` +
      "import-specifier regex or the root is broken, not the view",
  );
  const names = VIEW_FILES.map((f) => path.basename(f)).sort();
  for (const expected of [
    "MemoryRegions.tsx",
    "MemoryChart.tsx",
    "MemoryTable.tsx",
    "memoryTableRows.ts",
    "AuthoritySwatch.tsx",
    "blockedFindingActions.ts",
  ]) {
    assert.ok(
      names.includes(expected),
      `the derived closure does not reach ${expected} — either it was ` +
        "un-imported (a real change) or the closure walk is broken",
    );
  }
  // The boundary claimed in the header, checked rather than assumed: a
  // file this closure must NOT reach, because nothing in the view imports
  // it — the same file the coordinator named as the live proof that a
  // blanket per-directory scan would be the wrong fix.
  assert.ok(
    !names.includes("useBuildPlan.ts"),
    "the derived closure reached useBuildPlan.ts — either the view now " +
      "genuinely imports it (re-read whether that import is safe) or a " +
      "`../../`-style import is being followed when it must not be",
  );
});

test("the sanctioned file is actually in the scanned scope", () => {
  // #484 Task 7 fix round 2, item 3: an exception naming a file the gate
  // does not scan protects nothing. This is independent of the derivation
  // test above — even a closure that reaches all the RIGHT other files
  // could still miss this one specific file for its own reason, and this
  // is what would catch that.
  assert.ok(
    VIEW_FILES.includes(SANCTIONED_HOST_FILE),
    "SANCTIONED_HOST_FILE is not in the derived VIEW_FILES scope — the " +
      "exception below would silently apply to a file this gate never " +
      "actually reads",
  );
});

test("the memory view has no path back to the host, except the one sanctioned exception", () => {
  // Act / Assert — every way this webview can ask the extension to do
  // anything. `postMessage` is the transport; a dispatched command is the
  // allow-listed command channel; importing the `vscode` shim is how a
  // component reaches either one. NEITHER is sanctioned anywhere, for any
  // file — the exception below is for `postMessage` alone, in one file, with
  // exactly two message kinds, each written as a literal so it can be read
  // off the source rather than evaluated.
  for (const file of VIEW_FILES) {
    const rawSource = read(file);
    const source = stripComments(rawSource);
    const isSanctioned = file === SANCTIONED_HOST_FILE;

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

    // The sanctioned file: `postMessage` and the `vscode` import ARE
    // present — that is the whole point of this file existing — so this
    // asserts they are actually USED (an unused exception is a stale one)
    // and that every message it sends is one of the two approved kinds,
    // written as a literal.
    assert.ok(
      source.includes("postMessage"),
      `${path.basename(file)} is the sanctioned host-transport file but ` +
        "never calls postMessage — the exception is stale; narrow " +
        "VIEW_FILES back to the original five",
    );
    assert.ok(
      source.includes('from "../../vscode"'),
      `${path.basename(file)} is the sanctioned host-transport file but ` +
        'does not import from "../../vscode" — the exception is stale',
    );

    // STRUCTURAL, not a bare substring search (#484 Task 7 fix round 2,
    // item 2). The reviewer's own mutations proved the previous
    // `/type:\s*"([^"]+)"/g` scan was a text search wearing a structure's
    // clothes: it silently ignored a single-quoted literal entirely (never
    // even entering the SANCTIONED_MESSAGE_TYPES check), and it accepted a
    // concatenated `"focus" + "Section"` by matching only the FIRST
    // quoted fragment — which happened to be unsanctioned and so failed
    // for the wrong reason; had the first fragment been `"copyText"` it
    // would have passed a message this file never actually sends as a
    // single literal.
    //
    // The fix does not parse TypeScript. It captures everything between
    // `type:` and the next `,`/`}` — the whole value expression, as text —
    // and requires that ENTIRE captured text to be nothing but one quoted
    // literal (single OR double quote, matched in full, not merely
    // starting with a quote). A `const` reference, a template literal, or
    // any concatenation fails this shape and is refused outright, with no
    // attempt to evaluate what it might resolve to — exactly the
    // "must be written as a literal, so it can be audited" rule the
    // coordinator asked for.
    const typeValues = [...source.matchAll(/\btype\s*:\s*([^,}]+)/g)].map((m) =>
      m[1].trim(),
    );
    assert.ok(
      typeValues.length > 0,
      `${path.basename(file)}: no \`type: …\` message value found — the ` +
        "scan found nothing to check against SANCTIONED_MESSAGE_TYPES, " +
        "which would let this test pass vacuously",
    );
    for (const raw of typeValues) {
      const literalMatch =
        /^"([^"\\]*)"$/.exec(raw) ?? /^'([^'\\]*)'$/.exec(raw);
      assert.ok(
        literalMatch,
        `${path.basename(file)} writes a message type as \`${raw}\`, which ` +
          "is not a single plain string literal — a const reference, a " +
          "template literal, or a concatenation cannot be audited by this " +
          "gate and is refused outright, whatever it might evaluate to",
      );
      const type = literalMatch[1];
      assert.ok(
        SANCTIONED_MESSAGE_TYPES.includes(type),
        `${path.basename(file)} posts message type "${type}", which is not ` +
          `one of the sanctioned (${SANCTIONED_MESSAGE_TYPES.join(", ")}) — ` +
          "an unaudited additional message type from this file is exactly " +
          "the hole this exception must not open",
      );
    }
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
