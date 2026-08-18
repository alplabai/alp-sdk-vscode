const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { BOARD_KEY_ORDER } = require("@alp-sdk/core/board/models");
const { VENDORED_SDK_TAG, BOARD_SCHEMA_SHA256 } = require("./vendored-sdk-tag");
const {
  sha256OfSchemaText,
} = require("@alp-sdk/core/validation/schemaProvenance");

// sha256 of metadata/schemas/board.schema.json at the alp-sdk VENDORED_SDK_TAG
// tag. THE drift gate: any local edit, forward drift (re-vendoring from submodule
// dev HEAD instead of the pinned tag), or upstream change fails here. The tag and
// both vendored-schema hashes live in
// packages/alp-core/src/validation/vendoredSchemas.ts (./vendored-sdk-tag.js
// re-exports them, and the extension reads them at runtime), so the board and
// system-manifest copies can never green while disagreeing on tag. To bump the
// vendored schema intentionally: copy it from the NEW pinned tag
// (`git -C alp-sdk-upstream show <tag>:metadata/schemas/board.schema.json`), then
// recompute the hash over the LF-normalized file — portable + Windows-safe
// (avoid `shasum`, which isn't on Windows) — and update
// packages/alp-core/src/validation/vendoredSchemas.ts:
//   node -e "const s=require('fs').readFileSync('schemas/board.schema.json','utf-8').replace(/\r\n/g,'\n');console.log(require('crypto').createHash('sha256').update(s,'utf-8').digest('hex'))"

test(`board.schema.json is the vendored ${VENDORED_SDK_TAG} schema (drift/staleness gate)`, () => {
  const p = path.join(__dirname, "..", "schemas", "board.schema.json");
  assert.ok(fs.existsSync(p), "schemas/board.schema.json must exist");
  const raw = fs.readFileSync(p, "utf-8");
  const schema = JSON.parse(raw);
  assert.match(String(schema.$id ?? ""), /board\.schema\.json/);
  assert.deepEqual(schema.required, ["som", "cores"]);

  // Staleness gate: the vendored copy must carry the v0.6 structure. `models`
  // and `supported_boards` are top-level blocks added in v0.6; a regression to a
  // pre-v0.6 schema (which lacked them) fails here — re-vendor from the SDK
  // (`git -C alp-sdk-upstream show v0.11.0:metadata/schemas/board.schema.json`).
  const props = schema.properties ?? {};
  for (const key of ["som", "cores", "ipc", "models", "supported_boards"]) {
    assert.ok(
      props[key],
      `vendored schema must define top-level '${key}' — re-vendor from the SDK`,
    );
  }
  // IPC carve-outs use carve_out_kb (the legacy size_kib field was renamed).
  assert.ok(
    raw.includes("carve_out_kb"),
    "ipc carve-outs must use carve_out_kb",
  );

  // Pin-class lock (#26): the configurator + YAML LSP rely on the vendored schema
  // to validate `e1m_routes` pin classes. The byte-exact SHA pin below catches
  // drift, but an *intentional* re-vendor just bumps the hash — this asserts a
  // re-vendor can't silently drop a pin class the extension depends on. v0.11.0
  // exercises the `adc`/`dac` class (alp_project.py's alp-adc/alp-dac buckets);
  // see docs/COMPATIBILITY_RULES.md §5.
  const e1mRoutes = (schema.$defs ?? {}).e1m_routes ?? {};
  for (const cls of [
    "gpio",
    "buses",
    "pwm",
    "adc",
    "dac",
    "i2s",
    "can",
    "qenc",
  ]) {
    assert.ok(
      (e1mRoutes.properties ?? {})[cls],
      `vendored schema e1m_routes must support the '${cls}' pin class — a re-vendor dropped it`,
    );
  }

  // Byte-exact pin to the SDK tag the copy was vendored from. The key checks
  // above only catch regressions to a PRE-v0.6 schema; this catches local
  // edits and forward drift (e.g. re-vendoring from submodule dev HEAD) too.
  // Normalize CRLF→LF first: with core.autocrlf=true (the Windows default) the
  // checkout smudges the file to CRLF on disk, but the pin is the LF blob git
  // stores — so a pristine Windows clone would otherwise fail here.
  assert.equal(
    sha256OfSchemaText(raw),
    BOARD_SCHEMA_SHA256,
    "schemas/board.schema.json differs from the pinned SDK tag — if the bump " +
      "is intentional, re-vendor from the new tag and update " +
      "packages/alp-core/src/validation/vendoredSchemas.ts (NOT this file, and " +
      "NOT test/vendored-sdk-tag.js, which only re-exports it)",
  );
});

test("package.json yamlValidation points at the vendored schema", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
  );
  const entry = pkg.contributes.yamlValidation.find(
    (e) => e.fileMatch === "board.yaml",
  );
  assert.ok(entry, "a yamlValidation entry for board.yaml is required");
  assert.equal(entry.url, "./schemas/board.schema.json");
});

test("BOARD_KEY_ORDER covers every vendored-schema top-level property (C1 recurrence gate)", () => {
  // parseBoardConfig + serializeBoardConfig whitelist top-level keys on
  // BOARD_KEY_ORDER and silently DROP anything not listed — the C1 data-loss
  // bug (`models` was dropped). This fails the moment the vendored schema gains
  // a top-level block the configurator would drop on round-trip; the fix is to
  // add the key to BOARD_KEY_ORDER (packages/alp-core/src/board/models.ts).
  const p = path.join(__dirname, "..", "schemas", "board.schema.json");
  const schema = JSON.parse(fs.readFileSync(p, "utf-8"));
  const schemaKeys = Object.keys(schema.properties ?? {});
  const covered = new Set(BOARD_KEY_ORDER);
  const dropped = schemaKeys.filter((k) => !covered.has(k));
  assert.deepEqual(
    dropped,
    [],
    `BOARD_KEY_ORDER omits schema top-level key(s) [${dropped.join(", ")}] — the ` +
      "configurator would drop them on round-trip (C1). Add them to BOARD_KEY_ORDER.",
  );
});

// Expand a VS Code snippet body to a parseable YAML doc: join the lines, then
// collapse each ${n|a,b,c|} choice to its first option and ${n:default}/${n}
// placeholders to their default. Enough to structurally lint the snippet's
// shape -- not a full snippet engine.
function expandSnippet(body) {
  return body
    .join("\n")
    .replace(/\$\{\d+\|([^|}]*)\|\}/g, (_, choices) => choices.split(",")[0])
    .replace(/\$\{\d+:([^}]*)\}/g, "$1")
    .replace(/\$\{\d+\}/g, "x")
    .replace(/\$\d+/g, "x");
}

test("board.yaml snippets use the v0.11 top-level libraries shape (#165)", () => {
  // No JSON-Schema validator is vendored (ajv would be a new dependency the
  // house rules forbid), so this is a targeted structural gate for the #165
  // drift class rather than a full round-trip: v0.11 moved libraries to a
  // top-level `libraries:` array -- core_entry is additionalProperties:false
  // and only exposes `extra_libraries`, so a per-core `libraries:` key is
  // rejected, and names must match the schema pattern (no underscores).
  const p = path.join(__dirname, "..", "snippets", "board-yaml.json");
  const snippets = JSON.parse(fs.readFileSync(p, "utf-8"));
  const LIB_NAME = /^[a-z][a-z0-9-]*$/;
  for (const [title, snip] of Object.entries(snippets)) {
    const doc = yaml.load(expandSnippet(snip.body));
    if (doc == null || typeof doc !== "object") continue;
    const cores = doc.cores;
    if (cores && typeof cores === "object") {
      for (const [id, entry] of Object.entries(cores)) {
        assert.ok(
          !(entry && typeof entry === "object" && "libraries" in entry),
          `snippet "${title}" nests libraries: under cores.${id} -- v0.11 moved ` +
            "it to a top-level libraries: array (core_entry forbids the key)",
        );
      }
    }
    if (Array.isArray(doc.libraries)) {
      for (const item of doc.libraries) {
        const name = typeof item === "string" ? item : item && item.name;
        assert.ok(
          typeof name === "string" && LIB_NAME.test(name),
          `snippet "${title}" libraries entry ${JSON.stringify(name)} violates ` +
            "the schema pattern ^[a-z][a-z0-9-]*$ (v0.11 hyphenated names)",
        );
      }
    }
  }
});
