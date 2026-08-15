// The pure half of #493: what gets offered to `redhat.vscode-yaml` for a given
// document, and what an SDK's schema must clear before it is offered at all.
//
// The most important assertions in this file are the negative ones. If
// `offeredUriForResource` ever answers for a document whose SDK schema was not
// accepted, the customer silently loses validation instead of falling back --
// so every refusal path is checked for a null ANSWER, not just for a reason
// string.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MAX_SDK_SCHEMA_LENGTH,
  acceptSdkSchemaText,
} = require("@alp-sdk/core/validation/schemaSafety");
const {
  ALP_SCHEMA_SCHEME,
  EMPTY_SCHEMA_OFFER,
  buildSchemaOffer,
  buildSchemaUri,
  offeredUriForResource,
  resourceFileName,
  schemaIdForResource,
} = require("@alp-sdk/core/validation/schemaContribution");
const {
  buildSchemaProvenance,
  sha256OfSchemaText,
} = require("@alp-sdk/core/validation/schemaProvenance");
const {
  SDK_SCHEMA_RELATIVE_PATHS,
} = require("@alp-sdk/core/validation/vendoredSchemas");

const REPO_ROOT = path.join(__dirname, "..");

function vendoredText(id) {
  return fs.readFileSync(
    path.join(REPO_ROOT, SDK_SCHEMA_RELATIVE_PATHS[id].vendored),
    "utf-8",
  );
}

/** A provenance + reads pair, the way the adapter builds them. */
function offerFor(sdkReads, sdkRoot = "/opt/alp-sdk") {
  const provenance = buildSchemaProvenance({
    sdkRoot,
    sdkVersion: "0.15.0",
    sdkReads,
  });
  return buildSchemaOffer(provenance, sdkReads);
}

function bothVendored() {
  return {
    board: { ok: true, text: vendoredText("board") },
    systemManifest: { ok: true, text: vendoredText("systemManifest") },
  };
}

// ---------------------------------------------------------------------------
// Acceptance -- the SDK schema is a file on a customer-controlled path
// ---------------------------------------------------------------------------

test("a real vendored schema is accepted", () => {
  // Arrange -- if the bytes we ship could not clear the bar, the bar is wrong.
  // Act / Assert
  for (const id of ["board", "systemManifest"]) {
    const verdict = acceptSdkSchemaText(vendoredText(id));
    assert.equal(verdict.ok, true, `${id} must be acceptable`);
    assert.equal(typeof verdict.schema, "object");
  }
});

test("text that is not JSON is refused with a reason, never thrown", () => {
  // Arrange / Act
  const verdict = acceptSdkSchemaText("# a yaml file, not a schema\nfoo: bar");

  // Assert
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /not valid JSON/);
});

test("valid JSON that is not an object is refused", () => {
  // Arrange -- an array or a bare scalar parses fine and is not a schema.
  // Act / Assert
  for (const text of ["[]", '"a string"', "42", "null"]) {
    const verdict = acceptSdkSchemaText(text);
    assert.equal(verdict.ok, false, `${text} must be refused`);
    assert.match(verdict.reason, /not a JSON object/);
  }
});

test("a schema over the size cap is refused", () => {
  // Arrange -- a wrong path, or a truncated download that landed on an
  // archive. Parsing megabytes of it to find out is the thing being avoided.
  const huge = `{"a":"${"x".repeat(MAX_SDK_SCHEMA_LENGTH)}"}`;

  // Act
  const verdict = acceptSdkSchemaText(huge);

  // Assert
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /past the \d+ limit/);
});

test("every $ref that leaves the document is refused; a local pointer is not", () => {
  // Arrange -- serving a schema means the language server resolves its refs.
  // The RELATIVE case is the one an http(s)-only check misses and the one that
  // actually bites: both real schemas carry
  // `"$id": "https://github.com/alplabai/alp-sdk/metadata/schemas/<name>.json"`,
  // so `"other.json"` resolves against that base and is fetched. `file://`
  // would read an arbitrary local path into the customer's diagnostics.
  const leaves = {
    absolute: { properties: { som: { $ref: "https://x.invalid/som.json" } } },
    relative: { properties: { som: { $ref: "som.json" } } },
    parentPath: { properties: { som: { $ref: "../../../etc/passwd" } } },
    localFile: { properties: { som: { $ref: "file:///etc/passwd" } } },
    otherDoc: { properties: { som: { $ref: "other.json#/$defs/sku" } } },
  };
  const local = JSON.stringify({
    $defs: { sku: { type: "string" } },
    properties: { som: { $ref: "#/$defs/sku" } },
  });

  // Act / Assert
  for (const [name, schema] of Object.entries(leaves)) {
    const verdict = acceptSdkSchemaText(JSON.stringify(schema));
    assert.equal(verdict.ok, false, `${name} must be refused`);
    assert.match(verdict.reason, /points outside itself/, name);
  }
  assert.match(
    acceptSdkSchemaText(JSON.stringify(leaves.absolute)).reason,
    /x\.invalid/,
    "name the offending ref, or the customer cannot find it",
  );
  assert.equal(acceptSdkSchemaText(local).ok, true);
});

test("an external $ref is found however deeply it is buried", () => {
  // Arrange -- a top-level-only check would be trivially bypassed, and the
  // real schemas nest refs several levels down.
  const deep = JSON.stringify({
    properties: {
      cores: { items: { allOf: [{ $ref: "http://example.invalid/x.json" }] } },
    },
  });

  // Act / Assert
  assert.equal(acceptSdkSchemaText(deep).ok, false);
});

test("the shipped schemas' own refs are all local pointers (#493 bar check)", () => {
  // Arrange -- the acceptance rule is only safe to be this strict because
  // nothing legitimate uses another shape. If a future re-vendor introduces an
  // external ref, this fails HERE with a readable list rather than silently
  // demoting every customer's SDK to the bundled fallback.
  const refs = [];
  for (const id of ["board", "systemManifest"]) {
    const walk = (node) => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      for (const [key, value] of Object.entries(node)) {
        if (key === "$ref" && typeof value === "string") refs.push(value);
        walk(value);
      }
    };
    walk(JSON.parse(vendoredText(id)));
  }

  // Act / Assert
  assert.ok(refs.length > 0, "the walker found no refs at all");
  assert.deepEqual(
    refs.filter((ref) => !ref.startsWith("#")),
    [],
    "a vendored schema now refs outside itself — acceptSdkSchemaText would " +
      "refuse the SDK's copy of it and fall every customer back to the bundle",
  );
});

// ---------------------------------------------------------------------------
// Which document is which
// ---------------------------------------------------------------------------

test("the file name is taken from the last segment, past query and fragment", () => {
  // Arrange / Act / Assert
  assert.equal(resourceFileName("file:///w/board.yaml"), "board.yaml");
  assert.equal(resourceFileName("file:///w/board.yaml?v=2"), "board.yaml");
  assert.equal(resourceFileName("file:///w/board.yaml#top"), "board.yaml");
  assert.equal(
    resourceFileName("file:///w/my%20project/board.yaml"),
    "board.yaml",
  );
  assert.equal(resourceFileName("file:///w/"), null);
});

test("only board.yaml and system-manifest.yaml are claimed", () => {
  // Arrange / Act / Assert -- anything else must fall through to whatever
  // other contributor or static association would have handled it.
  assert.equal(schemaIdForResource("file:///w/board.yaml"), "board");
  assert.equal(
    schemaIdForResource("file:///w/build/system-manifest.yaml"),
    "systemManifest",
  );
  for (const other of [
    "file:///w/west.yml",
    "file:///w/boards/board.yaml.bak",
    "file:///w/BOARD.YAML",
    "file:///w/prj.conf",
  ]) {
    assert.equal(schemaIdForResource(other), null, other);
  }
});

test("the names claimed are exactly package.json's fileMatch entries", () => {
  // Arrange -- `schemaIdForResource` matches on VENDORED_SCHEMA_LABEL, whose
  // own docstring calls it a HUMAN label for status text. Nothing stops someone
  // making that read better ("board.yaml (schema)") and silently unhooking
  // dynamic schema selection, since the fallback would keep working and the
  // only symptom is the SDK's schema quietly never being served.
  const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
  );
  const fileMatches = (pkg.contributes?.yamlValidation ?? []).map(
    (entry) => entry.fileMatch,
  );
  assert.ok(fileMatches.length > 0, "yamlValidation must contribute schemas");

  // Act / Assert -- every statically-associated document must be one the
  // contributor can claim, and vice versa.
  const claimed = fileMatches.map((name) =>
    schemaIdForResource(`file:///w/${name}`),
  );
  assert.deepEqual(
    claimed.filter((id) => id === null),
    [],
    `contributes.yamlValidation matches ${JSON.stringify(fileMatches)}, but ` +
      "schemaIdForResource does not claim all of them — those documents would " +
      "never get the resolved SDK's schema",
  );
  assert.deepEqual([...claimed].sort(), ["board", "systemManifest"]);
});

// ---------------------------------------------------------------------------
// The offer
// ---------------------------------------------------------------------------

test("the uri is scheme-tagged and carries the content hash", () => {
  // Arrange -- the client caches schema content by uri and its watcher is
  // workspace-scoped, so an SDK under ~/.alp/ never invalidates a cached uri.
  // The hash is what makes a switch produce a uri the cache has never seen.
  const sha = sha256OfSchemaText(vendoredText("board"));

  // Act
  const uri = buildSchemaUri("board", sha);

  // Assert
  assert.equal(uri, `${ALP_SCHEMA_SCHEME}://sdk/board/${sha}.json`);
  assert.ok(
    !uri.startsWith("file:"),
    "a file: uri would be read by the client",
  );
});

test("an accepted SDK schema is offered, with its exact bytes", () => {
  // Arrange / Act
  const reads = bothVendored();
  const offer = offerFor(reads);
  const uri = offeredUriForResource(offer, "file:///w/board.yaml");

  // Assert
  assert.ok(uri, "an accepted schema must be offered");
  assert.equal(
    offer.contentByUri[uri],
    reads.board.text,
    "the served body must be the SDK's own bytes, not a re-serialisation",
  );
});

test("a refused SDK schema is NOT offered, so the bundled copy stays in force", () => {
  // Arrange -- the fallback has to stay genuinely reachable; most first-run
  // users have no SDK at all, and a broken one must land in the same place.
  const reads = { ...bothVendored(), board: { ok: true, text: "nope" } };

  // Act
  const offer = offerFor(reads);

  // Assert
  assert.equal(offeredUriForResource(offer, "file:///w/board.yaml"), null);
  assert.ok(
    offeredUriForResource(offer, "file:///w/system-manifest.yaml"),
    "one refusal must not take the other schema down with it",
  );
});

test("an unreadable SDK schema is NOT offered", () => {
  // Arrange / Act
  const offer = offerFor({
    ...bothVendored(),
    board: { ok: false, reason: "ENOENT" },
  });

  // Assert
  assert.equal(offeredUriForResource(offer, "file:///w/board.yaml"), null);
});

test("no resolved SDK offers nothing at all", () => {
  // Arrange / Act
  const offer = buildSchemaOffer(
    buildSchemaProvenance({ sdkRoot: null, sdkVersion: null, sdkReads: {} }),
    {},
  );

  // Assert
  assert.deepEqual(offer.uriById, EMPTY_SCHEMA_OFFER.uriById);
  assert.deepEqual(offer.contentByUri, {});
});

test("a document that is not ours is never answered for", () => {
  // Arrange -- vscode-yaml pushes ANY truthy answer, so answering here would
  // hijack a file this extension has no schema for.
  const offer = offerFor(bothVendored());

  // Act / Assert
  assert.equal(offeredUriForResource(offer, "file:///w/west.yml"), null);
});

test("two different SDKs produce two different uris", () => {
  // Arrange -- if the uri did not move, an `alp sdk switch` would leave the
  // client serving the previous SDK's cached body: a stale registration in a
  // new shape, which is the defect the issue names explicitly.
  const first = offerFor(bothVendored());
  const second = offerFor({
    ...bothVendored(),
    board: { ok: true, text: '{"properties":{"som":{}}}' },
  });

  // Act
  const a = offeredUriForResource(first, "file:///w/board.yaml");
  const b = offeredUriForResource(second, "file:///w/board.yaml");

  // Assert
  assert.ok(a && b);
  assert.notEqual(a, b);
});
