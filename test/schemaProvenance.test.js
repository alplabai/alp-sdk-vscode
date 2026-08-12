// #493: the editor validates board.yaml against a vendored SNAPSHOT while the
// customer's `tan` validates against their RESOLVED SDK. These gates cover the
// comparison that makes the disagreement visible.
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

test("a known difference outranks an unreadable sibling", () => {
  // Arrange -- one schema differs, the other could not be read at all.
  const reads = sdkReadsMatchingVendored();
  reads.board = { ok: true, text: "{}" };
  reads.systemManifest = { ok: false, reason: "ENOENT" };

  // Act
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "v0.14.0",
    sdkReads: reads,
  });

  // Assert -- mismatch is the actionable fact; unreadable would bury it.
  assert.equal(p.state, "mismatch");
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

test("mismatch text names the differing file and which side to trust", () => {
  // Arrange
  const reads = sdkReadsMatchingVendored();
  reads.board = { ok: true, text: "{}" };
  const p = buildSchemaProvenance({
    sdkRoot: "/opt/alp-sdk",
    sdkVersion: "v0.14.0",
    sdkReads: reads,
  });

  // Act
  const text = describeSchemaProvenance(p);

  // Assert -- a squiggle the customer cannot adjudicate is worse than none.
  assert.match(text.short, /differs from SDK/);
  assert.match(text.detail, /board\.yaml/);
  assert.match(text.detail, /v0\.14\.0/);
  assert.match(text.detail, /Trust `tan build`/);
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
  // Arrange -- VENDORED_SDK_TAG is a git tag ("v0.15.0") while
  // metadata/sdk_version.yaml carries "version: 0.15.0". Rendered raw, the two
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
  assert.match(text.short, /matches SDK/);
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
  ];

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
