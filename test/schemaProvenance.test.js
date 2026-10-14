// #493: the editor now validates board.yaml against the RESOLVED SDK's schema,
// with the vendored snapshot as the no-SDK fallback. These gates cover the
// decision of WHICH copy is in force, and the text that names it.
//
// The ordering changed with the fix and these tests changed with it: a
// difference between the two copies used to BE the defect, and is now the
// feature working. What is left to act on is the two states where the editor
// could NOT follow the SDK, so those outrank a difference rather than the
// other way round.
//
// Two of them are recurrence gates rather than unit tests, and are the reason
// this file reads real repo files instead of only fixtures:
//   - the vendored copies must hash to their own pinned constants, so a
//     provenance "match" against a same-tag SDK is real and not vacuous;
//   - every schema `package.json` contributes must be covered by the
//     comparison. #156's stopgap exists because the two vendored copies had
//     drifted onto DIFFERENT tags; covering one schema and not the other
//     rebuilds exactly that hole.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  COMPARED_SCHEMA_IDS,
  buildSchemaProvenance,
  describeSchemaProvenance,
  sha256OfSchemaText,
} = require("@alp-sdk/core/validation/schemaProvenance");
const {
  SDK_SCHEMA_RELATIVE_PATHS,
  VENDORED_SCHEMA_SHA256,
  VENDORED_SDK_TAG,
} = require("@alp-sdk/core/validation/vendoredSchemas");

const REPO_ROOT = path.join(__dirname, "..");

/** The bytes actually shipped for `id`. */
function vendoredText(id) {
  return fs.readFileSync(
    path.join(REPO_ROOT, SDK_SCHEMA_RELATIVE_PATHS[id].vendored),
    "utf-8",
  );
}

/** An SDK that ships exactly what we vendored. */
function sdkReadsMatchingVendored() {
  const reads = {};
  for (const id of COMPARED_SCHEMA_IDS) {
    reads[id] = { ok: true, text: vendoredText(id) };
  }
  return reads;
}

test("sha256OfSchemaText hashes a vendored copy to its own pinned constant", () => {
  // Arrange / Act / Assert -- one per schema, so a half-done re-vendor fails.
  for (const id of COMPARED_SCHEMA_IDS) {
    assert.equal(
      sha256OfSchemaText(vendoredText(id)),
      VENDORED_SCHEMA_SHA256[id],
      `${id}: vendored bytes must hash to the pinned constant`,
    );
  }
});

test("sha256OfSchemaText normalises CRLF so a Windows checkout still matches", () => {
  // Arrange
  const lf = vendoredText("board");
  const crlf = lf.replace(/\n/g, "\r\n");

  // Act / Assert
  assert.equal(sha256OfSchemaText(crlf), sha256OfSchemaText(lf));
  assert.equal(sha256OfSchemaText(crlf), VENDORED_SCHEMA_SHA256.board);
});

test("returns no-sdk when nothing is resolved, without inspecting reads", () => {
  // Arrange / Act
  const p = buildSchemaProvenance({
    sdkRoot: null,
    sdkVersion: null,
    sdkReads: {},
  });

  // Assert
  assert.equal(p.state, "no-sdk");
  assert.equal(p.vendoredTag, VENDORED_SDK_TAG);
  assert.equal(p.comparisons.length, COMPARED_SCHEMA_IDS.length);
});

test("reports match when the SDK ships byte-identical schemas", () => {
  // Arrange / Act
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: VENDORED_SDK_TAG,
    sdkReads: sdkReadsMatchingVendored(),
  });

  // Assert
  assert.equal(p.state, "match");
  assert.ok(p.comparisons.every((c) => c.matches));
  assert.ok(p.comparisons.every((c) => c.sdkSha256 === c.vendoredSha256));
});

test("reports mismatch when the SDK's board schema differs", () => {
  // Arrange -- one byte of difference is enough; this is a byte comparison.
  const reads = sdkReadsMatchingVendored();
  reads.board = {
    ok: true,
    text: vendoredText("board").replace("som", "som "),
  };

  // Act
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "v0.14.0",
    sdkReads: reads,
  });

  // Assert
  assert.equal(p.state, "mismatch");
  const board = p.comparisons.find((c) => c.id === "board");
  assert.equal(board.matches, false);
  assert.notEqual(board.sdkSha256, board.vendoredSha256);
  assert.equal(board.unreadableReason, null);
});

test("a fallback outranks a difference (the ordering #493 inverted)", () => {
  // Arrange -- one schema differs and is SERVED, the other could not be read
  // at all and therefore falls back to the bundled copy.
  const reads = sdkReadsMatchingVendored();
  reads.board = { ok: true, text: "{}" };
  reads.systemManifest = { ok: false, reason: "ENOENT" };

  // Act
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "v0.14.0",
    sdkReads: reads,
  });

  // Assert -- the difference is expected of a customer on another tag and the
  // editor followed it; the unreadable sibling is the one still asserting a
  // snapshot at them, so it is the fact worth surfacing.
  assert.equal(p.state, "unreadable");
  assert.equal(p.comparisons.find((c) => c.id === "board").served, "sdk");
  assert.equal(
    p.comparisons.find((c) => c.id === "systemManifest").served,
    "bundled",
  );
});

test("a REJECTED schema outranks an unreadable one and falls back", () => {
  // Arrange -- present on disk but refused, plus a missing sibling. The
  // customer can open the refused file; they cannot open the missing one.
  const reads = sdkReadsMatchingVendored();
  reads.board = { ok: true, text: "not json at all" };
  reads.systemManifest = { ok: false, reason: "ENOENT" };

  // Act
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "v0.14.0",
    sdkReads: reads,
  });

  // Assert
  assert.equal(p.state, "rejected");
  const board = p.comparisons.find((c) => c.id === "board");
  assert.equal(board.served, "bundled");
  assert.match(board.rejectedReason, /not valid JSON/);
  // It WAS read, so its hash is known even though it is not served -- that is
  // what keeps the once-per-mismatch signature stable across refreshes.
  assert.notEqual(board.sdkSha256, null);
});

test("an accepted SDK schema is served; a matching one is served too", () => {
  // Arrange -- `served` must be decided by acceptance alone, never by "the
  // bytes happen to equal the vendored copy", or the rule would go wrong the
  // moment the vendored copy itself changed shape.
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.15.0",
    sdkReads: sdkReadsMatchingVendored(),
  });

  // Assert
  assert.equal(p.state, "match");
  assert.ok(p.comparisons.every((c) => c.served === "sdk"));
  assert.ok(p.comparisons.every((c) => c.rejectedReason === null));
});

test("a served SDK schema with an unmodelled top-level key is reported", () => {
  // Arrange -- the residue #493 cannot remove. parse/serialize whitelist top
  // level keys against BOARD_KEY_ORDER and SILENTLY DROP the rest, so an SDK
  // newer than this extension can accept a key the visual configurator then
  // deletes on save. Serving the SDK's schema removes the red squiggle that
  // used to deter it, so the loss has to be named instead.
  const reads = sdkReadsMatchingVendored();
  reads.board = {
    ok: true,
    text: JSON.stringify({
      properties: { som: {}, cores: {}, telemetryBudget: {} },
    }),
  };

  // Act
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.16.0",
    sdkReads: reads,
  });

  // Assert
  assert.deepEqual(p.unknownBoardKeys, ["telemetryBudget"]);
  assert.match(describeSchemaProvenance(p).detail, /DROPS those keys/);
});

test("keys the configurator already models are not reported as lost", () => {
  // Arrange -- the vendored schema is by definition fully modelled, so a
  // same-tag SDK must produce an EMPTY list. A gate that fired here would be
  // indistinguishable from one that fires on everything.
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.15.0",
    sdkReads: sdkReadsMatchingVendored(),
  });

  // Assert
  assert.deepEqual(p.unknownBoardKeys, []);
});

test("reports unreadable when a schema is missing and none of the rest differ", () => {
  // Arrange
  const reads = sdkReadsMatchingVendored();
  reads.systemManifest = {
    ok: false,
    reason: "ENOENT: no such file or directory",
  };

  // Act
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "v0.15.0",
    sdkReads: reads,
  });

  // Assert
  assert.equal(p.state, "unreadable");
  const sm = p.comparisons.find((c) => c.id === "systemManifest");
  assert.equal(sm.sdkSha256, null);
  assert.equal(sm.matches, false);
  assert.match(sm.unreadableReason, /ENOENT/);
});

test("an omitted read is treated as unreadable, never as agreement", () => {
  // Arrange -- a caller that forgets a schema must not silently report match.
  // Act
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "v0.15.0",
    sdkReads: { board: { ok: true, text: vendoredText("board") } },
  });

  // Assert
  assert.equal(p.state, "unreadable");
  const sm = p.comparisons.find((c) => c.id === "systemManifest");
  assert.equal(sm.sdkSha256, null);
  assert.match(sm.unreadableReason, /was not read/);
});

test("mismatch text names the SDK in force, and does NOT say distrust it", () => {
  // Arrange -- a customer on v0.14.0 whose board schema differs from ours.
  const reads = sdkReadsMatchingVendored();
  reads.board = { ok: true, text: "{}" };
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "v0.14.0",
    sdkReads: reads,
  });

  // Act
  const text = describeSchemaProvenance(p);

  // Assert -- the squiggle now comes from their OWN SDK. Repeating the
  // pre-#493 line here would teach them to ignore a correct diagnostic, which
  // is why this asserts its ABSENCE rather than just not asserting it.
  assert.match(text.short, /alp-sdk v0\.14\.0/);
  assert.match(text.detail, /board\.yaml/);
  assert.match(text.detail, /v0\.14\.0/);
  assert.ok(
    !/trust `tan build`/i.test(text.detail),
    "the editor followed the SDK here — telling the customer to distrust the " +
      "squiggle belongs to the fallback states only",
  );
});

test("both fallback texts DO say which side to trust", () => {
  // Arrange -- these are the states where the editor could not follow the SDK,
  // so the pre-#493 rule is the correct one and must survive.
  const unreadable = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.14.0",
    sdkReads: {
      ...sdkReadsMatchingVendored(),
      board: { ok: false, reason: "EACCES" },
    },
  });
  const rejected = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.14.0",
    sdkReads: {
      ...sdkReadsMatchingVendored(),
      board: { ok: true, text: "[]" },
    },
  });

  // Act / Assert
  for (const p of [unreadable, rejected]) {
    const text = describeSchemaProvenance(p);
    assert.match(text.short, /bundled/, `${p.state}: names the bundled copy`);
    assert.match(text.detail, /trust `tan build`/i, `${p.state}`);
  }
  assert.match(
    describeSchemaProvenance(rejected).detail,
    /top level is not a JSON object/,
    "a rejection must say WHY, or the customer cannot fix the file",
  );
});

test("no-sdk text says the bundled schema is in force and why that is fine", () => {
  // Arrange / Act
  const text = describeSchemaProvenance(
    buildSchemaProvenance({ sdkRoot: null, sdkVersion: null, sdkReads: {} }),
  );

  // Assert
  assert.match(text.short, new RegExp(VENDORED_SDK_TAG.replace(/\./g, "\\.")));
  assert.match(text.detail, /No SDK is resolved/);
});

test("match text names the SDK as a v-prefixed release, not a bare number", () => {
  // Arrange -- VENDORED_SDK_TAG is a git tag ("v0.16.0") while
  // metadata/sdk_version.yaml carries "version: 0.16.0". Rendered raw, the two
  // sides of the same release read as different things.
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "0.15.0",
    sdkReads: sdkReadsMatchingVendored(),
  });

  // Act
  const text = describeSchemaProvenance(p);

  // Assert
  assert.equal(p.state, "match");
  assert.match(text.short, /^Schema: alp-sdk v0\.15\.0$/);
  assert.match(text.detail, /alp-sdk v0\.15\.0/);
  assert.ok(
    !/ in 0\.15\.0/.test(text.detail),
    "the SDK version must not render bare",
  );
});

test("customer-facing text is a single paragraph (hovers do not honour \\n)", () => {
  // Arrange -- every state, including the list-shaped unreadable one.
  const reads = sdkReadsMatchingVendored();
  reads.board = { ok: false, reason: "EACCES" };
  reads.systemManifest = { ok: false, reason: "ENOENT" };
  const states = [
    buildSchemaProvenance({ sdkRoot: null, sdkVersion: null, sdkReads: {} }),
    buildSchemaProvenance({
      sdkRoot: "/opt/alp-sdk",
      sdkVersion: "0.15.0",
      sdkReads: sdkReadsMatchingVendored(),
    }),
    buildSchemaProvenance({
      sdkRoot: "/opt/alp-sdk",
      sdkVersion: "0.14.0",
      sdkReads: {
        ...sdkReadsMatchingVendored(),
        board: { ok: true, text: "{}" },
      },
    }),
    buildSchemaProvenance({
      sdkRoot: "/opt/alp-sdk",
      sdkVersion: "0.15.0",
      sdkReads: reads,
    }),
    buildSchemaProvenance({
      sdkRoot: "/opt/alp-sdk",
      sdkVersion: "0.14.0",
      sdkReads: {
        ...sdkReadsMatchingVendored(),
        board: { ok: true, text: "nope" },
      },
    }),
  ];
  assert.deepEqual(
    states.map((p) => p.state),
    ["no-sdk", "match", "mismatch", "unreadable", "rejected"],
    "every state must be exercised, or a newline can hide in the one that is not",
  );

  // Act / Assert
  for (const p of states) {
    const text = describeSchemaProvenance(p);
    assert.ok(!text.short.includes("\n"), `${p.state}: short must be one line`);
    assert.ok(
      !text.detail.includes("\n"),
      `${p.state}: detail is rendered in a language-status hover, which shows ` +
        "newlines as spaces — build one paragraph instead",
    );
  }
});

test("unreadable text names the path it failed to read", () => {
  // Arrange
  const reads = sdkReadsMatchingVendored();
  reads.systemManifest = { ok: false, reason: "EACCES" };

  // Act
  const text = describeSchemaProvenance(
    buildSchemaProvenance({
      sdkRoot: "/opt/alp-sdk",
      sdkVersion: "v0.15.0",
      sdkReads: reads,
    }),
  );

  // Assert
  assert.match(
    text.detail,
    /metadata\/schemas\/system-manifest-v1\.schema\.json/,
  );
  assert.match(text.detail, /EACCES/);
});

test("the compiled pin constants are not stale (dist matches the TypeScript source)", () => {
  // The drift gates now read these constants through `packages/alp-core/dist/`,
  // which is a BUILD ARTEFACT -- editing the .ts and forgetting to recompile
  // leaves both gates green against constants that no longer exist in source.
  // Verified by producing it: zeroing BOARD_SCHEMA_SHA256 in the .ts without
  // recompiling left `test/board.schema.vendored.test.js` at 4/4 pass. Same
  // hazard, same shape of gate, as "the compiled metadata copy is not stale"
  // in test/lsp.kconfig.test.js.
  //
  // Arrange -- read the SOURCE the developer actually edits.
  const source = fs.readFileSync(
    path.join(
      REPO_ROOT,
      "packages",
      "alp-core",
      "src",
      "validation",
      "vendoredSchemas.ts",
    ),
    "utf-8",
  );
  const literal = (name) => {
    const match = source.match(
      new RegExp(`export const ${name}\\s*=\\s*\\n?\\s*"([^"]+)"`),
    );
    assert.ok(match, `${name} must be a plain string literal in the source`);
    return match[1];
  };

  // Act / Assert -- compare against what the gates actually loaded.
  const compiled = {
    VENDORED_SDK_TAG,
    BOARD_SCHEMA_SHA256: VENDORED_SCHEMA_SHA256.board,
    SYSTEM_MANIFEST_SCHEMA_SHA256: VENDORED_SCHEMA_SHA256.systemManifest,
  };
  for (const [name, loaded] of Object.entries(compiled)) {
    assert.equal(
      loaded,
      literal(name),
      `${name} in packages/alp-core/dist/ is stale — run \`pnpm exec tsc --build\`. ` +
        "Until you do, the two vendored-schema drift gates are checking the " +
        "PREVIOUS pin and will stay green against a schema you did not vendor.",
    );
  }
});

test("every schema package.json contributes is covered by the comparison (#156 recurrence gate)", () => {
  // Arrange -- the manifest is what actually reaches the customer's editor.
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
  );
  const contributed = (pkg.contributes?.yamlValidation ?? []).map((entry) =>
    String(entry.url).replace(/^\.\//, ""),
  );
  assert.ok(contributed.length > 0, "yamlValidation must contribute schemas");

  // Act
  const compared = COMPARED_SCHEMA_IDS.map(
    (id) => SDK_SCHEMA_RELATIVE_PATHS[id].vendored,
  );

  // Assert -- covering one schema and not the other rebuilds #156's hole.
  assert.deepEqual([...contributed].sort(), [...compared].sort());
});
